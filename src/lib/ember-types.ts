export type TriggerCategory =
  | "Auditory overstimulation"
  | "Social crowding"
  | "Sudden acoustic shock"
  | "Sustained low-frequency stress"
  | "Mixed environment"
  | "Custom";

export type ProfileMetrics = {
  spectral_flux_threshold: number;     // 0-1
  mfcc_anomaly_score: number;          // 0-1
  spectral_centroid: number;           // Hz
  zcr_baseline: number;                // 0-1
  breath_rate_ceiling: number;         // /min
  pitch_variance_max: number;          // Hz
  anomaly_sensitivity: number;         // 0-1
};

export type RadarMetrics = {
  spectral_flux: number;
  mfcc_deviation: number;
  pitch_escalation: number;
  breath_rate: number;
  spectral_centroid: number;
  zcr_density: number;
};

export type Profile = {
  id: string;
  patient_id: string;
  name: string; // PTSD-AUD-003
  trigger_category: TriggerCategory;
  description: string;
  metrics: ProfileMetrics;
  safe_radar: RadarMetrics;
  danger_radar: RadarMetrics;
  active: boolean;
  updated_at: string;
};

export type EpisodeEvent = {
  id: string;
  profile_id: string;
  patient_id: string;
  timestamp: string;
  reasoning: string;
  peak_db: number;
  peak_anomaly: number;
};

export type Patient = {
  id: string;
  name: string;
  initials: string;
  dob: string;
  condition: string;
  clinician: string;
  accent: "teal" | "violet" | "coral";
  last_activity?: string;
};

export type ClinicalIncidentReport = {
  patient_id: string;
  incident_timestamp: string;
  estimated_severity_score: number;
  clinical_summary: string;
  recommended_followup: string;
  keywords: string[];
};
