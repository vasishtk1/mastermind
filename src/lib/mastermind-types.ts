/**
 * MasterMind / DoctorPayload — biometrics.audio (iOS → Convex).
 * Aligns with device-reported incident payloads used for benchmarking & validation.
 */
export interface MasterMindAudioBiometrics {
  breath_rate: number;
  duration_sec: number;
  fundamental_frequency_hz: number;
  jitter_approx: number;
  mfcc_1_to_13: number[];
  mfcc_deviation: number;
  pitch_escalation: number;
  rms: number;
  sample_rate_hz: number;
  shimmer_approx: number;
  spectral_centroid: number;
  spectral_flux: number;
  spectral_rolloff: number;
  zcr_density: number;
}

export interface MasterMindBiometrics {
  audio: MasterMindAudioBiometrics;
}

/** Top-level payload the app sends (minimal; extend as you add face / IMU). */
export interface MasterMindIncidentPayload {
  patientId: string;
  patientName?: string;
  biometrics: MasterMindBiometrics;
}
