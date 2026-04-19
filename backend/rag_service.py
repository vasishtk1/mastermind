"""RAG pipeline: maps raw device events to formal clinical incident reports.

Design decisions:
- No LangChain. Direct OpenAI JSON-mode call for full traceability.
- Clinical rubric is hardcoded here as the single authoritative retrieval
  context. In production this would be chunked and embedded in a vector store
  (DSM-5-TR, ICD-11 Chapter 06, PCL-5, GAD-7, PHQ-9).
- JSON parsing has two defensive layers: Pydantic validation + a fallback
  regex strip for markdown code-fence artifacts from the model.
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from google import genai
from google.genai import types as genai_types

from models import (
    ClinicalIncidentReport,
    IncomingDeviceEvent,
    MonitorResult,
    RemediationProposal,
    ThresholdAdjustment,
)

# ---------------------------------------------------------------------------
# Hardcoded clinical rubric (mock RAG retrieval context)
# In production: retrieved from a vector DB keyed on the transcript embedding.
# ---------------------------------------------------------------------------
CLINICAL_RUBRIC = """
=== EMBER CLINICAL EVALUATION RUBRIC v1.2 ===

SOURCE STANDARDS: DSM-5-TR (APA 2022), ICD-11 Chapter 06, PCL-5 (PTSD Checklist), GAD-7, PHQ-9.

--- SEVERITY SCORING GUIDE (0–10 scale) ---
0–3  LOW:      Patient self-regulated or rapidly stabilised. No immediate safety concern.
               Indicators: Transcript shows grounding successful, patient reports calm,
               no suicidal/self-harm ideation, physiological signals returned to baseline.
4–6  MODERATE: Partial stabilisation. Elevated distress persisting. Clinician review recommended within 48 h.
               Indicators: Partial grounding, residual hyperarousal, avoidance behaviours noted,
               MFCC variance > 0.55, patient expresses ongoing fear or confusion.
7–10 HIGH:     Acute crisis. Immediate clinician contact required.
               Indicators: Suicidal ideation, self-harm statements, dissociative language
               ("I'm not real", "nothing matters"), panic escalation not resolved,
               MFCC variance > 0.80, stabilized_flag = false.

--- DSM-5-TR PTSD CRITERION MAPPING ---
Criterion B (Intrusion):  Re-experiencing, flashback language, "it's happening again".
Criterion C (Avoidance):  Phrases indicating escape urgency, refusal to continue, shutdown.
Criterion D (Negative Cognition): Hopelessness, self-blame, emotional numbing statements.
Criterion E (Hyperarousal): Hypervigilance cues, startle response described, sleep disturbance mention.

--- GAD-7 ANXIETY MARKERS ---
Excessive worry, difficulty controlling worry, restlessness, fatigue, concentration problems,
irritability, muscle tension, sleep disturbance. Score contribution: 1 pt per domain mentioned.

--- INTERVENTION QUALITY MARKERS ---
Grounding technique (5-4-3-2-1 sensory), paced breathing prompt, cognitive reframe,
safe-space visualisation, relocation suggestion, emergency escalation.

--- KEYWORD TAXONOMY ---
Symptom clusters: [hyperarousal, avoidance, intrusion, numbing, dissociation, panic, rumination]
Triggers:         [acoustic_shock, crowd_noise, social_crowding, low_frequency_stress, mixed_environment]
Interventions:    [grounding, paced_breathing, cognitive_reframe, safe_visualisation, relocation, escalation]
Outcomes:         [stabilised, partial_stabilisation, escalated, inconclusive]

--- RECOMMENDED FOLLOW-UP ACTIONS ---
LOW:      "No immediate action. Log for pattern review. Next scheduled session."
MODERATE: "Schedule check-in within 48 hours. Review trigger profile adjustment."
HIGH:     "Immediate clinician contact required. Activate emergency protocol if patient unreachable."
"""

# ---------------------------------------------------------------------------
# LLM prompt template
# ---------------------------------------------------------------------------
PROMPT_TEMPLATE = """You are a board-certified clinical AI assistant specialising in trauma and anxiety disorders.
Your role is to generate formal, structured clinical incident reports from on-device AI intervention transcripts.
You must map the transcript rigorously to the provided clinical rubric and output ONLY valid JSON — no markdown, no prose outside JSON.


=== CLINICAL RUBRIC (Retrieved Context) ===
{rubric}

=== DEVICE EVENT ===
Patient ID:                  {patient_id}
Event Timestamp:             {timestamp}
Pre-Intervention MFCC Var:   {mfcc_variance} (0–1 scale; >0.80 = severe physiological distress)
Stabilised Flag:             {stabilized_flag}
Intervention Transcript:
\"\"\"
{transcript}
\"\"\"

