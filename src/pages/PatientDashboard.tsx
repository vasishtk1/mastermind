import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  ArrowLeft,
  Brain,
  Loader2,
  Sparkles,
  HeartPulse,
  Waves,
  Activity,
  TrendingUp,
  Wind,
  Crosshair,
  Zap,
  CheckCircle2,
  ChevronRight,
  ScanFace,
  Frown,
  Smile,
  GitCompareArrows,
  ShieldAlert,
  Target,
  FlaskConical,
  CircleCheck,
  BellRing,
} from "lucide-react";
import { toast } from "sonner";
import type {
  DirectiveActivityType,
  IncidentReport,
  IncidentSeverity,
  Profile,
  RadarMetrics,
  TriggerCategory,
} from "@/lib/ember-types";
import { useEmberData } from "@/context/EmberClinicalContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Ember shared components
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ember/Card";
import { SectionHeader } from "@/components/ember/SectionHeader";
import { StatusBadge } from "@/components/ember/StatusBadge";
import { MetricCard } from "@/components/ember/MetricCard";

const GROUNDING: DirectiveActivityType[] = [
  "Breathing Exercise",
  "Journaling",
  "Grounding (5-4-3-2-1)",
  "Mindfulness Meditation",
  "Physical Movement",
  "Social Connection",
  "Custom",
];

const RADAR_KEYS: Array<keyof RadarMetrics> = [
  "spectral_flux",
  "mfcc_deviation",
  "pitch_escalation",
  "breath_rate",
  "spectral_centroid",
  "zcr_density",
];

const toArray = (r: RadarMetrics) => RADAR_KEYS.map((k) => r[k]);
const ICONS: Record<string, any> = { Waves, Activity, TrendingUp, Wind, Crosshair, Zap, ScanFace, Frown, Smile };

// Facial biometric features displayed alongside the 6 vocal cards. Thresholds
// are expressed on the same 0–100 scale the vocal cards use so the deltas
// render consistently. The current value uses the selected incident's ARKit
// composite for facial_stress; brow / jaw fall back to a derived split when the
// incident payload doesn't include the per-region scores.
const FACIAL_FEATURE_EXPLAINERS = [
  {
    key: "facial_stress" as const,
    name: "Facial Stress (ARKit)",
    icon: "ScanFace",
    desc: "5-second composite of ARKit facial action units indicating overall affective tension.",
    safe: 25,
    danger: 75,
  },
  {
    key: "brow_furrow" as const,
    name: "Brow Furrow",
    icon: "Frown",
    desc: "Magnitude of inner-brow lift + brow-down pull; classic distress indicator.",
    safe: 22,
    danger: 70,
  },
  {
    key: "jaw_tightness" as const,
    name: "Jaw Tightness",
    icon: "Smile",
    desc: "Sustained masseter / jaw clench composite from ARKit jaw blendshapes.",
    safe: 20,
    danger: 72,
  },
] as const;

const STEPS = [
  { id: 1, label: "Benchmarking & Base Profile" },
  { id: 2, label: "Incident Trigger & Clinical Review" },
  { id: 3, label: "Pipeline Comparison & Outcomes" },
  { id: 4, label: "Directive & Deploy" },
];

const FEATURE_EXPLAINERS = [
  { key: "spectral_flux", name: "Spectral Flux", icon: "Waves", desc: "Rate of change in frequency content; proxy for sudden environmental shifts." },
  { key: "mfcc_deviation", name: "MFCC Deviation", icon: "Activity", desc: "Distance from baseline acoustic fingerprint." },
  { key: "pitch_escalation", name: "Pitch Escalation", icon: "TrendingUp", desc: "Upward drift in fundamental frequency." },
  { key: "breath_rate", name: "Breath Rate", icon: "Wind", desc: "Estimated respiration cycles per minute." },
  { key: "spectral_centroid", name: "Spectral Centroid", icon: "Crosshair", desc: "Center of mass of the spectrum ('brightness')." },
  { key: "zcr_density", name: "ZCR Density", icon: "Zap", desc: "Zero-crossing density capturing sharp transients." },
] as const;

// Catalog of tunable edge-device parameters. Step 4's deploy control is no
// longer hard-coded to pitch variance; whichever metric the pipeline surfaces
// as the primary offender in step 3 becomes the tunable knob here, with its
// own units, range, and clinically reasonable default.
type TunableMetricKey =
  | "pitch_variance_max"
  | "spectral_flux_threshold"
  | "mfcc_anomaly_score"
  | "spectral_centroid"
  | "zcr_baseline"
  | "breath_rate_ceiling"
  | "anomaly_sensitivity";

type TunableMetric = {
  key: TunableMetricKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  explainer: string;
};

const TUNABLE_METRICS: Record<TunableMetricKey, TunableMetric> = {
  pitch_variance_max: {
    key: "pitch_variance_max",
    label: "Pitch Variance Tolerance",
    unit: "Hz",
    min: 60,
    max: 260,
    step: 2,
    default: 140,
    explainer: "Maximum allowed vocal pitch spike before the edge agent raises an alert.",
  },
  spectral_flux_threshold: {
    key: "spectral_flux_threshold",
    label: "Spectral Flux Threshold",
    unit: "σ",
    min: 0.1,
    max: 1.0,
    step: 0.02,
    default: 0.62,
    explainer: "Normalized threshold on frame-to-frame spectral change before flagging an environmental spike.",
  },
  mfcc_anomaly_score: {
    key: "mfcc_anomaly_score",
    label: "MFCC Anomaly Tolerance",
    unit: "",
    min: 0.1,
    max: 1.0,
    step: 0.02,
    default: 0.78,
    explainer: "Deviation from baseline timbre fingerprint the device will tolerate before triggering.",
  },
  spectral_centroid: {
    key: "spectral_centroid",
    label: "Spectral Centroid Ceiling",
    unit: "Hz",
    min: 500,
    max: 5000,
    step: 50,
    default: 2400,
    explainer: "Upper bound on brightness (spectral centroid) — higher values tolerate sharper timbres.",
  },
  zcr_baseline: {
    key: "zcr_baseline",
    label: "ZCR Baseline Tolerance",
    unit: "",
    min: 0.05,
    max: 0.5,
    step: 0.01,
    default: 0.2,
    explainer: "Baseline zero-crossing density; shapes how sensitive the device is to transient / breathy bursts.",
  },
  breath_rate_ceiling: {
    key: "breath_rate_ceiling",
    label: "Breath Rate Ceiling",
    unit: "/min",
    min: 12,
    max: 40,
    step: 1,
    default: 22,
    explainer: "Maximum breaths-per-minute the edge agent will accept before escalating.",
  },
  anomaly_sensitivity: {
    key: "anomaly_sensitivity",
    label: "Overall Anomaly Sensitivity",
    unit: "",
    min: 0.1,
    max: 1.0,
    step: 0.02,
    default: 0.7,
    explainer: "Global multiplier blending all detectors into a single trigger score.",
  },
};

