/**
 * useFaceLandmarker
 *
 * Manages the full lifecycle of:
 *   1. getUserMedia({video}) — camera stream
 *   2. @mediapipe/tasks-vision FaceLandmarker — 52 ARKit blend shapes + head pose
 *   3. requestAnimationFrame loop capped at 30 Hz
 *
 * Thread model:
 *   MediaPipe runs WASM inference on the main thread (it cannot run off-thread
 *   without COOP/COEP headers which break many APIs).  We cap detection at 30 Hz
 *   and dispatch frames directly to the TelemetryWorker so React state is updated
 *   at a much lower rate (only the top-8 blendshapes for the UI panel).
 *
 * Returns:
 *   - videoRef      attach to <video> element for live preview
 *   - canvasRef     attach to <canvas> overlay (for future landmark drawing)
 *   - status        permission / load state
 *   - blendshapes   latest frame (for direct React display, debounced ~10Hz)
 *   - headPose      { pitch, yaw, roll } degrees
 *   - start / stop
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { BlendShapeMap, FaceFrame, PermissionState } from "../lib/telemetry-types";
import { ARKIT_BLEND_SHAPES, emptyBlendShapeMap } from "../lib/telemetry-types";

// CDN paths — model files are fetched once and cached by the browser
const MEDIAPIPE_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const FACE_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const TARGET_FPS = 30;
const FRAME_MS = 1000 / TARGET_FPS;
const UI_UPDATE_INTERVAL_MS = 100; // push to React state at this rate

// ---------------------------------------------------------------------------
// Head pose from 4×4 column-major transformation matrix
// ---------------------------------------------------------------------------
const RAD2DEG = 180 / Math.PI;

function matrixToEuler(m: Float32Array): { pitch: number; yaw: number; roll: number } {
  // Column-major layout:
  // | m[0]  m[4]  m[8]  m[12] |
  // | m[1]  m[5]  m[9]  m[13] |
  // | m[2]  m[6]  m[10] m[14] |
  // | m[3]  m[7]  m[11] m[15] |
  const pitch = Math.atan2(-m[9],  Math.sqrt(m[8] * m[8] + m[10] * m[10])) * RAD2DEG;
  const yaw   = Math.atan2( m[8],  m[10]) * RAD2DEG;
  const roll  = Math.atan2(-m[4],  m[0])  * RAD2DEG;
  return { pitch, yaw, roll };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type FaceLandmarkerStatus =
  | "idle"
  | "loading"
  | "ready"
  | "denied"
  | "error";

export interface FacePoseState {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface UseFaceLandmarkerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  status: FaceLandmarkerStatus;
  permissionState: PermissionState;
  blendshapes: BlendShapeMap;
  headPose: FacePoseState;
  start: () => Promise<void>;
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useFaceLandmarker(
  onFrame?: (frame: FaceFrame) => void,
): UseFaceLandmarkerReturn {
  const videoRef  = useRef<HTMLVideoElement>(null!);
  const canvasRef = useRef<HTMLCanvasElement>(null!);

  const [status, setStatus]           = useState<FaceLandmarkerStatus>("idle");
  const [permissionState, setPermissionState] = useState<PermissionState>("unknown");
  const [blendshapes, setBlendshapes] = useState<BlendShapeMap>(emptyBlendShapeMap());
  const [headPose, setHeadPose]       = useState<FacePoseState>({ pitch: 0, yaw: 0, roll: 0 });

  // Refs for mutable hot-path state
  const landmarkerRef   = useRef<import("@mediapipe/tasks-vision").FaceLandmarker | null>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const rafRef          = useRef<number>(0);
  const lastFrameTs     = useRef<number>(0);
  const lastUiUpdateTs  = useRef<number>(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    streamRef.current = null;
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    stop();
    setStatus("loading");

    // --- Lazy-load MediaPipe (deferred import keeps initial bundle small) ---
    let FaceLandmarkerCls: typeof import("@mediapipe/tasks-vision").FaceLandmarker;
    let FilesetResolverCls: typeof import("@mediapipe/tasks-vision").FilesetResolver;
    try {
      const mp = await import("@mediapipe/tasks-vision");
      FaceLandmarkerCls  = mp.FaceLandmarker;
      FilesetResolverCls = mp.FilesetResolver;
    } catch (err) {
      console.error("[useFaceLandmarker] Failed to load @mediapipe/tasks-vision:", err);
      setStatus("error");
      return;
    }

    // --- Initialize FaceLandmarker (WASM init, ~1–2 s first time) ---
    if (!landmarkerRef.current) {
      try {
        const vision = await FilesetResolverCls.forVisionTasks(MEDIAPIPE_WASM);
        landmarkerRef.current = await FaceLandmarkerCls.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_MODEL,
            delegate: "GPU",
          },
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          runningMode: "VIDEO",
          numFaces: 1,
        });
      } catch (err) {
        console.error("[useFaceLandmarker] FaceLandmarker init failed:", err);
        setStatus("error");
        return;
      }
    }

    // --- Request camera ---
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
    } catch {
      setPermissionState("denied");
      setStatus("denied");
      return;
    }
    streamRef.current = stream;
    setPermissionState("granted");

    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((t) => t.stop());
      setStatus("error");
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    setStatus("ready");

    // --- RAF detection loop ---
    const detect = (nowMs: number) => {
      rafRef.current = requestAnimationFrame(detect);

      // Hard cap at TARGET_FPS
      if (nowMs - lastFrameTs.current < FRAME_MS) return;
      lastFrameTs.current = nowMs;

      if (!landmarkerRef.current || video.readyState < 2) return;

      const result = landmarkerRef.current.detectForVideo(video, performance.now());

      if (
        !result.faceBlendshapes ||
        result.faceBlendshapes.length === 0
      ) return;

      // --- Build BlendShapeMap from MediaPipe categories ---
      const bsMap = emptyBlendShapeMap();
      for (const cat of result.faceBlendshapes[0].categories) {
        const name = cat.categoryName as typeof ARKIT_BLEND_SHAPES[number];
        if (name in bsMap) bsMap[name] = cat.score;
      }

      // --- Extract head pose from transformation matrix ---
      let pose: FacePoseState = { pitch: 0, yaw: 0, roll: 0 };
      if (
        result.facialTransformationMatrixes &&
        result.facialTransformationMatrixes.length > 0
      ) {
        const euler = matrixToEuler(result.facialTransformationMatrixes[0].data);
        pose = { pitch: euler.pitch, yaw: euler.yaw, roll: euler.roll };
      }

      // --- Dispatch to TelemetryWorker (zero React setState involvement) ---
      if (onFrame) {
        onFrame({
          ts: Date.now(),
          blendshapes: bsMap,
          headPitch: pose.pitch,
          headYaw: pose.yaw,
          headRoll: pose.roll,
        });
      }

      // --- Rate-limited React state update for the UI panel (~10 Hz) ---
      if (nowMs - lastUiUpdateTs.current >= UI_UPDATE_INTERVAL_MS) {
        lastUiUpdateTs.current = nowMs;
        setBlendshapes({ ...bsMap });
        setHeadPose(pose);
      }
    };

    rafRef.current = requestAnimationFrame(detect);
  }, [onFrame, stop]);

  useEffect(() => () => stop(), [stop]);

  return {
    videoRef,
    canvasRef,
    status,
    permissionState,
    blendshapes,
    headPose,
    start,
    stop,
  };
}