=== TASK ===
Produce a ClinicalIncidentReport JSON object with EXACTLY these fields:
{{
  "patient_id":                "<string>",
  "incident_timestamp":        "<ISO 8601 datetime string>",
  "estimated_severity_score":  <float 0.0–10.0>,
  "clinical_summary":          "<2–4 sentence clinical narrative mapping the event to DSM/ICD rubrics>",
  "recommended_followup":      "<1–2 sentence actionable clinician recommendation>",
  "keywords":                  ["<keyword>", ...]
}}

Rules:
1. Severity must reflect BOTH the MFCC variance AND stabilized_flag AND transcript content.
2. If the transcript contains ANY suicidal ideation or self-harm language, severity >= 8.0.
3. keywords must be drawn from the rubric taxonomy only.
4. Output ONLY the JSON object. No markdown code fences. No extra text.
"""


def _strip_code_fence(text: str) -> str:
    """Remove markdown ```json ... ``` wrappers that models sometimes emit."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _generate_with_model_fallback(client: genai.Client, prompt: str):
    """Try preferred model first, then fall back to known available models."""
    preferred_model = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
    fallback_models = [
        preferred_model,
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash-lite-001",
    ]

    last_error = None
    for model_name in fallback_models:
        try:
            return client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2,
                    max_output_tokens=2000,
                ),
            )
        except Exception as exc:
            # Keep trying known alternatives when a model is unavailable.
            last_error = exc
            continue

    raise ValueError(
        "No compatible Gemini model succeeded. "
        "Set GEMINI_MODEL in backend/.env to one available for your key."
    ) from last_error


def generate_clinical_report(event: IncomingDeviceEvent) -> ClinicalIncidentReport:
    """Core RAG function: event → structured ClinicalIncidentReport.

    Raises:
        ValueError: If the LLM response cannot be parsed into a valid report
                    after two defensive parsing attempts.
        google.api_core.exceptions.GoogleAPIError: Propagated for the caller to handle.
    """
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

    prompt = PROMPT_TEMPLATE.format(
        rubric=CLINICAL_RUBRIC,
        patient_id=event.patient_id,
        timestamp=event.timestamp.isoformat(),
        mfcc_variance=round(event.pre_intervention_mfcc_variance, 4),
        stabilized_flag=event.stabilized_flag,
        transcript=event.intervention_transcript,
    )

    response = _generate_with_model_fallback(client, prompt)

    raw_content = response.text or ""

    # --- Layer 1: direct JSON parse (json_object mode should always give clean JSON)
    try:
        data = json.loads(raw_content)
    except json.JSONDecodeError:
        # --- Layer 2: strip potential code-fence artifact and retry
        cleaned = _strip_code_fence(raw_content)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"LLM returned unparseable content for patient {event.patient_id}. "
                f"Raw response (first 500 chars): {raw_content[:500]}"
            ) from exc

    # Ensure the incident_timestamp is always tied to the device event,
    # regardless of what the model interpolates.
    data["patient_id"] = event.patient_id
    data["incident_timestamp"] = event.timestamp.isoformat()

    try:
        return ClinicalIncidentReport(**data)
    except Exception as exc:
        raise ValueError(
            f"LLM JSON did not match ClinicalIncidentReport schema for patient "
            f"{event.patient_id}. Parsed data: {data}"
        ) from exc


# ---------------------------------------------------------------------------
# Real-time acoustic monitor
# ---------------------------------------------------------------------------

MONITOR_SYSTEM_PROMPT = (
    "You are an acoustic biomarker safety monitor for Ember, a real-time psychiatric "
    "monitoring platform. Analyse the provided vocal prosody metrics and decide whether "
    "they represent an acute distress episode requiring clinical intervention. "
    "Respond ONLY with a valid JSON object — no markdown, no prose outside the JSON."
)

MONITOR_PROMPT_TEMPLATE = """Real-time acoustic snapshot (browser microphone):
  RMS level:        {rms_db:.1f} dBFS  (reference: quiet room ≈ -50, normal speech ≈ -25, elevated ≈ -15, loud ≈ -10)
  Spectral flux:    {spectral_flux:.3f}  (0.0 = static environment, 1.0 = rapid spectral change / hyperventilation)
  Zero-crossing rate: {zcr:.0f} Hz
  Fundamental freq: {f0_hz:.0f} Hz  ({voiced_label})
  Spectral centroid:{spectral_centroid:.0f} Hz

Distress thresholds for PTSD / anxiety:
  - RMS > -20 dBFS      → agitated/elevated vocal production
  - Spectral flux > 0.5 → rapid environmental change or breathing disruption
  - ZCR > 5000 Hz with elevated RMS → stress vocalisation signature
  - F0 > 220 Hz (female) or > 160 Hz (male) → pitch escalation

Trigger rule: fire ONLY if ≥ 2 indicators are simultaneously elevated. Default to triggered=false.

Respond with EXACTLY this JSON (no other text):
{{"triggered": <true|false>, "severity_score": <0.0-1.0>, "reasoning": "<≤120-char clinical observation>"}}
"""


