/**
 * TelemetryWorker — runs entirely off the main thread.
 *
 * Responsibilities:
 *  1. Receive sensor frames from the main thread via postMessage.
 *  2. Store them in fixed-size typed ring buffers (no heap churn).
 *  3. Every 500 ms: aggregate the buffers → POST a batch to the FastAPI backend.
 *  4. Every 100 ms: compute summary stats → postMessage back for the UI.
 *
 * Memory model:
 *  - All numeric ring buffers are Float64Arrays allocated once at startup.
 *  - No dynamic array growth. Pointer wraps around with modulo.
 *  - BlendShape ring stores 32 floats × 52 channels in a single flat array.
 */

import type {
  AudioFrame,
  BlendShapeName,
  FaceFrame,
  MotionFrame,
  PointerFrame,
  TelemetryBatchPayload,
  TelemetryStats,
  WorkerInbound,
  WorkerOutbound,
} from "../lib/telemetry-types";

// ---------------------------------------------------------------------------
// Config (set via CONFIG message from main thread)
// ---------------------------------------------------------------------------
let PATIENT_ID = "unknown";
let API_BASE = "http://localhost:8000";

// ---------------------------------------------------------------------------
// Ring buffer helpers
// ---------------------------------------------------------------------------
const RING = 64; // 64 frames ≈ 1 s at 60 Hz — enough for a 500 ms window

class ScalarRing {
  private buf: Float64Array;
  private ptr = 0;
  count = 0;

  constructor(readonly cap = RING) {
    this.buf = new Float64Array(cap);
  }

