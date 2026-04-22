/**
 * useTelemetry — Orchestrator hook
 *
 * Creates the TelemetryWorker and wires every sensor hook to it.
 * This is the single entry point for consumer components.
 *
 * Architecture:
 *   useTelemetry
 *     ├─ TelemetryWorker   (Web Worker — off main thread)
 *     │    buffers frames, batches, POSTs to /api/telemetry/batch
 *     │    sends TelemetryStats back every 100 ms
 *     │
 *     ├─ useAudioProsody   (AudioContext + AudioWorklet + AnalyserNode)
 *     ├─ useFaceLandmarker (MediaPipe WASM + camera stream + RAF loop)
 *     ├─ useDeviceMotion   (DeviceMotion + DeviceOrientation events)
 *     └─ usePointerTelemetry (window Pointer Events)
 *
 * React state: Only `TelemetryStats` (100 Hz summary) is stored in state.
 * Individual sensor frames are NEVER stored in React state — they go
 * directly to the worker via postMessage.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AudioFrame,
  FaceFrame,
  MotionFrame,
  PointerFrame,
  TelemetryPermissions,
  TelemetryStats,
  WorkerInbound,
  WorkerOutbound,
} from "../lib/telemetry-types";
import { useAudioProsody } from "./useAudioProsody";
import { useFaceLandmarker } from "./useFaceLandmarker";
import { useDeviceMotion } from "./useDeviceMotion";
import { usePointerTelemetry } from "./usePointerTelemetry";

const API_BASE = "http://localhost:8000";

const DEFAULT_STATS: TelemetryStats = {
  rmsDb: -60,
  f0Hz: 0,
  spectralFlux: 0,
  spectralCentroid: 0,
  zcr: 0,
  ambientDb: -60,
  tremorMagnitude: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  topBlendshapes: [],
  tapCount: 0,
  meanPressure: 0,
  meanVelocity: 0,
};

export interface UseTelemetryReturn {
  /** Latest aggregated stats for the UI — updated at ~10 Hz */
  stats: TelemetryStats;
  permissions: TelemetryPermissions;

  /** Call these from a user-gesture button to start sensors */
  startAudio: () => Promise<void>;
  startCamera: () => Promise<void>;
  stopAudio: () => void;
  stopCamera: () => void;

  /** iOS motion permission must be requested on user gesture */
  requestMotionPermission: () => Promise<void>;

  /** Refs for rendering the camera <video> + optional <canvas> overlay */
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;

  /** For reading the sub-hook states (face status, audio state, motion state) */
  faceStatus: ReturnType<typeof useFaceLandmarker>["status"];
  audioState: ReturnType<typeof useAudioProsody>["state"];
  motionState: ReturnType<typeof useDeviceMotion>["state"];
  pointerState: ReturnType<typeof usePointerTelemetry>["state"];
  blendshapes: ReturnType<typeof useFaceLandmarker>["blendshapes"];
  headPose: ReturnType<typeof useFaceLandmarker>["headPose"];
}

export function useTelemetry(patientId: string): UseTelemetryReturn {
  const [stats, setStats] = useState<TelemetryStats>(DEFAULT_STATS);
  const workerRef = useRef<Worker | null>(null);

  // ---------------------------------------------------------------------------
  // Worker setup
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/TelemetryWorker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (evt: MessageEvent<WorkerOutbound>) => {
      const msg = evt.data;
      if (msg.kind === "STATS") {
        setStats(msg.stats);
      }
      // BATCH_SENT / BATCH_ERROR are informational — ignore in UI
    };

    worker.onerror = (err) => {
      console.error("[TelemetryWorker] error:", err);
    };

    // Send configuration
    const config: WorkerInbound = {
      kind: "CONFIG",
      patientId,
      apiBase: API_BASE,
    };
    worker.postMessage(config);
    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [patientId]);

  // ---------------------------------------------------------------------------
  // Dispatch helpers — these are stable refs, safe to pass as onFrame callbacks
  // ---------------------------------------------------------------------------
  const dispatchAudio = useCallback((frame: AudioFrame) => {
    workerRef.current?.postMessage({ kind: "AUDIO", frame } satisfies WorkerInbound);
  }, []);

  const dispatchFace = useCallback((frame: FaceFrame) => {
    workerRef.current?.postMessage({ kind: "FACE", frame } satisfies WorkerInbound);
  }, []);

  const dispatchMotion = useCallback((frame: MotionFrame) => {
    workerRef.current?.postMessage({ kind: "MOTION", frame } satisfies WorkerInbound);
  }, []);

  const dispatchPointer = useCallback((frame: PointerFrame) => {
    workerRef.current?.postMessage({ kind: "POINTER", frame } satisfies WorkerInbound);
  }, []);

  // ---------------------------------------------------------------------------
  // Sub-hooks
  // ---------------------------------------------------------------------------
  const {
    state: audioState,
    start: startAudio,
    stop: stopAudio,
  } = useAudioProsody(dispatchAudio);

  const {
    videoRef,
    canvasRef,
    status: faceStatus,
    blendshapes,
    headPose,
    start: startCamera,
    stop: stopCamera,
  } = useFaceLandmarker(dispatchFace);

  const {
    state: motionState,
    requestPermission: requestMotionPermission,
  } = useDeviceMotion(dispatchMotion);

  const { state: pointerState } = usePointerTelemetry(dispatchPointer);

  // ---------------------------------------------------------------------------
  // Permission summary
  // ---------------------------------------------------------------------------
  const permissions: TelemetryPermissions = {
    microphone: audioState.status,
    camera:     faceStatus === "ready"   ? "granted"
              : faceStatus === "denied"  ? "denied"
              : faceStatus === "loading" ? "unknown"
              : "unknown",
    motion: motionState.unavailable ? "unavailable" : motionState.permission,
  };

  return {
    stats,
    permissions,
    startAudio,
    startCamera,
    stopAudio,
    stopCamera,
    requestMotionPermission,
    videoRef,
    canvasRef,
    faceStatus,
    audioState,
    motionState,
    pointerState,
    blendshapes,
    headPose,
  };
}