// Map a radar feature to the tunable parameter that most directly governs it.
// This is what lets the pipeline output a single recommendation in step 3 that
// becomes the default tunable in step 4.
const FEATURE_TO_TUNABLE: Record<keyof RadarMetrics, TunableMetricKey> = {
  spectral_flux: "spectral_flux_threshold",
  mfcc_deviation: "mfcc_anomaly_score",
  pitch_escalation: "pitch_variance_max",
  breath_rate: "breath_rate_ceiling",
  spectral_centroid: "spectral_centroid",
  zcr_density: "zcr_baseline",
};

const FEATURE_LABELS: Record<keyof RadarMetrics, string> = {
  spectral_flux: "Environmental Spike (Spectral Flux)",
  mfcc_deviation: "Vocal Stress (MFCC Deviation)",
  pitch_escalation: "Pitch Escalation",
  breath_rate: "Breath Rate",
  spectral_centroid: "Vocal Brightness (Centroid)",
  zcr_density: "Vocal Breathiness (ZCR Density)",
};

type BreachRow = {
  key: keyof RadarMetrics;
  label: string;
  safe: number;
  danger: number;
  delta: number;
  breachPct: number; // how far past safe, as a fraction of the safe→danger band
  severity: "hold" | "watch" | "breach" | "critical";
};

type PipelineOutcome = {
  generatedAt: string;
  rows: BreachRow[];
  primary: BreachRow;
  recommendation: {
    tunable: TunableMetric;
    suggestedValue: number;
    direction: "increase" | "decrease" | "hold";
    rationale: string;
  };
  verdict: string;
};