  push(v: number) {
    this.buf[this.ptr] = v;
    this.ptr = (this.ptr + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }

  mean(): number {
    if (this.count === 0) return 0;
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.buf[i];
    return s / this.count;
  }

  max(): number {
    if (this.count === 0) return 0;
    let m = -Infinity;
    for (let i = 0; i < this.count; i++) if (this.buf[i] > m) m = this.buf[i];
    return m;
  }

  /** Population standard deviation */
  pstdev(): number {
    if (this.count < 2) return 0;
    const mu = this.mean();
    let v = 0;
    for (let i = 0; i < this.count; i++) v += (this.buf[i] - mu) ** 2;
    return Math.sqrt(v / this.count);
  }

  reset() {
    this.ptr = 0;
    this.count = 0;
  }
}

/** Fixed-size ring for the most recent N raw values (for peek at UI rate) */
class LatestScalar {
  private value: number;
  constructor(defaultValue = 0) { this.value = defaultValue; }
  push(v: number) { this.value = v; }
  get() { return this.value; }
}

// ---------------------------------------------------------------------------
// Audio rings
// ---------------------------------------------------------------------------
const audio = {
  rmsDb:            new ScalarRing(),
  f0Hz:             new ScalarRing(),
  spectralCentroid: new ScalarRing(),
  spectralFlux:     new ScalarRing(),
  zcr:              new ScalarRing(),
  ambientDb:        new ScalarRing(),
  frameCount:       0,
  latest: {
    rmsDb:            new LatestScalar(-60),  // -60 dBFS = silence, not 0
    f0Hz:             new LatestScalar(0),
    spectralFlux:     new LatestScalar(0),
    spectralCentroid: new LatestScalar(0),
    zcr:              new LatestScalar(0),
    ambientDb:        new LatestScalar(-60),
  },
};

// ---------------------------------------------------------------------------
// Face rings — 52 blend shapes stored flat (channel-major)
// ---------------------------------------------------------------------------
const BLEND_SHAPE_NAMES: BlendShapeName[] = [
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
];

const N_BS = BLEND_SHAPE_NAMES.length; // 52
const blendRing = new Float64Array(RING * N_BS); // [frame0_ch0, frame0_ch1, …, frame63_ch51]
let blendPtr = 0;
let blendCount = 0;

function pushBlendFrame(bs: Record<string, number>) {
  const base = blendPtr * N_BS;
  for (let c = 0; c < N_BS; c++) {
    blendRing[base + c] = bs[BLEND_SHAPE_NAMES[c]] ?? 0;
  }
  blendPtr = (blendPtr + 1) % RING;
  if (blendCount < RING) blendCount++;
}

function blendChannelMean(ch: number): number {
  if (blendCount === 0) return 0;
  let s = 0;
  for (let f = 0; f < blendCount; f++) s += blendRing[f * N_BS + ch];
  return s / blendCount;
}

const face = {
  headPitch: new ScalarRing(),
  headYaw:   new ScalarRing(),
  headRoll:  new ScalarRing(),
  frameCount: 0,
  latestPitch: new LatestScalar(),
  latestYaw:   new LatestScalar(),
  latestRoll:  new LatestScalar(),
};

// ---------------------------------------------------------------------------
// Motion rings
// ---------------------------------------------------------------------------
const motion = {
  accelX: new ScalarRing(),
  accelY: new ScalarRing(),
  accelZ: new ScalarRing(),
  magnitude: new ScalarRing(),
  betaMean: new ScalarRing(),
  gammaMean: new ScalarRing(),
  frameCount: 0,
  latestMagnitude: new LatestScalar(),
};

// ---------------------------------------------------------------------------
// Pointer aggregates (not ring-based — event-level)
// ---------------------------------------------------------------------------
const pointer = {
  tapCount:         0,
  totalContactEvts: 0,
  pressureSum:      0,
  velocitySum:      0,
  velocityCount:    0,
  interTapSum:      0,
  interTapCount:    0,
};

// ---------------------------------------------------------------------------
// Window book-keeping
// ---------------------------------------------------------------------------
let windowStartMs = Date.now();

// ---------------------------------------------------------------------------
// Ingest handlers
// ---------------------------------------------------------------------------
function ingestAudio(f: AudioFrame) {
  audio.rmsDb.push(f.rmsDb);
  audio.f0Hz.push(f.f0Hz);
  audio.spectralCentroid.push(f.spectralCentroid);
  audio.spectralFlux.push(f.spectralFlux);
  audio.zcr.push(f.zcr);
  audio.ambientDb.push(f.ambientDb);
  audio.frameCount++;
  audio.latest.rmsDb.push(f.rmsDb);
  audio.latest.f0Hz.push(f.f0Hz);
  audio.latest.spectralFlux.push(f.spectralFlux);
  audio.latest.spectralCentroid.push(f.spectralCentroid);
  audio.latest.zcr.push(f.zcr);
  audio.latest.ambientDb.push(f.ambientDb);
}

function ingestFace(f: FaceFrame) {
  pushBlendFrame(f.blendshapes);
  face.headPitch.push(f.headPitch);
  face.headYaw.push(f.headYaw);
  face.headRoll.push(f.headRoll);
  face.frameCount++;
  face.latestPitch.push(f.headPitch);
  face.latestYaw.push(f.headYaw);
  face.latestRoll.push(f.headRoll);
}

function ingestMotion(f: MotionFrame) {
  const ax = f.accelX ?? 0;
  const ay = f.accelY ?? 0;
  const az = f.accelZ ?? 0;
  const mag = Math.sqrt(ax * ax + ay * ay + az * az);
  motion.accelX.push(ax);
  motion.accelY.push(ay);
  motion.accelZ.push(az);
  motion.magnitude.push(mag);
  if (f.orientationBeta != null) motion.betaMean.push(f.orientationBeta);
  if (f.orientationGamma != null) motion.gammaMean.push(f.orientationGamma);
  motion.frameCount++;
  motion.latestMagnitude.push(mag);
}

function ingestPointer(f: PointerFrame) {
  pointer.totalContactEvts++;
  if (f.eventType === "down") {
    pointer.tapCount++;
    pointer.pressureSum += f.pressure;
    if (f.interTapMs > 0) {
      pointer.interTapSum += f.interTapMs;
      pointer.interTapCount++;
    }
  }
  if (f.eventType === "up" && f.velocity > 0) {
    pointer.velocitySum += f.velocity;
    pointer.velocityCount++;
  }
}

// ---------------------------------------------------------------------------
// Stats for the UI (fast path — no averaging across ring, just latest values)
// ---------------------------------------------------------------------------
function buildStats(): TelemetryStats {
  const topBlendshapes = BLEND_SHAPE_NAMES
    .map((name, idx) => ({ name, value: blendChannelMean(idx) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const tremorMagnitude = motion.magnitude.pstdev();

  return {
    rmsDb:            audio.latest.rmsDb.get(),
    f0Hz:             audio.latest.f0Hz.get(),
    spectralFlux:     audio.latest.spectralFlux.get(),
    spectralCentroid: audio.latest.spectralCentroid.get(),
    zcr:              audio.latest.zcr.get(),
    ambientDb:        audio.latest.ambientDb.get(),
    tremorMagnitude,
    headPitch:        face.latestPitch.get(),
    headYaw:          face.latestYaw.get(),
    headRoll:         face.latestRoll.get(),
    topBlendshapes,
    tapCount:         pointer.tapCount,
    meanPressure:     pointer.tapCount > 0 ? pointer.pressureSum / pointer.tapCount : 0,
    meanVelocity:     pointer.velocityCount > 0 ? pointer.velocitySum / pointer.velocityCount : 0,
  };
}

// ---------------------------------------------------------------------------
// Batch builder and POST
// ---------------------------------------------------------------------------
function buildBatch(): TelemetryBatchPayload {
  const nowMs = Date.now();
  const batch: TelemetryBatchPayload = {
    patient_id:      PATIENT_ID,
    window_start_ms: windowStartMs,
    window_end_ms:   nowMs,
    face: {
      frame_count:      face.frameCount,
      head_pitch_mean:  face.headPitch.mean(),
      head_yaw_mean:    face.headYaw.mean(),
      head_roll_mean:   face.headRoll.mean(),
      blink_rate_left:  blendChannelMean(BLEND_SHAPE_NAMES.indexOf("eyeBlinkLeft")),
      blink_rate_right: blendChannelMean(BLEND_SHAPE_NAMES.indexOf("eyeBlinkRight")),
      dominant_expressions: BLEND_SHAPE_NAMES
        .map((name, idx) => ({ name, mean: blendChannelMean(idx) }))
        .filter((e) => e.mean > 0.05)
        .sort((a, b) => b.mean - a.mean)
        .slice(0, 10),
    },
    audio: {
      frame_count:           audio.frameCount,
      rms_db_mean:           audio.rmsDb.mean(),
      rms_db_max:            audio.rmsDb.max(),
      f0_mean:               audio.f0Hz.mean(),
      spectral_centroid_mean:audio.spectralCentroid.mean(),
      spectral_flux_mean:    audio.spectralFlux.mean(),
      zcr_mean:              audio.zcr.mean(),
      ambient_db_mean:       audio.ambientDb.mean(),
    },
    motion: {
      frame_count:           motion.frameCount,
      accel_magnitude_mean:  motion.magnitude.mean(),
      accel_magnitude_max:   motion.magnitude.max(),
      tremor_index:          motion.magnitude.pstdev(),
      orientation_beta_mean: motion.betaMean.mean(),
      orientation_gamma_mean:motion.gammaMean.mean(),
    },
    pointer: {
      tap_count:             pointer.tapCount,
      mean_pressure:         pointer.tapCount > 0 ? pointer.pressureSum / pointer.tapCount : 0,
      mean_velocity_px_per_ms: pointer.velocityCount > 0 ? pointer.velocitySum / pointer.velocityCount : 0,
      mean_inter_tap_ms:     pointer.interTapCount > 0 ? pointer.interTapSum / pointer.interTapCount : 0,
      total_contact_events:  pointer.totalContactEvts,
    },
  };
  return batch;
}

function resetWindow() {
  // Reset counts (rings keep old values — they're sliding windows, not snapshots)
  audio.frameCount = 0;
  face.frameCount = 0;
  motion.frameCount = 0;
  pointer.tapCount = 0;
  pointer.totalContactEvts = 0;
  pointer.pressureSum = 0;
  pointer.velocitySum = 0;
  pointer.velocityCount = 0;
  pointer.interTapSum = 0;
  pointer.interTapCount = 0;
  blendCount = 0;
  blendPtr = 0;
  windowStartMs = Date.now();
}

async function flushBatch() {
  const batch = buildBatch();
  resetWindow();

  try {
    const res = await fetch(`${API_BASE}/api/telemetry/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (res.ok) {
      const msg: WorkerOutbound = {
        kind: "BATCH_SENT",
        windowMs: batch.window_end_ms - batch.window_start_ms,
        frameCount:
          batch.face.frame_count + batch.audio.frame_count + batch.motion.frame_count,
      };
      self.postMessage(msg);
    }
  } catch (err) {
    const msg: WorkerOutbound = {
      kind: "BATCH_ERROR",
      error: String(err),
    };
    self.postMessage(msg);
  }
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------
setInterval(() => {
  const msg: WorkerOutbound = { kind: "STATS", stats: buildStats() };
  self.postMessage(msg);
}, 100);

setInterval(() => {
  void flushBatch();
}, 500);

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
self.onmessage = (evt: MessageEvent<WorkerInbound>) => {
  const msg = evt.data;
  switch (msg.kind) {
    case "CONFIG":
      PATIENT_ID = msg.patientId;
      API_BASE = msg.apiBase;
      windowStartMs = Date.now();
      break;
    case "AUDIO":
      ingestAudio(msg.frame);
      break;
    case "FACE":
      ingestFace(msg.frame);
      break;
    case "MOTION":
      ingestMotion(msg.frame);
      break;
    case "POINTER":
      ingestPointer(msg.frame);
      break;
  }
};

export {}; // make this a module so TypeScript types resolve
