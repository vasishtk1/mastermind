/**
 * Shared TypeScript types for the Ember telemetry pipeline.
 *
 * Data flow:
 *   Browser sensors (mic / camera / motion / pointer)
 *     → individual hooks (useAudioProsody, useFaceLandmarker, …)
 *     → postMessage → TelemetryWorker (ring-buffer aggregation)
 *     → POST /api/telemetry/batch every 500 ms
 *     → Worker → main thread summary stats (TelemetryStats) for UI display
 */

// ---------------------------------------------------------------------------
// ARKit-equivalent blend shape names (52 total, as reported by MediaPipe)
// ---------------------------------------------------------------------------
export const ARKIT_BLEND_SHAPES = [
  "browDownLeft","browDownRight","browInnerUp",
  "browOuterUpLeft","browOuterUpRight",
  "cheekPuff","cheekSquintLeft","cheekSquintRight",
  "eyeBlinkLeft","eyeBlinkRight",
  "eyeLookDownLeft","eyeLookDownRight",
  "eyeLookInLeft","eyeLookInRight",
  "eyeLookOutLeft","eyeLookOutRight",
  "eyeLookUpLeft","eyeLookUpRight",
  "eyeSquintLeft","eyeSquintRight",
  "eyeWideLeft","eyeWideRight",
  "jawForward","jawLeft","jawRight","jawOpen",
  "mouthClose","mouthDimpleLeft","mouthDimpleRight",
  "mouthFrownLeft","mouthFrownRight","mouthFunnel",
  "mouthLeft","mouthRight",
  "mouthLowerDownLeft","mouthLowerDownRight",
  "mouthPressLeft","mouthPressRight","mouthPucker",
  "mouthRollLower","mouthRollUpper",
  "mouthShrugLower","mouthShrugUpper",
  "mouthSmileLeft","mouthSmileRight",
  "mouthStretchLeft","mouthStretchRight",
  "mouthUpperUpLeft","mouthUpperUpRight",
  "noseSneerLeft","noseSneerRight",
] as const;

export type BlendShapeName = typeof ARKIT_BLEND_SHAPES[number];
export type BlendShapeMap = Record<BlendShapeName, number>;

export function emptyBlendShapeMap(): BlendShapeMap {
  return Object.fromEntries(
    ARKIT_BLEND_SHAPES.map((k) => [k, 0])
  ) as BlendShapeMap;
}

// ---------------------------------------------------------------------------
// Per-frame sensor structs (what each hook emits)
// ---------------------------------------------------------------------------

export interface FaceFrame {
  ts: number;
  blendshapes: BlendShapeMap;
  /** Euler angles in degrees derived from MediaPipe transformation matrix */
  headPitch: number;
  headYaw: number;
  headRoll: number;
}

export interface AudioFrame {
  ts: number;
  rmsDb: number;         // dBFS, typically −60 … 0
  f0Hz: number;          // fundamental frequency, 0 = unvoiced
  spectralCentroid: number; // Hz
  spectralRolloff: number;  // Hz (frequency below which 85 % of energy sits)
  spectralFlux: number;     // normalized 0–1, frame-to-frame change
  zcr: number;              // zero-crossing rate in Hz
  ambientDb: number;        // dBFS when unvoiced (passive noise measurement)
}

export interface MotionFrame {
  ts: number;
  orientationAlpha: number | null;
  orientationBeta: number | null;
  orientationGamma: number | null;
  rotationRateAlpha: number | null;
  rotationRateBeta: number | null;
  rotationRateGamma: number | null;
  accelX: number | null;
  accelY: number | null;
  accelZ: number | null;
  accelGravityX: number | null;
  accelGravityY: number | null;
  accelGravityZ: number | null;
}

export interface PointerFrame {
  ts: number;
  eventType: "down" | "move" | "up";
  x: number;
  y: number;
  contactWidth: number;
  contactHeight: number;
  pressure: number;
  velocity: number;       // px / ms at "up" event, 0 otherwise
  interTapMs: number;     // ms since last "down", 0 on first tap
}

// ---------------------------------------------------------------------------
// Worker message protocol
// ---------------------------------------------------------------------------

/** Messages FROM main thread TO TelemetryWorker */
export type WorkerInbound =
  | { kind: "CONFIG"; patientId: string; apiBase: string }
  | { kind: "FACE";    frame: FaceFrame }
  | { kind: "AUDIO";   frame: AudioFrame }
  | { kind: "MOTION";  frame: MotionFrame }
  | { kind: "POINTER"; frame: PointerFrame };

/** Summary stats pushed FROM TelemetryWorker TO main thread (~10 Hz) for UI */
export interface TelemetryStats {
  rmsDb: number;
  f0Hz: number;
  spectralFlux: number;
  spectralCentroid: number;
  zcr: number;
  ambientDb: number;
  tremorMagnitude: number;  // magnitude of accel vector std-dev
  headPitch: number;
  headYaw: number;
  headRoll: number;
  topBlendshapes: Array<{ name: BlendShapeName; value: number }>;
  tapCount: number;
  meanPressure: number;
  meanVelocity: number;
}

/** Messages FROM TelemetryWorker TO main thread */
export type WorkerOutbound =
  | { kind: "STATS"; stats: TelemetryStats }
  | { kind: "BATCH_SENT"; windowMs: number; frameCount: number }
  | { kind: "BATCH_ERROR"; error: string };

// ---------------------------------------------------------------------------
// Sensor status / permission state
// ---------------------------------------------------------------------------
export type PermissionState = "unknown" | "granted" | "denied" | "unavailable";

export interface TelemetryPermissions {
  microphone: PermissionState;
  camera: PermissionState;
  motion: PermissionState;
}

// ---------------------------------------------------------------------------
// Batch payload (what the worker POSTs to the backend)
// ---------------------------------------------------------------------------
export interface TelemetryBatchPayload {
  patient_id: string;
  window_start_ms: number;
  window_end_ms: number;
  face: {
    frame_count: number;
    head_pitch_mean: number;
    head_yaw_mean: number;
    head_roll_mean: number;
    blink_rate_left: number;
    blink_rate_right: number;
    dominant_expressions: Array<{ name: string; mean: number }>;
  };
  audio: {
    frame_count: number;
    rms_db_mean: number;
    rms_db_max: number;
    f0_mean: number;
    spectral_centroid_mean: number;
    spectral_flux_mean: number;
    zcr_mean: number;
    ambient_db_mean: number;
  };
  motion: {
    frame_count: number;
    accel_magnitude_mean: number;
    accel_magnitude_max: number;
    tremor_index: number;
    orientation_beta_mean: number;
    orientation_gamma_mean: number;
  };
  pointer: {
    tap_count: number;
    mean_pressure: number;
    mean_velocity_px_per_ms: number;
    mean_inter_tap_ms: number;
    total_contact_events: number;
  };
}
