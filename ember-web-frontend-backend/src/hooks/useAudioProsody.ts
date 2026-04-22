/**
 * useAudioProsody — all DSP runs on the main thread via AnalyserNode.
 *
 * Why we dropped the AudioWorklet:
 *   `audioContext.audioWorklet.addModule(url)` silently fails in Vite dev mode
 *   when the URL is a TypeScript file that the browser can't execute natively.
 *   The AnalyserNode approach is synchronous, zero-dependency, and runs at full
 *   frame rate without any cross-thread coordination.
 *
 * Performance:
 *   All computations operate on pre-allocated Float32Arrays (no per-frame GC).
 *   The autocorrelation F0 estimator runs ~1–2 ms on a 1024-point window — well
 *   within a 16 ms frame budget.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioFrame, PermissionState } from "../lib/telemetry-types";

const FFT_SIZE = 2048;        // AnalyserNode fftSize
const F0_WINDOW = 1024;       // samples used for autocorrelation (first half)
const ROLLOFF_PERCENTILE = 0.85;
const STATS_INTERVAL_MS = 100;

// ---------------------------------------------------------------------------
// DSP helpers — pure functions, operate on pre-allocated typed arrays
// ---------------------------------------------------------------------------

function computeRmsDb(buf: Float32Array, len = buf.length): number {
  let sum = 0;
  for (let i = 0; i < len; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / len);
  return rms > 1e-9 ? 20 * Math.log10(rms) : -100;
}

function computeZcrHz(buf: Float32Array, sampleRate: number, len = buf.length): number {
  let cross = 0;
  for (let i = 1; i < len; i++) {
    if (buf[i] >= 0 !== buf[i - 1] >= 0) cross++;
  }
  return (cross / 2) / (len / sampleRate);
}

/**
 * Normalized autocorrelation F0 estimator.
 * Search range: 80 Hz (male bass) → 500 Hz (female high).
 * Returns 0 for unvoiced/quiet frames.
 */
function estimateF0(buf: Float32Array, sampleRate: number, len = F0_WINDOW): number {
  const minLag = Math.floor(sampleRate / 500);
  const maxLag = Math.min(Math.floor(sampleRate / 80), Math.floor(len / 2));

  let energy = 0;
  for (let i = 0; i < len; i++) energy += buf[i] * buf[i];
  if (energy < 1e-5) return 0; // silent frame

  let bestLag = 0;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < len - lag; i++) corr += buf[i] * buf[i + lag];
    const norm = corr / energy;
    if (norm > bestCorr) { bestCorr = norm; bestLag = lag; }
  }
  // Require ≥ 0.3 normalized correlation to declare voiced
  return bestCorr >= 0.3 && bestLag > 0 ? sampleRate / bestLag : 0;
}

function linMag(db: number): number {
  return Math.pow(10, db / 20);
}

function computeSpectralCentroid(freqDb: Float32Array, sampleRate: number): number {
  const binHz = (sampleRate / 2) / freqDb.length;
  let wSum = 0, mSum = 0;
  for (let i = 0; i < freqDb.length; i++) {
    const m = linMag(freqDb[i]);
    wSum += m * i * binHz;
    mSum += m;
  }
  return mSum > 1e-9 ? wSum / mSum : 0;
}

function computeSpectralRolloff(freqDb: Float32Array, sampleRate: number): number {
  const binHz = (sampleRate / 2) / freqDb.length;
  let total = 0;
  for (let i = 0; i < freqDb.length; i++) total += linMag(freqDb[i]) ** 2;
  const threshold = total * ROLLOFF_PERCENTILE;
  let cum = 0;
  for (let i = 0; i < freqDb.length; i++) {
    cum += linMag(freqDb[i]) ** 2;
    if (cum >= threshold) return i * binHz;
  }
  return (sampleRate / 2) * 0.99;
}

