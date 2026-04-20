import type { IncidentReport } from "./ember-types";

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();

export const MOCK_INCIDENTS: IncidentReport[] = [
  {
    id: "inc-001",
    patient_id: "pat-mira",
    patient_name: "Mira K.",
    patient_initials: "MK",
    patient_accent: "teal",
    timestamp: ago(8),
    trigger_type: "Acoustic Variance Spike",
    acoustic_variance: 0.87,
    peak_db: 91,
    user_statement:
      "I felt a sudden wave of panic when the crowd noise got too loud. My heart was racing and I couldn't breathe properly. I wanted to run but I couldn't move.",
    arkit_stress_index: 0.82,
    arkit_dominant_expression: "browInnerUp + mouthFrownLeft",
    on_device_action:
      "Initiated 4-7-8 breathing protocol. Activated noise-cancelling guidance overlay. Suggested exit route to quieter adjacent area.",
    stabilized: false,
    severity: "critical",
    status: "unreviewed",
  },
  {
    id: "inc-002",
    patient_id: "pat-mira",
    patient_name: "Mira K.",
    patient_initials: "MK",
    patient_accent: "teal",
    timestamp: ago(130),
    trigger_type: "MFCC Deviation Threshold Breach",
    acoustic_variance: 0.71,
    peak_db: 83,
    user_statement:
      "The alarm sound in the office startled me badly. My body went into full freeze mode and I couldn't speak for a few seconds.",
    arkit_stress_index: 0.68,
    arkit_dominant_expression: "eyeWideLeft + eyeWideRight",
    on_device_action:
      "Deployed orienting cue: 5 grounding objects prompt. Reduced ambient audio by 40 dB via hardware API.",
    stabilized: true,
    severity: "high",
    status: "in_review",
  },
  {
    id: "inc-003",
    patient_id: "pat-james",
    patient_name: "James T.",
    patient_initials: "JT",
    patient_accent: "violet",
    timestamp: ago(310),
    trigger_type: "Social Crowding Response",
    acoustic_variance: 0.54,
    peak_db: 76,
    user_statement:
      "Waiting room at the clinic had way too many people. I started feeling dizzy and my thoughts were racing. Managed to find a corner.",
    arkit_stress_index: 0.51,
    arkit_dominant_expression: "cheekSquintLeft + mouthStretchLeft",
    on_device_action:
      "Initiated paced-breathing prompt. Suggested physical relocation. Provided cognitive reframe script.",
    stabilized: true,
    severity: "moderate",
    status: "resolved",
    clinical_synthesis: {
      generated_at: ago(280),
      model: "gemini-2.5-flash",
      summary:
        "Patient experienced a moderate anxiety episode consistent with DSM-5-TR GAD Criterion B (restlessness, difficulty concentrating) in a crowded waiting environment. Acoustic variance of 0.54 exceeded the patient's established threshold of 0.48. ARKit facial analysis confirmed elevated cheek tension and mouth stretch indicative of anxiety state. On-device intervention was initiated within 340 ms and patient self-reported partial stabilisation.",
      dsm_mapping:
        "GAD-7 domains: Restlessness (1pt), Difficulty controlling worry (1pt), Social crowding trigger consistent with Criterion B hyperarousal. Not meeting PTSD criterion threshold.",
      risk_assessment:
        "Low acute risk. Partial stabilisation achieved without escalation. No suicidal ideation or self-harm language detected in statement.",
      recommended_followup:
        "Schedule 48-hour check-in. Review ANX-SOC-001 threshold profile — consider lowering spectral_flux_threshold from 0.48 → 0.42 given repeated activation.",
      keywords: ["anxiety", "social_crowding", "hyperarousal", "grounding", "partial_stabilisation"],
      severity_score: 4.2,
    },
    deployed_directive: {
      id: "dir-001",
      incident_id: "inc-003",
      directive_type: "Breathing Exercise",
      instructions:
        "Practice box breathing (4-4-4-4) for 5 minutes at 6 PM tonight. Open the MasterMind app → Breathe → Box Protocol. Focus on the visual guide, not the sound.",
      deployed_at: ago(260),
      acknowledged: true,
    },
  },
  {
    id: "inc-004",
    patient_id: "pat-priya",
    patient_name: "Priya S.",
    patient_initials: "PS",
    patient_accent: "coral",
    timestamp: ago(840),
    trigger_type: "Low-Frequency Sustained Stress",
    acoustic_variance: 0.42,
    peak_db: 68,
    user_statement:
      "The HVAC in my office was louder than usual today and after 3 hours I started feeling on edge and couldn't focus at all.",
    arkit_stress_index: 0.38,
    arkit_dominant_expression: "browDownLeft + browDownRight",
    on_device_action:
      "Delivered low-frequency masking soundscape. Suggested relocation or noise-isolating headphones.",
    stabilized: true,
    severity: "low",
    status: "resolved",
  },
];

type PatientStub = {
  id: string;
  patient_name: string;
  patient_initials: string;
  patient_accent: "teal" | "violet" | "coral";
};

/** Generates a fresh "incoming" critical incident for polling demo */
export function generateIncomingIncident(seq: number, patientPool?: PatientStub[]): IncidentReport {
  const pool: PatientStub[] =
    patientPool && patientPool.length > 0
      ? patientPool
      : [
          { id: "pat-mira", patient_name: "Mira K.", patient_initials: "MK", patient_accent: "teal" },
          { id: "pat-james", patient_name: "James T.", patient_initials: "JT", patient_accent: "violet" },
        ];

  const variants = [
    {
      patient_id: pool[0 % pool.length].id,
      patient_name: pool[0 % pool.length].patient_name,
      patient_initials: pool[0 % pool.length].patient_initials,
      patient_accent: pool[0 % pool.length].patient_accent,
      trigger_type: "Pitch Escalation Detected",
      acoustic_variance: 0.79 + Math.random() * 0.1,
      peak_db: 85 + Math.floor(Math.random() * 8),
      user_statement:
        "Voices around me started getting louder and more aggressive. My hands started shaking and I felt extremely unsafe.",
      arkit_stress_index: 0.74 + Math.random() * 0.1,
      arkit_dominant_expression: "browInnerUp + mouthClose",
      on_device_action:
        "Triggered emergency grounding protocol. Sent low-light visual anchor. Notified emergency contact.",
      stabilized: false,
      severity: "critical" as const,
    },
    {
      patient_id: pool[1 % pool.length].id,
      patient_name: pool[1 % pool.length].patient_name,
      patient_initials: pool[1 % pool.length].patient_initials,
      patient_accent: pool[1 % pool.length].patient_accent,
      trigger_type: "ZCR Density Spike",
      acoustic_variance: 0.66 + Math.random() * 0.08,
      peak_db: 80 + Math.floor(Math.random() * 6),
      user_statement:
        "A car alarm outside went off right next to me. My whole body tensed up and I felt a rush of adrenaline I couldn't shake.",
      arkit_stress_index: 0.61 + Math.random() * 0.1,
      arkit_dominant_expression: "eyeWideLeft + cheekPuff",
      on_device_action:
        "Applied acoustic shock protocol. Delivered rapid orienting cue. Recommended immediate environment change.",
      stabilized: true,
      severity: "high" as const,
    },
  ];

  const v = variants[seq % variants.length];
  return {
    id: `inc-live-${Date.now()}`,
    timestamp: new Date().toISOString(),
    status: "unreviewed",
    ...v,
  };
}