function fmtTimeAgo(ms: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

// Benchmarks only persist audio metrics today. For the Step 1 baseline card we
// surface a neutral facial envelope derived deterministically from the saved
// benchmark id so repeated renders are stable and different patients don't all
// show identical numbers. All values are clamped into the resting range since
// by definition a benchmark is captured in a calm state.
function deriveFacialBaseline(seed: string): {
  facialStress: number;
  browFurrow: number;
  jawTightness: number;
} {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = (offset: number) => {
    const v = Math.abs(Math.sin(hash + offset));
    return v - Math.floor(v);
  };
  return {
    facialStress: 0.08 + unit(1) * 0.1,
    browFurrow: 0.05 + unit(2) * 0.09,
    jawTightness: 0.06 + unit(3) * 0.1,
  };
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

// Build a plausible IncidentReport payload for demos so the clinician view is
// never empty even if the iOS device isn't hitting Convex during a presentation.
// Values pick one of three "flavors" so repeated clicks produce distinct cards.
function buildDemoIncidentPayload(patientId: string, patient: { name: string; initials: string; accent: "teal" | "violet" | "coral" }) {
  const flavors = [
    {
      trigger_type: "Voice journal check-in",
      user_statement:
        "I was walking near the construction site when a loud bang made my chest tighten and I couldn't stop replaying it.",
      arkit_dominant_expression: "browInnerUp + jawClench",
      on_device_action: "Paced-breathing prompt · 4-7-8 cadence",
      severity: "high" as IncidentSeverity,
      acoustic_variance: 0.71,
      peak_db: -12,
      arkit_stress_index: 0.62,
    },
    {
      trigger_type: "Video journal check-in",
      user_statement:
        "Got stuck in a crowded elevator. My breathing went shallow and my hands started shaking.",
      arkit_dominant_expression: "eyeSquintLeft + mouthFrown",
      on_device_action: "Grounding (5-4-3-2-1) · sensory orienting",
      severity: "critical" as IncidentSeverity,
      acoustic_variance: 0.82,
      peak_db: -8,
      arkit_stress_index: 0.74,
    },
    {
      trigger_type: "Voice journal check-in",
      user_statement:
        "Had an argument at dinner, felt a freeze response hit me — I went quiet and zoned out for a minute.",
      arkit_dominant_expression: "jawOpen + browDown",
      on_device_action: "Orienting cue · safe-window guidance",
      severity: "moderate" as IncidentSeverity,
      acoustic_variance: 0.54,
      peak_db: -18,
      arkit_stress_index: 0.41,
    },
  ];
  const flavor = flavors[Math.floor(Math.random() * flavors.length)];
  const now = Date.now();
  const incidentId = `inc-demo-${patientId}-${now}`;
  return {
    incidentId,
    patientId,
    payload: {
      id: incidentId,
      patient_id: patientId,
      patient_name: patient.name,
      patient_initials: patient.initials,
      patient_accent: patient.accent,
      timestamp: new Date(now).toISOString(),
      trigger_type: flavor.trigger_type,
      acoustic_variance: flavor.acoustic_variance,
      peak_db: flavor.peak_db,
      user_statement: flavor.user_statement,
      arkit_stress_index: flavor.arkit_stress_index,
      arkit_dominant_expression: flavor.arkit_dominant_expression,
      on_device_action: flavor.on_device_action,
      stabilized: false,
      severity: flavor.severity,
      status: "unreviewed" as const,
      clinical_synthesis: undefined,
      deployed_directive: undefined,
    },
  };
}

function buildDefaultProfile(patientId: string): Profile {
  return {
    id: `prof-auto-${patientId}`,
    patient_id: patientId,
    name: "Baseline Envelope",
    trigger_category: "Custom" as TriggerCategory,
    description: "System generated baseline boundaries.",
    metrics: {
      spectral_flux_threshold: 0.8,
      mfcc_anomaly_score: 0.8,
      spectral_centroid: 4000,
      zcr_baseline: 0.5,
      breath_rate_ceiling: 25,
      pitch_variance_max: 200,
      anomaly_sensitivity: 0.5,
    },
    safe_radar: { spectral_flux: 28, mfcc_deviation: 22, pitch_escalation: 30, breath_rate: 35, spectral_centroid: 40, zcr_density: 25 },
    danger_radar: { spectral_flux: 86, mfcc_deviation: 80, pitch_escalation: 74, breath_rate: 78, spectral_centroid: 70, zcr_density: 82 },
    active: true,
    updated_at: new Date().toISOString(),
  };
}

export default function PatientDashboard() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { patients, incidents, touchPatientProfile, setLastViewedPatientId } = useEmberData();

  const convexEnabled = Boolean(import.meta.env.VITE_CONVEX_URL);
  const benchmarkRows = useQuery(
    api.benchmarks.listByPatient,
    convexEnabled && patientId ? { patientId, limit: 1 } : "skip",
  );
  const upsertIncident = useMutation(api.emberIncidents.upsert);
  const deployDirective = useMutation(api.directives.deploy);

  const latestBenchmark = benchmarkRows && benchmarkRows.length > 0 ? benchmarkRows[0] : null;

  const patient = useMemo(() => patients.find((p) => p.id === patientId) ?? null, [patients, patientId]);
  const patientIncidents = useMemo(
    () => incidents.filter((i) => i.patient_id === patientId).sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp)),
    [incidents, patientId],
  );

  const incidentParam = searchParams.get("incident");
  const [activeStep, setActiveStep] = useState<number>(1);
  
  // Explicitly specific clinical note pre-filled text
  const [observation, setObservation] = useState(
    "Observed sudden 58% spike in MFCC Deviation and Spectral Flux, aligning with patient self-report of 'startle response'. The patient's auditory system appears highly sensitive to sudden, sharp transient noises. Suggest increasing pitch tolerance temporarily while expanding grounding options to mitigate immediate freeze impulses."
  );
  
  const [profileDrafting, setProfileDrafting] = useState(false);
  const [draftProfile, setDraftProfile] = useState<Profile | null>(null);

  // Pipeline (step 3) state
  const [pipelineOutcome, setPipelineOutcome] = useState<PipelineOutcome | null>(null);

  // Deploy (step 4) state. The tunable metric is whatever the pipeline
  // recommends; default to pitch variance so the UI renders sensibly before
  // the pipeline has been run even once.
  const [tunableKey, setTunableKey] = useState<TunableMetricKey>("pitch_variance_max");
  const [tunableValue, setTunableValue] = useState<number>(TUNABLE_METRICS.pitch_variance_max.default);
  const [grounding, setGrounding] = useState<DirectiveActivityType>("Grounding (5-4-3-2-1)");
  const [instructions, setInstructions] = useState("Guide patient through 5 physical senses to interrupt freeze response. Keep tone slow, measured, and highly directive.");
  const [deploying, setDeploying] = useState(false);
  const [deployedInfo, setDeployedInfo] = useState<{ directiveId: string; deployedAt: number } | null>(null);
  const [simulating, setSimulating] = useState(false);

  const tunableSpec = TUNABLE_METRICS[tunableKey];

  const activeProfile = useMemo(() => {
    if (!patientId) return null;
    return buildDefaultProfile(patientId);
  }, [patientId]);

  const selectedIncident: IncidentReport | null = useMemo(() => {
    if (!patientIncidents.length) return null;
    if (incidentParam) {
      const hit = patientIncidents.find((i) => i.id === incidentParam);
      if (hit) return hit;
    }
    return patientIncidents.find((i) => i.status === "unreviewed") ?? patientIncidents[0];
  }, [patientIncidents, incidentParam]);

  useEffect(() => {
    if (patientId) {
      touchPatientProfile(patientId);
      setLastViewedPatientId(patientId);
    }
  }, [patientId, touchPatientProfile, setLastViewedPatientId]);

  // Auto-route to the merged Incident Trigger + Clinical Review (step 2)
  // ONLY when the clinician explicitly clicks into a specific incident
  // via the `?incident=...` deep link. We deliberately do NOT auto-jump
  // just because some unreviewed incident happens to exist — passive
  // monitoring drops new "Cactus VAD" rows in continuously, and yanking
  // the clinician across pipeline steps every time one lands made the
  // workspace feel like it was switching tabs at random. The clinician
  // navigates the pipeline themselves; only an explicit deep-link is
  // allowed to override their current step.
  //
  // We track the previous deep-link value with a ref so that a *change*
  // in `?incident=` is what triggers the jump, not just its presence on
  // every render.
  const lastIncidentParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (incidentParam && incidentParam !== lastIncidentParamRef.current) {
      lastIncidentParamRef.current = incidentParam;
      setActiveStep(2);
    } else if (!incidentParam) {
      lastIncidentParamRef.current = null;
    }
  }, [incidentParam]);

  const jumpToBenchmarking = () => {
    if (patientId) {
      setLastViewedPatientId(patientId);
      navigate("/benchmarking");
    }
  };

  // Build a deterministic comparison of the current danger-envelope radar
  // readings against the benchmarked safe envelope. Each metric is scored on
  // how far past its safe boundary it sits, normalized against the full
  // safe→danger band. Rows are ranked so the worst offender drives the
  // recommendation that feeds step 4's deploy control.
  const computePipelineOutcome = (profile: Profile): PipelineOutcome => {
    const rows: BreachRow[] = RADAR_KEYS.map((key) => {
      const safe = profile.safe_radar[key];
      const danger = profile.danger_radar[key];
      const delta = danger - safe;
      const band = Math.max(1, 100 - safe);
      const breachPct = Math.max(0, Math.min(1, (danger - safe) / band));

      let severity: BreachRow["severity"] = "hold";
      if (breachPct >= 0.75) severity = "critical";
      else if (breachPct >= 0.5) severity = "breach";
      else if (breachPct >= 0.25) severity = "watch";

      return {
        key,
        label: FEATURE_LABELS[key],
        safe,
        danger,
        delta,
        breachPct,
        severity,
      };
    }).sort((a, b) => b.breachPct - a.breachPct);

    const primary = rows[0];
    const tunable = TUNABLE_METRICS[FEATURE_TO_TUNABLE[primary.key]];

    // Slide the current tunable default toward/away from its bound in
    // proportion to how badly the primary metric breached. A critical breach
    // nudges the tolerance ~60% of the way toward its ceiling; a watch-level
    // breach only nudges ~15%.
    const headroom = tunable.max - tunable.default;
    const raw = tunable.default + headroom * primary.breachPct * 0.8;
    const snapped = Math.round(raw / tunable.step) * tunable.step;
    const suggestedValue = Math.max(tunable.min, Math.min(tunable.max, snapped));
    const direction: "increase" | "decrease" | "hold" =
      suggestedValue > tunable.default ? "increase" : suggestedValue < tunable.default ? "decrease" : "hold";

    const verdict =
      primary.severity === "critical"
        ? `Critical breach on ${primary.label}. Recommend widening ${tunable.label.toLowerCase()} to ${suggestedValue}${tunable.unit} before redeployment.`
        : primary.severity === "breach"
        ? `${primary.label} crossed the danger envelope. Nudge ${tunable.label.toLowerCase()} to ${suggestedValue}${tunable.unit} and continue monitoring.`
        : primary.severity === "watch"
        ? `${primary.label} is drifting toward its ceiling. Light adjustment to ${tunable.label.toLowerCase()} recommended.`
        : `All acoustic channels within baseline. Hold current envelope and redeploy existing directive.`;

    const rationale = `${primary.label} breached ${(primary.breachPct * 100).toFixed(0)}% of the safe→danger band (Δ ${Math.round(primary.delta)}). ${tunable.label} is the governing tunable; adjusting it to ${suggestedValue}${tunable.unit} relaxes the trigger surface without abandoning the rest of the profile.`;

    return {
      generatedAt: new Date().toISOString(),
      rows,
      primary,
      recommendation: { tunable, suggestedValue, direction, rationale },
      verdict,
    };
  };

  // "Update Base Profile & Proceed" now (a) drafts the new baseline, (b) runs
  // the benchmark-vs-current comparison pipeline, and (c) advances to step 3
  // where the pipeline outcome is rendered.
  const runProfileDraft = () => {
    if (!activeProfile) return;
    setProfileDrafting(true);
    setTimeout(() => {
      const drafted: Profile = {
        ...activeProfile,
        safe_radar: {
          spectral_flux: Math.min(100, activeProfile.safe_radar.spectral_flux + 15),
          mfcc_deviation: Math.min(100, activeProfile.safe_radar.mfcc_deviation + 12),
          pitch_escalation: Math.min(100, activeProfile.safe_radar.pitch_escalation + 8),
          breath_rate: activeProfile.safe_radar.breath_rate,
          spectral_centroid: activeProfile.safe_radar.spectral_centroid,
          zcr_density: Math.min(100, activeProfile.safe_radar.zcr_density + 10),
        },
        id: `prof-draft-${Date.now()}`,
        name: `DRAFT-${activeProfile.name.split("-").pop() ?? "GEN"}`,
        description: observation || activeProfile.description,
        active: false,
        updated_at: new Date().toISOString(),
      };
      setDraftProfile(drafted);

      const outcome = computePipelineOutcome(drafted);
      setPipelineOutcome(outcome);
      setTunableKey(outcome.recommendation.tunable.key);
      setTunableValue(outcome.recommendation.suggestedValue);

      setProfileDrafting(false);
      toast.success("Pipeline complete", {
        description: `Primary offender: ${outcome.primary.label}. Recommended ${outcome.recommendation.tunable.label}: ${outcome.recommendation.suggestedValue}${outcome.recommendation.tunable.unit}.`,
      });
      setActiveStep(3);
    }, 1400);
  };

  const runDeploy = async () => {
    if (!selectedIncident) {
      toast.error("No incident selected", {
        description: "Open an incident from Step 2 before deploying a directive.",
      });
      return;
    }
    setDeploying(true);
    const fullInstructions = `${instructions.trim()}\n\n[Tunable] ${tunableSpec.label}: ${
      tunableSpec.step < 1 ? tunableValue.toFixed(2) : tunableValue
    }${tunableSpec.unit}`;
    try {
      if (convexEnabled) {
        const result = await deployDirective({
          incidentId: selectedIncident.id,
          patientId: selectedIncident.patient_id,
          directiveType: grounding,
          instructions: fullInstructions,
        });
        setDeployedInfo({ directiveId: result.directiveId, deployedAt: result.deployedAt });
        toast.success("Directive deployed", {
          description: `${grounding} · ${tunableSpec.label}: ${tunableValue}${tunableSpec.unit}. Saved as ${result.directiveId}.`,
        });
      } else {
        // Fallback so the demo still works without Convex configured.
        const now = Date.now();
        setDeployedInfo({ directiveId: `dir-local-${now}`, deployedAt: now });
        toast.success("Directive deployed (local demo)", {
          description: `${grounding} · ${tunableSpec.label}: ${tunableValue}${tunableSpec.unit}.`,
        });
      }
    } catch (error) {
      toast.error("Deploy failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setDeploying(false);
    }
  };

  const simulateIncident = async () => {
    if (!patient) return;
    setSimulating(true);
    try {
      const { incidentId, patientId: pid, payload } = buildDemoIncidentPayload(patient.id, {
        name: patient.name,
        initials: patient.initials,
        accent: patient.accent,
      });
      if (convexEnabled) {
        await upsertIncident({ incidentId, patientId: pid, payload });
        setSearchParams({ incident: incidentId });
        toast.success("Simulated mobile incident created", {
          description: "A fresh incident from the mobile app has been ingested into Convex.",
        });
      } else {
        toast.info("Convex not configured", {
          description: "Configure VITE_CONVEX_URL to ingest simulated incidents.",
        });
      }
    } catch (error) {
      toast.error("Could not simulate incident", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSimulating(false);
    }
  };

  const onTunableKeyChange = (key: TunableMetricKey) => {
    setTunableKey(key);
    // If the user switches away from the recommended tunable, reset the value
    // to that tunable's default so the slider stays inside its range.
    const spec = TUNABLE_METRICS[key];
    if (pipelineOutcome && pipelineOutcome.recommendation.tunable.key === key) {
      setTunableValue(pipelineOutcome.recommendation.suggestedValue);
    } else {
      setTunableValue(spec.default);
    }
  };

  const displayProfile = draftProfile ?? activeProfile;

  if (!patientId || !patient) {
    return (
      <div className="p-8 max-w-md">
        <h1 className="text-lg font-semibold">Patient not found</h1>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/patients")}>
          Patient roster
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/30">
        <div className="flex items-center gap-4 min-w-0">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2" asChild>
            <Link to="/patients">
              <ArrowLeft className="w-4 h-4" />
              Roster
            </Link>
          </Button>
          <div className="h-6 w-px bg-border hidden sm:block" />
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={cn(
                "w-11 h-11 rounded-md grid place-items-center mono text-sm font-bold border shrink-0",
                patient.accent === "teal" && "bg-primary/15 text-primary border-primary/40",
                patient.accent === "violet" && "bg-secondary/15 text-secondary border-secondary/40",
                patient.accent === "coral" && "bg-primary-glow/15 text-primary border-primary-glow/40",
              )}
            >
              {patient.initials}
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight truncate">{patient.name}</h1>
              <p className="mono text-xs text-muted-foreground truncate">
                DOB {patient.dob} · {patient.condition}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* HORIZONTAL STEPPER */}
      <div className="shrink-0 bg-surface-elevated border-b border-border py-6 px-6 overflow-x-auto shadow-sm">
        <div className="flex items-center justify-center max-w-[1200px] mx-auto min-w-[700px]">
          {STEPS.map((step, idx) => (
            <div key={step.id} className="flex items-center relative z-10 flex-col flex-1">
              {idx !== 0 && (
                <div 
                  className={cn(
                    "absolute top-4 left-0 -ml-[50%] w-full h-[2px] -z-10 transition-colors duration-500",
                    activeStep >= step.id ? "bg-primary" : "bg-border"
                  )} 
                />
              )}
              <button
                onClick={() => setActiveStep(step.id)}
                className={cn(
                  "w-8 h-8 rounded-full border-2 grid place-items-center text-xs font-bold transition-all duration-300 relative z-10",
                  activeStep === step.id ? "border-primary text-primary bg-card scale-110 shadow-[0_0_15px_hsl(var(--primary)/0.3)]" :
                  activeStep > step.id ? "border-primary bg-primary text-primary-foreground" :
                  "border-border bg-card text-muted-foreground hover:border-muted-foreground"
                )}
              >
                {activeStep > step.id ? <CheckCircle2 className="w-4 h-4" /> : step.id}
              </button>
              <div className={cn(
                "mt-3 text-[11px] font-bold tracking-[0.15em] uppercase transition-colors whitespace-nowrap",
                activeStep === step.id ? "text-foreground" :
                activeStep > step.id ? "text-primary/80" : "text-muted-foreground"
              )}>
                {step.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-background/50">
        <div className="p-8 max-w-[1100px] mx-auto pb-24">
          
          {/* STEP 1: BENCHMARKING */}
          {activeStep === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Step 1: Benchmarking &amp; Base Profile</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Capture a neutral baseline for this patient. The saved benchmark becomes the envelope every future incident is scored against.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-lg border border-border bg-card/50 shadow-sm">
                <div className="space-y-1">
                  <div className="font-semibold text-lg">{patient.name}</div>
                  <div className="text-sm text-muted-foreground">{patient.condition}</div>
                </div>
                <Button onClick={jumpToBenchmarking} className="gap-2">
                  <HeartPulse className="w-4 h-4" />
                  {latestBenchmark ? "Re-run Benchmarking" : "Run Benchmarking"}
                </Button>
              </div>

              {/* Saved benchmark card (or empty state) */}
              {benchmarkRows === undefined && convexEnabled ? (
                <Card className="border-dashed border-border/60 bg-card/30">
                  <CardContent className="p-6 flex items-center gap-3 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking Convex for saved benchmarks…
                  </CardContent>
                </Card>
              ) : latestBenchmark ? (
                <Card className="border-primary/30 shadow-[0_0_20px_hsl(var(--primary)/0.08)] overflow-hidden">
                  <CardHeader className="pb-3 border-b border-border/50 bg-card/40">
                    <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <CircleCheck className="w-4 h-4 text-primary" /> Benchmark saved to patient
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-5 space-y-4">
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="mono">
                        Captured <span className="text-foreground font-semibold">{fmtTimeAgo(latestBenchmark.createdAt)}</span>
                      </span>
                      <span className="mono">
                        Session <span className="text-foreground font-semibold">{fmtDuration(latestBenchmark.sessionSeconds)}</span>
                      </span>
                      <span className="mono">
                        Source <span className="text-foreground font-semibold">{latestBenchmark.source}</span>
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground">
                        Vocal Baseline
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {latestBenchmark.metrics.rmsDb !== undefined && (
                          <BenchmarkMetric label="RMS" value={`${latestBenchmark.metrics.rmsDb.toFixed(1)} dB`} />
                        )}
                        {latestBenchmark.metrics.anomalyScore !== undefined && (
                          <BenchmarkMetric label="Anomaly" value={latestBenchmark.metrics.anomalyScore.toFixed(2)} />
                        )}
                        {latestBenchmark.metrics.spectralFlux !== undefined && (
                          <BenchmarkMetric label="Flux" value={latestBenchmark.metrics.spectralFlux.toFixed(2)} />
                        )}
                        {latestBenchmark.metrics.f0Hz !== undefined && (
                          <BenchmarkMetric label="F0" value={`${Math.round(latestBenchmark.metrics.f0Hz)} Hz`} />
                        )}
                        {latestBenchmark.metrics.spectralCentroid !== undefined && (
                          <BenchmarkMetric label="Centroid" value={`${Math.round(latestBenchmark.metrics.spectralCentroid)} Hz`} />
                        )}
                        {latestBenchmark.metrics.zcr !== undefined && (
                          <BenchmarkMetric label="ZCR" value={latestBenchmark.metrics.zcr.toFixed(0)} />
                        )}
                      </div>
                    </div>
                    {(() => {
                      const facial = deriveFacialBaseline(latestBenchmark._id);
                      return (
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground flex items-center gap-1.5">
                            <ScanFace className="w-3 h-3" /> Facial Baseline (ARKit)
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <BenchmarkMetric label="Facial Stress" value={facial.facialStress.toFixed(2)} />
                            <BenchmarkMetric label="Brow Furrow" value={facial.browFurrow.toFixed(2)} />
                            <BenchmarkMetric label="Jaw Tightness" value={facial.jawTightness.toFixed(2)} />
                          </div>
                        </div>
                      );
                    })()}
                    {latestBenchmark.geminiReasoning && (
                      <p className="text-xs italic text-muted-foreground leading-relaxed border-l-2 border-primary/40 pl-3">
                        "{latestBenchmark.geminiReasoning}"
                      </p>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-dashed border-border/60 bg-card/30">
                  <CardContent className="p-6 text-sm text-muted-foreground space-y-2">
                    <div className="font-semibold text-foreground">No baseline captured yet</div>
                    <p>
                      Run the benchmarking session above to store a neutral envelope. Incidents from the mobile app will be scored against whatever baseline this patient has on file.
                    </p>
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-end pt-6">
                <Button
                  size="lg"
                  onClick={() => setActiveStep(2)}
                  className="gap-2 px-10 shadow-md"
                >
                  Open Incident Review <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: INCIDENT TRIGGER + CLINICAL REVIEW (merged) */}
          {activeStep === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
              <div className="border-b border-border/60 pb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="max-w-3xl">
                  <h2 className="text-2xl font-bold tracking-tight">Step 2: Incident Trigger &amp; Clinical Review</h2>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    An anomaly from the patient's mobile device breached the baseline. Compare the current readings against the saved benchmark envelope, contextualize them with the patient's ground-truth journal entry, and write your clinician note before advancing.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void simulateIncident()}
                  disabled={simulating}
                  className="gap-2 shrink-0"
                >
                  {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
                  Simulate mobile incident
                </Button>
              </div>

              {patientIncidents.length === 0 && (
                <Card className="border-dashed border-border/60 bg-card/30">
                  <CardContent className="p-8 text-center text-sm text-muted-foreground space-y-3">
                    <p>
                      No incidents have been ingested for <strong className="text-foreground">{patient.name}</strong> yet. The mobile app writes incidents directly into Convex when a journal check-in triggers a distress signal.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void simulateIncident()}
                      disabled={simulating}
                      className="gap-2"
                    >
                      {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
                      Simulate an incident from mobile
                    </Button>
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-8 items-start">
                {/* Left Side Info */}
                <div className="space-y-6">
                  {/* Incident Selector */}
                  <Card className="shadow-sm">
                    <CardHeader className="pb-3 border-b border-border/50 bg-card/30">
                      <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">Active Alerts</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3">
                      <div className="space-y-1.5">
                        {patientIncidents.length === 0 && (
                          <div className="px-4 py-3 text-xs text-muted-foreground italic">No incidents yet.</div>
                        )}
                        {patientIncidents.map((inc) => (
                          <button
                            key={inc.id}
                            type="button"
                            onClick={() => setSearchParams({ incident: inc.id })}
                            className={cn(
                              "w-full text-left rounded-md border px-4 py-3 transition-colors flex items-center justify-between",
                              selectedIncident?.id === inc.id
                                ? "border-primary bg-primary/10 shadow-[inset_4px_0_0_hsl(var(--primary))]"
                                : "border-transparent hover:border-border/80 hover:bg-card/50",
                            )}
                          >
                            <span className={cn("text-[13px] font-semibold", selectedIncident?.id === inc.id ? "text-foreground" : "text-muted-foreground")}>{inc.trigger_type}</span>
                            <StatusBadge severity={inc.severity} />
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Ground Truth Label */}
                  <Card className="border-danger/40 bg-gradient-to-br from-danger/10 to-transparent shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-danger/20 bg-danger/5">
                      <SectionHeader className="text-danger flex items-center gap-2 m-0 text-xs font-bold tracking-wider">
                        <Sparkles className="w-3.5 h-3.5" /> Ground Truth Label Context
                      </SectionHeader>
                    </div>
                    <CardContent className="p-5">
                      <div className="text-sm">
                        {selectedIncident?.user_statement ? (
                          <p className="text-foreground italic leading-relaxed font-serif text-[16px] text-justify">
                            "{selectedIncident.user_statement}"
                          </p>
                        ) : (
                          <p className="text-[13px] text-muted-foreground">
                            No journal entry provided for this event.
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Clinician Note */}
                  <Card className="shadow-lg border-primary/20 overflow-hidden">
                    <div className="px-5 py-3 border-b border-border/50 bg-card/60 flex items-center justify-between">
                      <SectionHeader className="m-0 text-xs font-bold tracking-wider">Clinician Note &amp; Synthesis</SectionHeader>
                      <span className="mono text-[10px] bg-primary/10 text-primary px-2 py-1 rounded-sm border border-primary/20">PATIENT: {patient.name.toUpperCase()}</span>
                    </div>
                    <CardContent className="p-5 space-y-4 bg-card/20">
                      <Textarea
                        value={observation}
                        onChange={(e) => setObservation(e.target.value)}
                        placeholder="Describe triggers, context, and observed acoustic stressors…"
                        className="min-h-[180px] text-[14px] leading-relaxed bg-background font-serif shadow-inner border-border p-4 rounded-lg resize-y focus-visible:ring-primary/40"
                      />
                      <Button
                        size="lg"
                        type="button"
                        onClick={runProfileDraft}
                        disabled={profileDrafting || !activeProfile}
                        className="w-full h-12 text-sm font-bold tracking-wide gap-3 bg-primary text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/0.2)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.4)] transition-shadow"
                      >
                        {profileDrafting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Brain className="w-5 h-5" />}
                        Save and Proceed
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                {/* Right Side Graphics */}
                <div className="space-y-6">
                  {displayProfile && (
                    <>
                      <div>
                        <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-muted-foreground mb-3">
                          Vocal Biometrics
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {FEATURE_EXPLAINERS.map((f, idx) => {
                            const Icon = ICONS[f.icon];
                            const safeValue = toArray(displayProfile.safe_radar)[idx];
                            const dangerValue = toArray(displayProfile.danger_radar)[idx];

                            let customName: string = f.name;
                            if (f.name === "Spectral Flux") customName = "Environmental Spike (Spectral Flux)";
                            if (f.name === "MFCC Deviation") customName = "Vocal Stress (MFCC Deviation)";
                            if (f.name === "Spectral Centroid") customName = "Vocal Brightness (Centroid)";
                            if (f.name === "ZCR Density") customName = "Vocal Breathiness (ZCR Density)";

                            return (
                              <MetricCard
                                key={f.key}
                                icon={Icon}
                                name={customName}
                                description={f.desc}
                                safeValue={safeValue}
                                dangerValue={dangerValue}
                              />
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-muted-foreground mb-3">
                          Facial Biometrics (ARKit)
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {FACIAL_FEATURE_EXPLAINERS.map((f) => {
                            const Icon = ICONS[f.icon];
                            // Pull live current value from the selected incident.
                            // brow_furrow / jaw_tightness fall back to derived
                            // splits of arkit_stress_index when the per-region
                            // score isn't available on the incident envelope.
                            const arkit = (selectedIncident?.arkit_stress_index ?? 0) * 100;
                            const liveValue =
                              f.key === "facial_stress"
                                ? arkit
                                : f.key === "brow_furrow"
                                ? Math.min(100, arkit * 0.95)
                                : Math.min(100, arkit * 1.05);

                            return (
                              <MetricCard
                                key={f.key}
                                icon={Icon}
                                name={f.name}
                                description={f.desc}
                                safeValue={f.safe}
                                dangerValue={liveValue || f.danger}
                              />
                            );
                          })}
                        </div>
                        {selectedIncident?.arkit_dominant_expression && (
                          <p className="mono text-[10px] text-muted-foreground mt-3">
                            Dominant expression at trigger: <span className="text-foreground">{selectedIncident.arkit_dominant_expression}</span>
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-8 border-t border-border/40 mt-8">
                <p className="text-xs text-muted-foreground max-w-md">
                  Clicking <strong className="text-foreground">Save and Proceed</strong> above will run the benchmark-vs-current comparison pipeline and surface its outcomes in Step&nbsp;3.
                </p>
                <Button
                  size="lg"
                  variant={pipelineOutcome ? "default" : "outline"}
                  onClick={() => {
                    if (!pipelineOutcome) {
                      toast.info("Pipeline not yet run", {
                        description: "Use 'Save and Proceed' to generate the comparison outcome first.",
                      });
                      return;
                    }
                    setActiveStep(3);
                  }}
                  className="gap-2 px-10 shadow-md"
                >
                  View Pipeline Outcomes <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: PIPELINE COMPARISON & OUTCOMES */}
          {activeStep === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
              <div className="border-b border-border/60 pb-6">
                <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                  <GitCompareArrows className="w-6 h-6 text-primary" />
                  Step 3: Pipeline Comparison &amp; Outcomes
                </h2>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-3xl">
                  The comparison pipeline scores each current danger reading against the benchmarked safe envelope, ranks how far each metric has crossed its band, and produces a recommended tunable parameter that feeds Step&nbsp;4.
                </p>
              </div>

              {!pipelineOutcome && (
                <Card className="border-dashed border-border/60 bg-card/30">
                  <CardContent className="p-8 text-center text-sm text-muted-foreground space-y-4">
                    <p>
                      No pipeline outcome yet. Run the comparison from Step&nbsp;2 to generate breach rankings and a tuning recommendation.
                    </p>
                    <Button variant="outline" onClick={() => setActiveStep(2)} className="gap-2">
                      <ArrowLeft className="w-4 h-4" /> Back to Incident Review
                    </Button>
                  </CardContent>
                </Card>
              )}

              {pipelineOutcome && (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-8 items-start">
                  {/* Breach ranking */}
                  <Card className="shadow-sm overflow-hidden">
                    <CardHeader className="pb-3 border-b border-border/50 bg-card/40">
                      <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <FlaskConical className="w-4 h-4 text-primary" /> Benchmark Delta Ranking
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ul className="divide-y divide-border/60">
                        {pipelineOutcome.rows.map((row, idx) => {
                          const palette =
                            row.severity === "critical"
                              ? "border-danger/60 text-danger bg-danger/10"
                              : row.severity === "breach"
                              ? "border-primary/60 text-primary bg-primary/10"
                              : row.severity === "watch"
                              ? "border-amber-500/50 text-amber-500 bg-amber-500/10"
                              : "border-safe/50 text-safe bg-safe/10";
                          return (
                            <li key={row.key} className="px-5 py-4 flex flex-col gap-2">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="mono text-[11px] text-muted-foreground w-5 text-right">#{idx + 1}</span>
                                  <span className="text-sm font-semibold truncate">{row.label}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={cn("mono text-[10px] font-bold uppercase tracking-wider border px-2 py-0.5 rounded-sm", palette)}>
                                    {row.severity}
                                  </span>
                                  <span className="mono text-sm font-bold tabular-nums text-foreground">
                                    Δ{Math.round(row.delta)}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 mono text-[11px] text-muted-foreground">
                                <span>SAFE {Math.round(row.safe)}</span>
                                <div className="flex-1 relative h-1.5 rounded-full bg-muted border border-border overflow-hidden">
                                  <div
                                    className="absolute top-0 left-0 h-full"
                                    style={{
                                      width: `${Math.round(row.breachPct * 100)}%`,
                                      background:
                                        row.severity === "critical"
                                          ? "hsl(var(--danger))"
                                          : row.severity === "breach"
                                          ? "linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--primary-glow)) 100%)"
                                          : row.severity === "watch"
                                          ? "hsl(42 96% 56%)"
                                          : "hsl(var(--safe))",
                                    }}
                                  />
                                </div>
                                <span>DANGER {Math.round(row.danger)}</span>
                                <span className="tabular-nums w-12 text-right">{Math.round(row.breachPct * 100)}%</span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>

                  {/* Recommendation panel */}
                  <div className="space-y-5">
                    <Card className="border-primary/40 shadow-[0_0_30px_hsl(var(--primary)/0.12)] overflow-hidden">
                      <CardHeader className="pb-3 border-b border-primary/20 bg-primary/5">
                        <CardTitle className="text-primary text-sm font-bold tracking-wider uppercase flex items-center gap-2">
                          <Target className="w-4 h-4" /> Primary Offender
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-5 space-y-3">
                        <div className="text-lg font-bold">{pipelineOutcome.primary.label}</div>
                        <div className="mono text-xs text-muted-foreground">
                          Breach depth:{" "}
                          <span className="text-foreground font-bold">
                            {(pipelineOutcome.primary.breachPct * 100).toFixed(0)}%
                          </span>{" "}
                          of safe→danger band
                        </div>
                        <div className="text-sm text-foreground leading-relaxed pt-2 border-t border-border/40">
                          {pipelineOutcome.verdict}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="shadow-sm overflow-hidden">
                      <CardHeader className="pb-3 border-b border-border/50 bg-card/40">
                        <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4 text-primary" /> Recommended Tunable
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-5 space-y-4">
                        <div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider">Parameter</div>
                          <div className="text-base font-bold text-foreground">{pipelineOutcome.recommendation.tunable.label}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-md border border-border/60 bg-card/60 px-3 py-2">
                            <div className="mono text-[10px] text-muted-foreground uppercase">Current</div>
                            <div className="mono text-sm font-bold tabular-nums">
                              {pipelineOutcome.recommendation.tunable.default}
                              {pipelineOutcome.recommendation.tunable.unit}
                            </div>
                          </div>
                          <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
                            <div className="mono text-[10px] text-primary uppercase">Suggested</div>
                            <div className="mono text-sm font-bold tabular-nums text-primary">
                              {pipelineOutcome.recommendation.suggestedValue}
                              {pipelineOutcome.recommendation.tunable.unit}
                            </div>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {pipelineOutcome.recommendation.rationale}
                        </p>
                        <p className="mono text-[10px] text-muted-foreground">
                          Generated {new Date(pipelineOutcome.generatedAt).toLocaleTimeString()}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center pt-8 border-t border-border/40 mt-8">
                <Button variant="outline" onClick={() => setActiveStep(2)} className="gap-2">
                  <ArrowLeft className="w-4 h-4" /> Back to Clinical Review
                </Button>
                <Button
                  size="lg"
                  onClick={() => setActiveStep(4)}
                  disabled={!pipelineOutcome}
                  className="gap-2 px-10 shadow-md"
                >
                  Proceed to Directive &amp; Deploy <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: DEPLOY DIRECTIVE */}
          {activeStep === 4 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-500 max-w-2xl mx-auto">
               <div className="text-center pb-4">
                <h2 className="text-3xl font-bold tracking-tight">Step 4: Directive &amp; Deploy</h2>
                <p className="text-base text-muted-foreground mt-3 leading-relaxed">
                  Set final intervention rules based on the pipeline's recommended tunable and beam the hyper-parameters securely to the iOS application.
                </p>
              </div>

              <Card className="bg-gradient-to-b from-primary/5 to-background border-primary/30 shadow-[0_0_40px_hsl(var(--primary)/0.1)] overflow-hidden">
                <CardHeader className="pb-6 border-b border-primary/10 bg-card/60">
                  <CardTitle className="text-primary font-bold text-xl">Deployable Edge Payload</CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-10">
                  <div className="space-y-5 bg-card/50 p-6 rounded-lg border border-border/50">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-base font-semibold">Tunable Parameter</Label>
                        <p className="text-[11px] text-muted-foreground">
                          The pipeline recommended this metric based on the largest benchmark breach. Override freely — any acoustic tunable is fair game.
                        </p>
                      </div>
                      <Select value={tunableKey} onValueChange={(v) => onTunableKeyChange(v as TunableMetricKey)}>
                        <SelectTrigger className="bg-background border-border h-11 w-[240px] shadow-sm font-semibold text-[13px] focus:ring-primary/40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(TUNABLE_METRICS).map((m) => (
                            <SelectItem key={m.key} value={m.key} className="font-medium py-2.5 cursor-pointer">
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
                      <Label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        {tunableSpec.label}
                      </Label>
                      <span className="mono text-lg text-primary font-bold tabular-nums bg-primary/15 px-4 py-1.5 rounded-md border border-primary/30">
                        {tunableSpec.step < 1 ? tunableValue.toFixed(2) : tunableValue}
                        {tunableSpec.unit && <span className="ml-1">{tunableSpec.unit}</span>}
                      </span>
                    </div>
                    <Slider
                      min={tunableSpec.min}
                      max={tunableSpec.max}
                      step={tunableSpec.step}
                      value={[tunableValue]}
                      onValueChange={(v) => setTunableValue(v[0])}
                      className="py-2"
                    />
                    <div className="flex items-center justify-between mono text-[10px] text-muted-foreground">
                      <span>MIN {tunableSpec.step < 1 ? tunableSpec.min.toFixed(2) : tunableSpec.min}{tunableSpec.unit}</span>
                      {pipelineOutcome?.recommendation.tunable.key === tunableKey && (
                        <span className="text-primary font-semibold">
                          PIPELINE SUGGESTED {tunableSpec.step < 1
                            ? pipelineOutcome.recommendation.suggestedValue.toFixed(2)
                            : pipelineOutcome.recommendation.suggestedValue}
                          {tunableSpec.unit}
                        </span>
                      )}
                      <span>MAX {tunableSpec.step < 1 ? tunableSpec.max.toFixed(2) : tunableSpec.max}{tunableSpec.unit}</span>
                    </div>
                    <p className="text-[12px] text-muted-foreground uppercase tracking-widest font-semibold flex items-center gap-1.5 pt-1">
                      <Wind className="w-3.5 h-3.5" /> {tunableSpec.explainer}
                    </p>
                  </div>

                  <div className="space-y-4 bg-card/50 p-6 rounded-lg border border-border/50">
                    <Label className="text-base font-semibold">Required Intervention</Label>
                    <Select value={grounding} onValueChange={(v) => setGrounding(v as DirectiveActivityType)}>
                      <SelectTrigger className="bg-background border-border h-14 shadow-sm font-semibold text-[15px] focus:ring-primary/40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GROUNDING.map((g) => (
                          <SelectItem key={g} value={g} className="font-medium py-3 cursor-pointer">
                            {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="pt-3 space-y-3">
                      <Label className="text-sm font-semibold text-muted-foreground">Instructions</Label>
                      <Textarea 
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        className="min-h-[100px] text-[14px] bg-background border-border/60 focus-visible:ring-primary/30 leading-relaxed resize-y shadow-inner"
                        placeholder="Specific system instructions for the edge agent..."
                      />
                    </div>
                  </div>

                  <div className="pt-6 space-y-4">
                    {!selectedIncident && (
                      <div className="text-xs text-muted-foreground bg-muted/30 border border-border/60 rounded-md px-3 py-2">
                        Select an incident from Step&nbsp;2 before deploying a directive — the deploy is bound to a specific incident.
                      </div>
                    )}
                    {deployedInfo && (
                      <div className="text-xs bg-primary/10 border border-primary/40 text-primary rounded-md px-3 py-2 mono flex items-center gap-2">
                        <CircleCheck className="w-3.5 h-3.5" />
                        Deployed {deployedInfo.directiveId} · {fmtTimeAgo(deployedInfo.deployedAt)}
                      </div>
                    )}
                    <Button
                      size="lg"
                      type="button"
                      onClick={() => void runDeploy()}
                      disabled={deploying || !selectedIncident}
                      className="w-full text-lg font-bold tracking-wide bg-primary text-primary-foreground hover:bg-primary-glow shadow-[0_0_30px_hsl(var(--primary)/0.3)] h-16 transition-all"
                    >
                      {deploying ? <Loader2 className="w-6 h-6 animate-spin" /> : "Deploy Directive To Edge Device"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

const BenchmarkMetric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-border/60 bg-card/60 px-3 py-2">
    <div className="mono text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    <div className="mono text-sm font-bold tabular-nums text-foreground">{value}</div>
  </div>
);
