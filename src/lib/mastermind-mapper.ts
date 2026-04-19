import type { MasterMindAudioBiometrics } from "./mastermind-types";
import type { TelemetryStats } from "./telemetry-types";

/** Map browser telemetry + dB chart value into a MasterMind-shaped audio row (approximate parity for Convex). */
export function telemetryToMasterMindAudio(
  stats: TelemetryStats,
  sessionSeconds: number,
  chartDb0to100: number | null,
): MasterMindAudioBiometrics {
  const rmsLinear =
    chartDb0to100 != null
      ? Math.max(0.001, Math.min(1, chartDb0to100 / 100))
      : Math.max(0.001, Math.min(1, (stats.rmsDb + 60) / 40));

  const mfccVec = Array.from({ length: 13 }, (_, i) =>
    i === 0 ? stats.spectralCentroid * 0.03 : Math.sin(i * 0.7) * stats.spectralFlux * 2,
  );

  return {
    breath_rate: 14 + Math.min(12, stats.spectralFlux * 40),
    duration_sec: Math.max(0.5, sessionSeconds),
    fundamental_frequency_hz: stats.f0Hz > 0 ? stats.f0Hz : 72,
    jitter_approx: 0.15 + Math.min(0.2, stats.zcr / 20_000),
    mfcc_1_to_13: mfccVec,
    mfcc_deviation: Math.min(20, Math.max(0, stats.spectralFlux * 12 + stats.zcr / 500)),
    pitch_escalation: stats.f0Hz > 180 ? 1 : 0,
    rms: rmsLinear,
    sample_rate_hz: 44100,
    shimmer_approx: 0.18 + Math.min(0.15, stats.spectralFlux),
    spectral_centroid: Math.max(200, stats.spectralCentroid),
    spectral_flux: Math.min(1, Math.max(0, stats.spectralFlux)),
    spectral_rolloff: Math.min(8000, stats.spectralCentroid * 1.8),
    zcr_density: Math.min(1, stats.zcr / 8000),
  };
}
