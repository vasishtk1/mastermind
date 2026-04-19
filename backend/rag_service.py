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

from google import genai
from google.genai import types as genai_types

from models import ClinicalIncidentReport, IncomingDeviceEvent

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