function computeSpectralFlux(curr: Float32Array, prev: Float32Array | null): number {
  if (!prev || prev.length !== curr.length) return 0;
  let sum = 0;
  for (let i = 0; i < curr.length; i++) {
    const diff = linMag(curr[i]) - linMag(prev[i]);
    if (diff > 0) sum += diff;
  }
  return Math.min(1, sum / curr.length);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface AudioProsodyState {
  status: PermissionState;
  rmsDb: number;
  f0Hz: number;
  spectralCentroid: number;
  spectralRolloff: number;
  spectralFlux: number;
  zcr: number;
  ambientDb: number;
}

const DEFAULT_STATE: AudioProsodyState = {
  status: "unknown",
  rmsDb: -60,
  f0Hz: 0,
  spectralCentroid: 0,
  spectralRolloff: 0,
  spectralFlux: 0,
  zcr: 0,
  ambientDb: -60,
};

export function useAudioProsody(
  onFrame?: (frame: AudioFrame) => void,
): { state: AudioProsodyState; start: () => Promise<void>; stop: () => void } {
  const [state, setState] = useState<AudioProsodyState>(DEFAULT_STATE);

  const ctxRef      = useRef<AudioContext | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef      = useRef<number>(0);
  const prevMagRef  = useRef<Float32Array | null>(null);
  const lastStatTs  = useRef<number>(0);
  const ambientRef  = useRef<number>(-60);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    streamRef.current = null;
    analyserRef.current = null;
    setState(DEFAULT_STATE);
  }, []);

  const start = useCallback(async () => {
    stop();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: { ideal: 44100 },
        },
        video: false,
      });
    } catch {
      setState((s) => ({ ...s, status: "denied" }));
      return;
    }
    streamRef.current = stream;
    setState((s) => ({ ...s, status: "granted" }));

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.5;
    analyserRef.current = analyser;

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    // Do NOT connect to ctx.destination — analysis only, no speaker feedback

    // Pre-allocate buffers once — reused every frame, no GC pressure
    const freqBuf = new Float32Array(analyser.frequencyBinCount); // 1024 bins
    const timeBuf = new Float32Array(FFT_SIZE);                    // 2048 samples

    const loop = () => {
      analyser.getFloatTimeDomainData(timeBuf);
      analyser.getFloatFrequencyData(freqBuf);

      const rmsDb    = computeRmsDb(timeBuf);
      const zcr      = computeZcrHz(timeBuf, ctx.sampleRate);
      const f0Hz     = estimateF0(timeBuf, ctx.sampleRate);
      const centroid = computeSpectralCentroid(freqBuf, ctx.sampleRate);
      const rolloff  = computeSpectralRolloff(freqBuf, ctx.sampleRate);
      const flux     = computeSpectralFlux(freqBuf, prevMagRef.current);

      // Track ambient dB when unvoiced (passive environmental noise)
      if (f0Hz === 0) {
        ambientRef.current = ambientRef.current * 0.95 + rmsDb * 0.05;
      }

      if (!prevMagRef.current || prevMagRef.current.length !== freqBuf.length) {
        prevMagRef.current = new Float32Array(freqBuf.length);
      }
      prevMagRef.current.set(freqBuf);

      const now = performance.now();
      if (now - lastStatTs.current >= STATS_INTERVAL_MS) {
        lastStatTs.current = now;
        const snap: AudioProsodyState = {
          status: "granted",
          rmsDb,
          f0Hz,
          spectralCentroid: centroid,
          spectralRolloff:  rolloff,
          spectralFlux:     flux,
          zcr,
          ambientDb: ambientRef.current,
        };
        setState(snap);
        onFrame?.({
          ts: Date.now(),
          rmsDb,
          f0Hz,
          spectralCentroid: centroid,
          spectralRolloff:  rolloff,
          spectralFlux:     flux,
          zcr,
          ambientDb: ambientRef.current,
        });
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [onFrame, stop]);

  useEffect(() => () => stop(), [stop]);

  return { state, start, stop };
}