def analyze_acoustic_snapshot(
    rms_db: float,
    spectral_flux: float,
    zcr: float,
    f0_hz: float,
    spectral_centroid: float,
) -> MonitorResult:
    """Fast Gemini call: acoustic snapshot → triggered / severity / reasoning.

    Runs synchronously — callers should use run_in_executor to stay non-blocking.
    Returns a safe default (triggered=False) on any LLM or parse failure.
    """
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    voiced_label = "voiced speech detected" if f0_hz > 0 else "unvoiced / ambient noise"

    prompt = MONITOR_SYSTEM_PROMPT + "\n\n" + MONITOR_PROMPT_TEMPLATE.format(
        rms_db=rms_db,
        spectral_flux=spectral_flux,
        zcr=zcr,
        f0_hz=f0_hz,
        voiced_label=voiced_label,
        spectral_centroid=spectral_centroid,
    )

    try:
        response = _generate_with_model_fallback(client, prompt)
        raw = _strip_code_fence(response.text or "")
        data = json.loads(raw)
        return MonitorResult(
            triggered=bool(data.get("triggered", False)),
            severity_score=min(1.0, max(0.0, float(data.get("severity_score", 0.0)))),
            reasoning=str(data.get("reasoning", "Acoustic environment nominal."))[:200],
        )
    except Exception:
        return MonitorResult(
            triggered=False,
            severity_score=0.0,
            reasoning="Monitor nominal — inference unavailable.",
        )


# ---------------------------------------------------------------------------
# Remediation pipeline
# ---------------------------------------------------------------------------

# Default acoustic thresholds shipped on every Ember edge device. The
# remediation prompt asks the model to adjust these in response to a recent
# incident report. Real deployments would fetch the patient's current
# per-device config; we use this canonical baseline for the demo.
DEFAULT_DEVICE_THRESHOLDS: Dict[str, float] = {
    "mfcc_variance_ceiling": 0.80,
    "pitch_variance_max": 0.65,
    "spectral_flux_threshold": 0.55,
    "spectral_centroid_hz": 2400.0,
    "zcr_baseline": 0.32,
    "breath_rate_ceiling": 22.0,
    "anomaly_sensitivity": 0.60,
}

DEFAULT_DEVICE_SYSTEM_PROMPT = (
    "You are Ember, an on-device intervention agent. When acoustic anomaly "
    "scores exceed configured thresholds, deliver a calm, paced grounding "
    "intervention (5-4-3-2-1 sensory or paced breathing). Keep responses "
    "under 25 seconds. Escalate to a human clinician only when the patient "
    "expresses self-harm intent or fails to stabilise within two cycles."
)

REMEDIATION_PROMPT_TEMPLATE = """You are Ember's clinical configuration agent. A recent incident report indicates that the on-device intervention agent's current thresholds and prompt may need tuning for this specific patient.

Produce a structured RemediationProposal that adjusts the acoustic anomaly thresholds and rewrites the on-device system prompt to better serve this patient's presentation. Output ONLY valid JSON — no markdown, no prose outside JSON.

=== INCIDENT REPORT ===
Patient ID:           {patient_id}
Incident Timestamp:   {incident_timestamp}
Severity (0-10):      {severity}
Clinical Summary:     {summary}
Recommended Followup: {followup}
Keywords:             {keywords}

=== CURRENT ON-DEVICE THRESHOLDS ===
{thresholds}

=== CURRENT ON-DEVICE SYSTEM PROMPT ===
\"\"\"
{system_prompt}
\"\"\"

=== TASK ===
Return a JSON object with EXACTLY these fields:
{{
  "summary":             "<2-3 sentence clinical justification for the proposed changes>",
  "confidence":          <float 0.0-1.0 reflecting how strongly the report supports these changes>,
  "threshold_adjustments": [
    {{
      "parameter":       "<one of: {parameter_names}>",
      "current_value":   <float, must match the value in CURRENT ON-DEVICE THRESHOLDS>,
      "proposed_value":  <float>,
      "delta":           <float, proposed_value - current_value, sign-correct>,
      "direction":       "<'increase' | 'decrease'>",
      "rationale":       "<1 sentence linking the change to the incident report>"
    }}
    /* 2-4 adjustments, each one targeting a distinct parameter */
  ],
  "new_system_prompt":   "<rewritten on-device agent prompt, 2-4 sentences, must reference the patient's specific trigger pattern from the report>",
  "deployment_notes":    "<1 sentence operational guidance for the clinician approving deployment>"
}}

Rules:
1. Propose 2-4 threshold adjustments that are clinically supported by the incident report.
2. For HIGH severity reports (score >= 7.0), prefer DECREASING thresholds to make the device more sensitive.
3. For LOW severity reports (score < 4.0), DECREASE thresholds is rare; consider INCREASE to reduce false positives.
4. `delta` MUST equal proposed_value - current_value exactly. `direction` must match the sign of `delta`.
5. The `new_system_prompt` MUST be different from the current prompt and reflect specific keywords from the report.
6. Output ONLY the JSON object. No markdown code fences. No extra text.
"""


