from datetime import datetime
from typing import Dict, List, Optional

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


class DialectQuality(BaseModel):
    """Per-dialect rollup used to render the Bias & Fairness Matrix."""

    dialect: str
    sample_size: int
    mean_quality: float
    std_dev: float


class EvalSummary(BaseModel):
    """JSON summary of the most recent evaluation harness run.

    Mirrors the metrics printed by `evals.py` so the dashboard can render
    a Model Rigor & Auditing view without running the harness in-browser.
    """

    generated_at: datetime
    model: str
    dataset_size: int
    completed_cases: int
    failed_cases: int

    expected_high_count: int
    correctly_flagged_high: int
    utility_precision_at_high: float = Field(..., ge=0.0, le=1.0)
    utility_verdict: str

    dialect_breakdown: List[DialectQuality]
    overall_mean_quality: float
    overall_std_dev: float
    fairness_coefficient_of_variation: float
    fairness_verdict: str

    case_results: List[Dict] = Field(
        default_factory=list,
        description="Per-case rollup: patient_id, dialect, expected_high, score, quality, error?",
    )


class ThresholdAdjustment(BaseModel):
    """A single proposed change to an on-device acoustic threshold."""

    parameter: str = Field(..., description="Parameter name, e.g. 'pitch_variance_max'.")
    current_value: float
    proposed_value: float
    delta: float
    direction: str = Field(..., description="'increase' | 'decrease'.")
    rationale: str


class RemediationProposal(BaseModel):
    """LLM-generated configuration proposal for the on-device agent.

    Returned by `POST /api/patients/{patient_id}/remediate` and rendered in the
    PatientProfiles drawer. The clinician reviews and approves before deployment.
    """

    proposal_id: str
    patient_id: str
    generated_at: datetime
    source_report_timestamp: datetime
    severity_score: float
    confidence: float = Field(..., ge=0.0, le=1.0)
    summary: str = Field(..., description="One-paragraph clinical justification for the change set.")
    threshold_adjustments: List[ThresholdAdjustment]
    new_system_prompt: str = Field(..., description="Updated on-device intervention agent system prompt.")
    deployment_notes: Optional[str] = None
