"""SQLAlchemy ORM models for the Ember clinical platform.

Table layout:
  patients          — one row per monitored patient
  device_events     — raw payload sent by the on-device AI
  clinical_reports  — RAG-generated formal incident report (1-to-1 with device_event)
  eval_runs         — a single execution of the evaluation harness
  eval_case_results — one row per synthetic test case inside an eval run

All primary keys are UUID strings generated at insert time so rows are
globally unique without relying on SQLite's auto-increment.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def _new_uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Patient
# ---------------------------------------------------------------------------
class Patient(Base):
    """Minimal patient record.  Richer demographics live in the frontend mock
    for now; this table grows as the product matures."""

    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    dialect_group: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    baseline_mfcc: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    events: Mapped[list["DeviceEvent"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan"
    )
    reports: Mapped[list["ClinicalReport"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# DeviceEvent
# ---------------------------------------------------------------------------
class DeviceEvent(Base):
    """Verbatim structured payload from the on-device Cactus engine.

    Raw audio never leaves the device — only derived metrics + transcript.
    """

    __tablename__ = "device_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_uuid)
    patient_id: Mapped[str] = mapped_column(
        String, ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    pre_intervention_mfcc_variance: Mapped[float] = mapped_column(Float, nullable=False)
    intervention_transcript: Mapped[str] = mapped_column(Text, nullable=False)
    stabilized_flag: Mapped[bool] = mapped_column(Boolean, nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    patient: Mapped["Patient"] = relationship(back_populates="events")
    report: Mapped[Optional["ClinicalReport"]] = relationship(
        back_populates="event", uselist=False
    )


# ---------------------------------------------------------------------------
# ClinicalReport
# ---------------------------------------------------------------------------
class ClinicalReport(Base):
    """Formal clinical incident report produced by the RAG pipeline."""

    __tablename__ = "clinical_reports"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_uuid)
    event_id: Mapped[str] = mapped_column(
        String, ForeignKey("device_events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    patient_id: Mapped[str] = mapped_column(
        String, ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    incident_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    estimated_severity_score: Mapped[float] = mapped_column(Float, nullable=False)
    clinical_summary: Mapped[str] = mapped_column(Text, nullable=False)
    recommended_followup: Mapped[str] = mapped_column(Text, nullable=False)
    # SQLite stores JSON as TEXT; SQLAlchemy serialises/deserialises automatically.
    keywords: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    event: Mapped["DeviceEvent"] = relationship(back_populates="report")
    patient: Mapped["Patient"] = relationship(back_populates="reports")


# ---------------------------------------------------------------------------
# EvalRun
# ---------------------------------------------------------------------------
class EvalRun(Base):
    """One execution of the evaluation harness (10 synthetic cases)."""

    __tablename__ = "eval_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_uuid)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    model: Mapped[str] = mapped_column(String, nullable=False)
    utility_score: Mapped[float] = mapped_column(Float, nullable=False)
    fairness_cv: Mapped[float] = mapped_column(Float, nullable=False)
    total_cases: Mapped[int] = mapped_column(Integer, nullable=False)
    failed_cases: Mapped[int] = mapped_column(Integer, nullable=False)
    # Full EvalSummary payload kept as denormalised JSON for O(1) retrieval
    # by the dashboard — no need to re-aggregate every time.
    summary_json: Mapped[dict] = mapped_column(JSON, nullable=False)

    cases: Mapped[list["EvalCaseResult"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="selectin"
    )


# ---------------------------------------------------------------------------
# EvalCaseResult
# ---------------------------------------------------------------------------
class TelemetryBatch(Base):
    """One 500-ms aggregated telemetry batch from the browser sensor pipeline."""

    __tablename__ = "telemetry_batches"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_uuid)
    patient_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    window_start_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    window_end_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    # Full batch payload stored as JSON for flexibility; key fields extracted above
    # for fast SQL-level aggregation.
    face_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    audio_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    motion_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    pointer_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )


class EvalCaseResult(Base):
    """One synthetic test-case result within an EvalRun.

    Normalised for SQL-level queries (e.g. "show me all AAVE cases that
    failed across every run").  Full detail lives in EvalRun.summary_json.
    """

    __tablename__ = "eval_case_results"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_uuid)
    run_id: Mapped[str] = mapped_column(
        String, ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    patient_id: Mapped[str] = mapped_column(String, nullable=False)
    dialect_group: Mapped[str] = mapped_column(String, nullable=False)
    # True = this case was expected to be flagged HIGH severity
    expected_severity: Mapped[bool] = mapped_column(Boolean, nullable=False)
    actual_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # True = the model produced the correct verdict for this case
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)

    run: Mapped["EvalRun"] = relationship(back_populates="cases")
