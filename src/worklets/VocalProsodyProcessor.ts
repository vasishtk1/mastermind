/**
 * VocalProsodyProcessor — AudioWorkletProcessor running on the audio rendering thread.
 *
 * Isolation guarantee: this module NEVER touches the DOM or React state.
 * It runs in AudioWorkletGlobalScope, which has no `window`, no `document`,
 * and no access to the main-thread heap.
 *
 * Algorithm:
 *   • Per 128-sample block: compute RMS and ZCR (cheap, O(n))
 *   • Accumulate into a 1024-sample window (≈ 23 ms @ 44.1 kHz)
 *   • On each full window: run autocorrelation F0 estimator
 *   • Post {rmsDb, zcr, f0Hz, isVoiced} to the AudioWorkletNode (main thread)
 *
 * Memory: _accumBuf and _prevBlock are allocated once — no per-frame allocations.
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor,
): void;
declare const sampleRate: number;
declare const currentTime: number;

const PROCESSOR_NAME = "vocal-prosody-processor";
const WINDOW = 1024; // samples per analysis window
const BLOCK = 128;   // Web Audio standard block size

// --- Time-domain helpers (all in-place, no heap allocation) ---------------

function computeRmsDb(buf: Float32Array, len: number): number {
  let sum = 0;
  for (let i = 0; i < len; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / len);
  return rms > 1e-9 ? 20 * Math.log10(rms) : -100;
}

function computeZcrHz(buf: Float32Array, len: number, sr: number): number {
  let cross = 0;
  for (let i = 1; i < len; i++) {
    if (buf[i] >= 0 !== buf[i - 1] >= 0) cross++;
  }
  return (cross / 2) / (len / sr);
}

/**
 * Normalized autocorrelation pitch estimator.
 * Returns fundamental frequency in Hz, or 0 for unvoiced.
 * Search range: 50 Hz – 800 Hz.
 */
function estimateF0(buf: Float32Array, len: number, sr: number): number {
  const minLag = Math.floor(sr / 800);
  const maxLag = Math.min(Math.floor(sr / 50), Math.floor(len / 2));

  // Energy of the full window (denominator for normalization)
  let energy = 0;
  for (let i = 0; i < len; i++) energy += buf[i] * buf[i];
  if (energy < 1e-6) return 0; // silent frame → unvoiced

  let bestLag = 0;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < len - lag; i++) corr += buf[i] * buf[i + lag];
    const norm = corr / energy;
    if (norm > bestCorr) {
      bestCorr = norm;
      bestLag = lag;
    }
  }

  // Threshold: require at least 0.30 normalized correlation to call voiced
  return bestCorr >= 0.3 && bestLag > 0 ? sr / bestLag : 0;
}

// ---------------------------------------------------------------------------

class VocalProsodyProcessor extends AudioWorkletProcessor {
  private _accumBuf = new Float32Array(WINDOW);
  private _accumPos = 0;

  process(inputs: Float32Array[][]): boolean {
    // Take the first channel of the first input bus
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;

    const n = Math.min(channel.length, BLOCK);

    // ---- Per-block stats (very cheap — sent every 128 samples) ----
    const blockRmsDb = computeRmsDb(channel, n);
    const blockZcr    = computeZcrHz(channel, n, sampleRate);

    this.port.postMessage({
      type: "BLOCK",
      rmsDb: blockRmsDb,
      zcr: blockZcr,
      ts: currentTime,
    });

    // ---- Accumulate into analysis window ----
    let remaining = n;
    let src = 0;

    while (remaining > 0) {
      const space = WINDOW - this._accumPos;
      const copy  = Math.min(space, remaining);
      this._accumBuf.set(channel.subarray(src, src + copy), this._accumPos);
      this._accumPos += copy;
      src           += copy;
      remaining     -= copy;

      if (this._accumPos === WINDOW) {
        // Full window ready — run heavy analysis
        const f0 = estimateF0(this._accumBuf, WINDOW, sampleRate);

        this.port.postMessage({
          type: "WINDOW",
          f0Hz: f0,
          isVoiced: f0 > 0,
          ts: currentTime,
        });

        // Overlap by 50 %: copy second half to the start
        this._accumBuf.copyWithin(0, WINDOW / 2, WINDOW);
        this._accumPos = WINDOW / 2;
      }
    }

    return true; // keep processor alive
  }
}

registerProcessor(PROCESSOR_NAME, VocalProsodyProcessor);
