from datetime import datetime
from typing import List

from pydantic import BaseModel, Field


class IncomingDeviceEvent(BaseModel):
    """Structured payload sent by the on-device Cactus engine.

    Raw audio never leaves the device. Only derived metrics and the
    AI-generated intervention transcript are transmitted.
    """

    timestamp: datetime
    patient_id: str
    pre_intervention_mfcc_variance: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="MFCC variance captured immediately before the intervention triggered (0–1 normalised).",
    )
    intervention_transcript: str = Field(
        ...,
        description="Full text of the on-device AI's spoken intervention.",
    )
    stabilized_flag: bool = Field(
        ...,
        description="True if the on-device model determined the patient returned to baseline within the intervention window.",
    )


class ClinicalIncidentReport(BaseModel):
    """Formal clinical incident report produced by the RAG pipeline.

    This is the authoritative record surfaced to clinicians in the dashboard.
    """

    patient_id: str
    incident_timestamp: datetime
    estimated_severity_score: float = Field(
        ...,
        ge=0.0,
        le=10.0,
        description="Severity on a 0–10 scale: 0–3 low, 4–6 moderate, 7–10 high.",
    )
    clinical_summary: str = Field(
        ...,
        description="Structured clinical narrative mapping the event to DSM/ICD rubrics.",
    )
    recommended_followup: str = Field(
        ...,
        description="Actionable clinician follow-up recommendation.",
    )
    keywords: List[str] = Field(
        ...,
        description="Extracted clinical keywords (symptom clusters, triggers, intervention type).",
    )
