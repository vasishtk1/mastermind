"""Pydantic I/O models for the Ember API.

`model_config = ConfigDict(from_attributes=True)` is set on every model so
SQLAlchemy ORM objects can be passed directly to `model_validate()` without
an intermediate dict conversion.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class IncomingDeviceEvent(BaseModel):
    """Structured payload sent by the on-device Cactus engine.

    Accepts both the canonical FastAPI field names and the iOS camelCase
    variants that arrive after Swift's .convertToSnakeCase encoding:

      iOS field            → canonical field
      ─────────────────────────────────────────
      device_timestamp     → timestamp
      patient_stabilized   → stabilized_flag
      distress_level (int) → pre_intervention_mfcc_variance (float 0–1)

    Raw audio never leaves the device. Only derived metrics and the
    AI-generated intervention transcript are transmitted.
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    timestamp: datetime
    patient_id: str
    pre_intervention_mfcc_variance: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="MFCC variance before intervention (0–1). Derived from distress_level when absent.",
    )
    intervention_transcript: str = Field(
        default="",
        description="Full text of the on-device AI's spoken intervention.",
    )
    stabilized_flag: bool = Field(
        default=False,
        description="True if the on-device model determined the patient returned to baseline.",
    )

    # iOS-only extras — stored for audit but not used by the RAG pipeline.
    trigger_reason: Optional[str] = None
    distress_level: Optional[int] = None
    intervention_used: Optional[str] = None
    cloud_inference_used: Optional[bool] = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_ios_fields(cls, data: Any) -> Any:
        """Map iOS snake_case aliases to canonical field names."""
        if not isinstance(data, dict):
            return data

        # device_timestamp (str ISO-8601) → timestamp
        if "device_timestamp" in data and "timestamp" not in data:
            data["timestamp"] = data.pop("device_timestamp")

        # patient_stabilized → stabilized_flag
        if "patient_stabilized" in data and "stabilized_flag" not in data:
            data["stabilized_flag"] = data.pop("patient_stabilized")

        # distress_level (int 0–10) → pre_intervention_mfcc_variance (float 0–1)
        if "pre_intervention_mfcc_variance" not in data and "distress_level" in data:
            try:
                data["pre_intervention_mfcc_variance"] = min(
                    max(float(data["distress_level"]) / 10.0, 0.0), 1.0
                )
            except (TypeError, ValueError):
                data["pre_intervention_mfcc_variance"] = 0.0

        return data


# ---------------------------------------------------------------------------
# iOS incident payload  (POST /api/incidents from APIService.uploadIncident)
# ---------------------------------------------------------------------------

class AudioBiometrics(BaseModel):
    """14-field audio feature vector produced by Ember's on-device pipeline.

    Field names match the Convex ``audioBiometricsValue`` validator exactly so
    the dict can be forwarded to ``incidents:ingest`` without transformation.
    """

    model_config = ConfigDict(from_attributes=True)

    breath_rate: float
    duration_sec: float
    fundamental_frequency_hz: float
    jitter_approx: float
    mfcc_1_to_13: List[float] = Field(..., min_length=13, max_length=13)
    mfcc_deviation: float
    pitch_escalation: float
    rms: float
    sample_rate_hz: float
    shimmer_approx: float
    spectral_centroid: float
    spectral_flux: float
    spectral_rolloff: float
    zcr_density: float


class IncidentBiometrics(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    audio: Optional[AudioBiometrics] = None
    facial: Optional[Dict[str, Any]] = None
    telemetry_snapshot: Optional[Dict[str, Any]] = None


class IncidentModelMeta(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    gemma_action: str = ""
    gemma_success: Optional[bool] = None
    gemma_total_time_ms: Optional[float] = None
    gemma_raw_response_json: Optional[str] = None


class IncomingIncidentPayload(BaseModel):
    """Full incident payload from APIService.uploadIncident() on iOS.

    Carries the Gemma biometric JSON (biometrics.audio) plus facial stress
    scores, Gemma metadata, and the free-text journal note.
    """

    model_config = ConfigDict(from_attributes=True)

    patient_id: Optional[str] = None
    text: str = ""
    journal_kind: Optional[str] = None
    biometrics: Optional[IncidentBiometrics] = None
    model: Optional[IncidentModelMeta] = None
    context: Optional[Dict[str, Any]] = None
    facial_data: Optional[Dict[str, Any]] = None
    gemma_action: Optional[str] = None
    created_at: Optional[datetime] = None


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


class GemmaMetricsIncidentPayload(BaseModel):
    """Simple JSON ingestion payload from Gemma metrics UIs.

    Intended shape:
      {
        "patient_id": "pat-test-1",
        "description": "optional text",
        "metrics": {
          "anomalyScore": 0.2,
          "f0Hz": 480,
          "rmsDb": -48.6,
          "spectralCentroid": 1361.0,
          "spectralFlux": 0.000001,
          "zcr": 468.75
        }
      }
    """

    model_config = ConfigDict(from_attributes=True)

    patient_id: str
    description: str = ""
    metrics: Dict[str, float] = Field(default_factory=dict)
    source: str = "web_gemma_json"
    created_at: Optional[datetime] = None


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
