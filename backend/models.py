"""Pydantic I/O models for the Ember API.

`model_config = ConfigDict(from_attributes=True)` is set on every model so
SQLAlchemy ORM objects can be passed directly to `model_validate()` without
an intermediate dict conversion.
"""

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class IncomingDeviceEvent(BaseModel):
    """Structured payload sent by the on-device Cactus engine.

    Raw audio never leaves the device. Only derived metrics and the
    AI-generated intervention transcript are transmitted.
    """

    model_config = ConfigDict(from_attributes=True)

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
    `report_id` is populated when the record is persisted; it is `None` for
    transient in-memory objects (e.g. inside the eval harness).
    """

    model_config = ConfigDict(from_attributes=True)

    # Stable DB identifier — optional so in-memory pipeline objects are valid.
    report_id: Optional[str] = Field(None, alias="id")

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

    model_config = ConfigDict(from_attributes=True)

    dialect: str
    sample_size: int
    mean_quality: float
    std_dev: float


class EvalSummary(BaseModel):
    """JSON summary of the most recent evaluation harness run."""

    model_config = ConfigDict(from_attributes=True)

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

    model_config = ConfigDict(from_attributes=True)

    parameter: str = Field(..., description="Parameter name, e.g. 'pitch_variance_max'.")
    current_value: float
    proposed_value: float
    delta: float
    direction: str = Field(..., description="'increase' | 'decrease'.")
    rationale: str


class MonitorSnapshot(BaseModel):
    """Real-time acoustic biomarker snapshot POSTed by the browser every ~10 s."""

    model_config = ConfigDict(from_attributes=True)

    rms_db: float = Field(..., description="RMS level in dBFS (-100 = silence, 0 = clip)")
    spectral_flux: float = Field(..., ge=0.0, le=1.0, description="Frame-to-frame spectral change")
    zcr: float = Field(..., description="Zero-crossing rate in Hz")
    f0_hz: float = Field(..., description="Fundamental frequency in Hz; 0 = unvoiced")
    spectral_centroid: float = Field(..., description="Spectral centre of mass in Hz")


class MonitorResult(BaseModel):
    """Real-time inference result returned by the Gemini monitor endpoint."""

    model_config = ConfigDict(from_attributes=True)

    triggered: bool
    severity_score: float = Field(..., ge=0.0, le=1.0)
    reasoning: str = Field(..., description="≤120-char clinical observation")


class TelemetryBatchPayload(BaseModel):
    """Aggregated 500-ms telemetry window POSTed by the browser TelemetryWorker."""

    model_config = ConfigDict(from_attributes=True)

    patient_id: str
    window_start_ms: int
    window_end_ms: int
    face: Dict = Field(default_factory=dict)
    audio: Dict = Field(default_factory=dict)
    motion: Dict = Field(default_factory=dict)
    pointer: Dict = Field(default_factory=dict)


class DirectivePayload(BaseModel):
    """Clinician-authored directive deployed back to the patient's iPhone."""

    model_config = ConfigDict(from_attributes=True)

    incident_id: str = Field(..., description="The incident this directive responds to")
    directive_type: str = Field(..., description="Activity category, e.g. 'Breathing Exercise'")
    instructions: str = Field(..., description="Full clinician note / instructions for the patient")


class DirectiveResponse(BaseModel):
    """Acknowledgement returned after a directive is persisted."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    incident_id: str
    patient_id: str
    directive_type: str
    instructions: str
    deployed_at: str
    status: str = "deployed"


class RemediationProposal(BaseModel):
    """LLM-generated configuration proposal for the on-device agent."""

    model_config = ConfigDict(from_attributes=True)

    proposal_id: str
    patient_id: str
    generated_at: datetime
    source_report_timestamp: datetime
    severity_score: float
    confidence: float = Field(..., ge=0.0, le=1.0)
    summary: str
    threshold_adjustments: List[ThresholdAdjustment]
    new_system_prompt: str
    deployment_notes: Optional[str] = None