def _coerce_adjustment(raw: dict) -> Optional[ThresholdAdjustment]:
    """Validate a single adjustment dict against the known parameter set."""
    parameter = raw.get("parameter")
    if parameter not in DEFAULT_DEVICE_THRESHOLDS:
        return None
    try:
        current = float(raw.get("current_value", DEFAULT_DEVICE_THRESHOLDS[parameter]))
        proposed = float(raw["proposed_value"])
    except (KeyError, TypeError, ValueError):
        return None

    delta = round(proposed - current, 4)
    direction = "increase" if delta > 0 else "decrease" if delta < 0 else "hold"
    rationale = str(raw.get("rationale", "")).strip() or "Model-suggested adjustment."

    return ThresholdAdjustment(
        parameter=parameter,
        current_value=round(current, 4),
        proposed_value=round(proposed, 4),
        delta=delta,
        direction=direction,
        rationale=rationale,
    )


def generate_remediation_profile(
    report: ClinicalIncidentReport,
    current_thresholds: Optional[Dict[str, float]] = None,
    current_system_prompt: Optional[str] = None,
) -> RemediationProposal:
    """Generate a configuration patch for the on-device agent from a report.

    Args:
        report: The incident report driving the remediation.
        current_thresholds: Patient-specific override of the device baseline.
        current_system_prompt: Current on-device prompt (defaults to the canonical one).

    Raises:
        ValueError: If the LLM response cannot be parsed into a valid proposal.
    """
    thresholds = dict(current_thresholds or DEFAULT_DEVICE_THRESHOLDS)
    system_prompt = current_system_prompt or DEFAULT_DEVICE_SYSTEM_PROMPT

    threshold_block = "\n".join(f"  {k}: {v}" for k, v in thresholds.items())
    parameter_names = ", ".join(thresholds.keys())

    prompt = REMEDIATION_PROMPT_TEMPLATE.format(
        patient_id=report.patient_id,
        incident_timestamp=report.incident_timestamp.isoformat(),
        severity=round(report.estimated_severity_score, 2),
        summary=report.clinical_summary,
        followup=report.recommended_followup,
        keywords=", ".join(report.keywords) or "(none)",
        thresholds=threshold_block,
        system_prompt=system_prompt,
        parameter_names=parameter_names,
    )

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    response = _generate_with_model_fallback(client, prompt)
    raw_content = response.text or ""

    try:
        data = json.loads(raw_content)
    except json.JSONDecodeError:
        cleaned = _strip_code_fence(raw_content)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"LLM returned unparseable remediation JSON for patient {report.patient_id}. "
                f"Raw response (first 500 chars): {raw_content[:500]}"
            ) from exc

    raw_adjustments = data.get("threshold_adjustments") or []
    adjustments: List[ThresholdAdjustment] = []
    for raw in raw_adjustments:
        if not isinstance(raw, dict):
            continue
        adjustment = _coerce_adjustment(raw)
        if adjustment is not None:
            adjustments.append(adjustment)

    if not adjustments:
        raise ValueError(
            f"Remediation proposal for patient {report.patient_id} contained no valid "
            f"threshold adjustments. Raw payload: {data}"
        )

    new_prompt = str(data.get("new_system_prompt", "")).strip()
    if not new_prompt:
        raise ValueError(
            f"Remediation proposal for patient {report.patient_id} did not include a new system prompt."
        )

    try:
        confidence = float(data.get("confidence", 0.7))
    except (TypeError, ValueError):
        confidence = 0.7
    confidence = max(0.0, min(1.0, confidence))

    return RemediationProposal(
        proposal_id=f"rem_{uuid.uuid4().hex[:10]}",
        patient_id=report.patient_id,
        generated_at=datetime.now(timezone.utc),
        source_report_timestamp=report.incident_timestamp,
        severity_score=report.estimated_severity_score,
        confidence=confidence,
        summary=str(data.get("summary", "")).strip()
            or "Proposed device tuning based on the latest incident report.",
        threshold_adjustments=adjustments,
        new_system_prompt=new_prompt,
        deployment_notes=str(data.get("deployment_notes", "")).strip() or None,
    )
