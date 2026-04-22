import type { Patient, Profile, EpisodeEvent, RadarMetrics } from "./ember-types";

export const PATIENTS: Patient[] = [
  {
    id: "pat-mira",
    name: "Mira K.",
    initials: "MK",
    dob: "1987-04-12",
    condition: "PTSD · Auditory hypervigilance",
    clinician: "Dr. R. Halverson",
    accent: "teal",
    last_activity: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
  },
  {
    id: "pat-james",
    name: "James T.",
    initials: "JT",
    dob: "1992-09-30",
    condition: "Anxiety · Social crowding",
    clinician: "Dr. N. Okafor",
    accent: "violet",
    last_activity: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
  },
  {
    id: "pat-priya",
    name: "Priya S.",
    initials: "PS",
    dob: "1979-11-02",
    condition: "PTSD · Acoustic shock",
    clinician: "Dr. R. Halverson",
    accent: "coral",
    last_activity: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
];

const radar = (s: Partial<RadarMetrics>): RadarMetrics => ({
  spectral_flux: 50, mfcc_deviation: 50, pitch_escalation: 50,
  breath_rate: 50, spectral_centroid: 50, zcr_density: 50, ...s,
});

export const PROFILES: Profile[] = [
  {
    id: "prof-1", patient_id: "pat-mira", name: "PTSD-AUD-001",
    trigger_category: "Auditory overstimulation",
    description: "Crowded transit hub. Multiple overlapping voices, no clear exit line of sight.",
    metrics: { spectral_flux_threshold: 0.62, mfcc_anomaly_score: 0.78, spectral_centroid: 2400, zcr_baseline: 0.18, breath_rate_ceiling: 22, pitch_variance_max: 180, anomaly_sensitivity: 0.72 },
    safe_radar: radar({ spectral_flux: 28, mfcc_deviation: 22, pitch_escalation: 30, breath_rate: 35, spectral_centroid: 40, zcr_density: 25 }),
    danger_radar: radar({ spectral_flux: 86, mfcc_deviation: 80, pitch_escalation: 74, breath_rate: 78, spectral_centroid: 70, zcr_density: 82 }),
    active: true, updated_at: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
  },
  {
    id: "prof-2", patient_id: "pat-mira", name: "PTSD-AUD-002",
    trigger_category: "Sudden acoustic shock",
    description: "Sharp transient — alarm, dropped tray, slammed door above 4kHz.",
    metrics: { spectral_flux_threshold: 0.85, mfcc_anomaly_score: 0.91, spectral_centroid: 3800, zcr_baseline: 0.22, breath_rate_ceiling: 26, pitch_variance_max: 240, anomaly_sensitivity: 0.85 },
    safe_radar: radar({ spectral_flux: 30, mfcc_deviation: 28, pitch_escalation: 25, breath_rate: 32, spectral_centroid: 45, zcr_density: 30 }),
    danger_radar: radar({ spectral_flux: 92, mfcc_deviation: 88, pitch_escalation: 80, breath_rate: 70, spectral_centroid: 88, zcr_density: 78 }),
    active: false, updated_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
  {
    id: "prof-3", patient_id: "pat-james", name: "ANX-SOC-001",
    trigger_category: "Social crowding",
    description: "Sustained crowd murmur in waiting rooms or queues.",
    metrics: { spectral_flux_threshold: 0.48, mfcc_anomaly_score: 0.66, spectral_centroid: 1800, zcr_baseline: 0.12, breath_rate_ceiling: 20, pitch_variance_max: 140, anomaly_sensitivity: 0.6 },
    safe_radar: radar({ spectral_flux: 22, mfcc_deviation: 30, pitch_escalation: 28, breath_rate: 38, spectral_centroid: 32, zcr_density: 22 }),
    danger_radar: radar({ spectral_flux: 70, mfcc_deviation: 76, pitch_escalation: 64, breath_rate: 80, spectral_centroid: 58, zcr_density: 72 }),
    active: true, updated_at: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
  },
  {
    id: "prof-4", patient_id: "pat-james", name: "ANX-SOC-002",
    trigger_category: "Mixed environment",
    description: "Transit + lighting fluctuations together.",
    metrics: { spectral_flux_threshold: 0.55, mfcc_anomaly_score: 0.7, spectral_centroid: 2100, zcr_baseline: 0.15, breath_rate_ceiling: 21, pitch_variance_max: 160, anomaly_sensitivity: 0.65 },
    safe_radar: radar({ spectral_flux: 26, mfcc_deviation: 28, pitch_escalation: 32, breath_rate: 40, spectral_centroid: 38, zcr_density: 28 }),
    danger_radar: radar({ spectral_flux: 78, mfcc_deviation: 72, pitch_escalation: 70, breath_rate: 76, spectral_centroid: 64, zcr_density: 74 }),
    active: false, updated_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
  },
  {
    id: "prof-5", patient_id: "pat-priya", name: "PTSD-SHK-001",
    trigger_category: "Sudden acoustic shock",
    description: "High-frequency transient events, esp. metal-on-metal.",
    metrics: { spectral_flux_threshold: 0.88, mfcc_anomaly_score: 0.93, spectral_centroid: 4200, zcr_baseline: 0.24, breath_rate_ceiling: 28, pitch_variance_max: 260, anomaly_sensitivity: 0.9 },
    safe_radar: radar({ spectral_flux: 32, mfcc_deviation: 30, pitch_escalation: 28, breath_rate: 36, spectral_centroid: 48, zcr_density: 34 }),
    danger_radar: radar({ spectral_flux: 94, mfcc_deviation: 90, pitch_escalation: 86, breath_rate: 74, spectral_centroid: 92, zcr_density: 84 }),
    active: true, updated_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: "prof-6", patient_id: "pat-priya", name: "PTSD-LOW-001",
    trigger_category: "Sustained low-frequency stress",
    description: "HVAC drone, generator hum, sub-bass over long durations.",
    metrics: { spectral_flux_threshold: 0.4, mfcc_anomaly_score: 0.6, spectral_centroid: 800, zcr_baseline: 0.08, breath_rate_ceiling: 18, pitch_variance_max: 90, anomaly_sensitivity: 0.55 },
    safe_radar: radar({ spectral_flux: 20, mfcc_deviation: 24, pitch_escalation: 22, breath_rate: 30, spectral_centroid: 26, zcr_density: 18 }),
    danger_radar: radar({ spectral_flux: 60, mfcc_deviation: 70, pitch_escalation: 50, breath_rate: 72, spectral_centroid: 36, zcr_density: 58 }),
    active: false, updated_at: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
];

const REASONINGS = [
  "Anomaly score exceeded 0.87. Primary drivers: spectral flux +340%, pitch escalation, elevated breath rate. Intervention: auditory grounding initiated.",
  "MFCC deviation crossed threshold. Sustained crowd murmur for 42s with rising voice count. Intervention: paced breathing prompt.",
  "Sharp transient at 3.8kHz detected. ZCR density spike consistent with acoustic shock. Intervention: orienting cue + safe-window guidance.",
  "Compound trigger: low-frequency drone + voice overlap. Anomaly trajectory rising 18%/min. Intervention: corridor relocation suggested.",
];

export const EPISODES: EpisodeEvent[] = Array.from({ length: 14 }).map((_, i) => {
  const prof = PROFILES[i % PROFILES.length];
  return {
    id: `ep-${i}`,
    profile_id: prof.id,
    patient_id: prof.patient_id,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * (i * 7 + Math.random() * 5)).toISOString(),
    reasoning: REASONINGS[i % REASONINGS.length],
    peak_db: 78 + Math.floor(Math.random() * 14),
    peak_anomaly: +(0.78 + Math.random() * 0.2).toFixed(2),
  };
});

export const FEATURE_EXPLAINERS = [
  { key: "spectral_flux", name: "Spectral Flux", icon: "Waves", desc: "Rate of change in the sound's frequency content — proxy for sudden environmental shifts." },
  { key: "mfcc_deviation", name: "MFCC Deviation", icon: "Activity", desc: "Distance from the patient's calm acoustic fingerprint, summarizing timbre anomalies." },
  { key: "pitch_escalation", name: "Pitch Escalation", icon: "TrendingUp", desc: "Upward drift in fundamental frequency of nearby voices — early stress marker." },
  { key: "breath_rate", name: "Breath Rate", icon: "Wind", desc: "Estimated respiration cycles per minute from low-frequency body-coupled audio." },
  { key: "spectral_centroid", name: "Spectral Centroid", icon: "Crosshair", desc: "Center of mass of the spectrum — perceived 'brightness' of the environment." },
  { key: "zcr_density", name: "ZCR Density", icon: "Zap", desc: "Zero-crossing rate per window — captures sharp transients like alarms or impacts." },
] as const;
