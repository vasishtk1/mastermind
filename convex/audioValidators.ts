import { v } from "convex/values";

/** Patient card accent (shared by `schema` + `patients` mutation). */
export const patientAccent = v.union(
  v.literal("teal"),
  v.literal("violet"),
  v.literal("coral"),
);

/** Single MasterMind / DoctorPayload biometrics.audio block (16 kHz pipeline). */
export const audioBiometricsValue = v.object({
  breath_rate: v.number(),
  duration_sec: v.number(),
  fundamental_frequency_hz: v.number(),
  jitter_approx: v.number(),
  mfcc_1_to_13: v.array(v.number()),
  mfcc_deviation: v.number(),
  pitch_escalation: v.number(),
  rms: v.number(),
  sample_rate_hz: v.number(),
  shimmer_approx: v.number(),
  spectral_centroid: v.number(),
  spectral_flux: v.number(),
  spectral_rolloff: v.number(),
  zcr_density: v.number(),
});
