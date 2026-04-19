"""Ember Backend — FastAPI application.

Endpoints:
  POST /api/events                              Ingest device event → generate + persist clinical report.
  GET  /api/patients/{patient_id}/reports       Return all clinical reports for a patient from DB.
  POST /api/patients/{patient_id}/remediate     Generate an LLM-proposed device config patch.
  GET  /api/evals/latest                        Return the most recent eval-harness summary from DB.
  POST /api/evals/run                           Re-run the eval harness, persist result, refresh cache.
  GET  /api/health                              Liveness probe.

Storage: SQLite via SQLAlchemy async (aiosqlite).
Swap SQLALCHEMY_DATABASE_URL in database.py for postgresql+asyncpg://... in production.
"""

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import Base, engine, get_db
from db_models import ClinicalReport, DeviceEvent, EvalCaseResult, EvalRun, Patient, TelemetryBatch
from models import (
    ClinicalIncidentReport,
    EvalSummary,
    IncomingDeviceEvent,
    MonitorResult,
    MonitorSnapshot,
    RemediationProposal,
    TelemetryBatchPayload,
)
from rag_service import analyze_acoustic_snapshot, generate_clinical_report, generate_remediation_profile

load_dotenv()

# ---------------------------------------------------------------------------
# In-memory cache for the most recent EvalSummary (populated after each run
# and pre-loaded from the DB on startup so the first GET is instant).
# ---------------------------------------------------------------------------
_eval_cache: Dict[str, Optional[EvalSummary]] = {"latest": None}


# ---------------------------------------------------------------------------
# Lifespan: create all tables and warm the eval cache from DB
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables if they don't exist (no-op when already present).
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    if not os.environ.get("GEMINI_API_KEY"):
        print(
            "\n[EMBER WARNING] GEMINI_API_KEY is not set. "
            "POST /api/events and POST /api/evals/run will fail. "
            "Set it in backend/.env\n"
        )

    # Pre-load the latest eval result from the DB so the first GET /api/evals/latest
    # is served from cache rather than re-running 10 LLM calls.
    async with engine.connect() as conn:
        try:
            from sqlalchemy.ext.asyncio import AsyncSession as _AS
            async with _AS(conn) as warmup_session:
                row = await warmup_session.execute(
                    select(EvalRun).order_by(EvalRun.timestamp.desc()).limit(1)
                )
                latest_run = row.scalar_one_or_none()
                if latest_run is not None:
                    _eval_cache["latest"] = EvalSummary(**latest_run.summary_json)
                    print(
                        f"[EMBER] Loaded eval cache from DB "
                        f"(run at {latest_run.timestamp.isoformat()})"
                    )
        except Exception as exc:
            print(f"[EMBER] Could not warm eval cache from DB: {exc}")

    yield


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Ember Clinical Backend",
    description=(
        "Receives on-device distress events and generates compliance-grade "
        "clinical incident reports via RAG. Persists the full event lifecycle "
        "in SQLite (swap for Postgres in production)."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — match any localhost / 127.0.0.1 port (dev, preview, etc.)
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helper: upsert patient row
# ---------------------------------------------------------------------------
async def _ensure_patient(patient_id: str, db: AsyncSession) -> None:
    """Insert a minimal Patient row if one doesn't exist yet.

    This keeps the patients table consistent without requiring a separate
    patient-creation endpoint before the first device event arrives.
    """
    existing = await db.get(Patient, patient_id)
    if existing is None:
        db.add(Patient(id=patient_id, name=patient_id))


# ---------------------------------------------------------------------------
# Liveness probe
# ---------------------------------------------------------------------------
@app.get("/api/health", tags=["Infra"])
async def health_check():
    return {"status": "ok", "service": "ember-backend"}


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------
@app.post(
    "/api/events",
    status_code=status.HTTP_200_OK,
    tags=["Events"],
    summary="Ingest a device distress event",
)
async def ingest_event(
    event: IncomingDeviceEvent,
    db: AsyncSession = Depends(get_db),
) -> ClinicalIncidentReport:
    """
    1. Persist the raw `DeviceEvent` to SQLite.
    2. Run the Gemini RAG pipeline (off the async event loop to avoid blocking).
    3. Persist the resulting `ClinicalReport`.
    4. Return the `ClinicalIncidentReport` to the caller.
    """
    await _ensure_patient(event.patient_id, db)

    # Persist the device event first so we always have the raw payload
    # even if the RAG pipeline later fails.
    db_event = DeviceEvent(
        id=str(uuid.uuid4()),
        patient_id=event.patient_id,
        timestamp=event.timestamp,
        pre_intervention_mfcc_variance=event.pre_intervention_mfcc_variance,
        intervention_transcript=event.intervention_transcript,
        stabilized_flag=event.stabilized_flag,
    )
    db.add(db_event)
    # flush to get the id without committing (commit happens in get_db on exit)
    await db.flush()

    # Run the synchronous Gemini pipeline in a thread so we don't block
    # the async event loop for the full LLM round-trip (~2–5 s).
    loop = asyncio.get_event_loop()
    try:
        report: ClinicalIncidentReport = await loop.run_in_executor(
            None, generate_clinical_report, event
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"RAG pipeline error: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unexpected pipeline error: {exc}",
        ) from exc

    # Persist the clinical report linked to the device event.
    report_id = str(uuid.uuid4())
    db_report = ClinicalReport(
        id=report_id,
        event_id=db_event.id,
        patient_id=report.patient_id,
        incident_timestamp=report.incident_timestamp,
        estimated_severity_score=report.estimated_severity_score,
        clinical_summary=report.clinical_summary,
        recommended_followup=report.recommended_followup,
        keywords=report.keywords,
    )
    db.add(db_report)

    # Return the Pydantic model (report_id is injected via the alias "id").
    return ClinicalIncidentReport(
        id=report_id,
        patient_id=report.patient_id,
        incident_timestamp=report.incident_timestamp,
        estimated_severity_score=report.estimated_severity_score,
        clinical_summary=report.clinical_summary,
        recommended_followup=report.recommended_followup,
        keywords=report.keywords,
    )


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
@app.get(
    "/api/patients/{patient_id}/reports",
    tags=["Reports"],
    summary="Retrieve clinical reports for a patient",
)
async def get_patient_reports(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
) -> List[ClinicalIncidentReport]:
    """
    Returns all `ClinicalIncidentReport` objects for the given patient,
    ordered newest-first. Returns an empty list when no reports exist yet.
    """
    result = await db.execute(
        select(ClinicalReport)
        .where(ClinicalReport.patient_id == patient_id)
        .order_by(ClinicalReport.incident_timestamp.desc())
    )
    rows = result.scalars().all()
    return [ClinicalIncidentReport.model_validate(row) for row in rows]


# ---------------------------------------------------------------------------
# Agentic Remediation
# ---------------------------------------------------------------------------
@app.post(
    "/api/patients/{patient_id}/remediate",
    tags=["Remediation"],
    summary="Generate an LLM-proposed device configuration patch",
)
async def remediate_patient(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
) -> RemediationProposal:
    """
    Fetches the most recent `ClinicalReport` for the patient from the DB
    and calls the Gemini remediation pipeline to propose new device thresholds
    and a rewritten on-device system prompt.

    Raises HTTP 404 if no reports are stored for this patient.
    Raises HTTP 502 if the LLM pipeline fails or returns an unparseable proposal.
    """
    result = await db.execute(
        select(ClinicalReport)
        .where(ClinicalReport.patient_id == patient_id)
        .order_by(ClinicalReport.incident_timestamp.desc())
        .limit(1)
    )
    db_report = result.scalar_one_or_none()

    if db_report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No clinical reports stored for patient {patient_id}. "
                "Ingest at least one event via POST /api/events before remediating."
            ),
        )

    latest_report = ClinicalIncidentReport.model_validate(db_report)

    loop = asyncio.get_event_loop()
    try:
        proposal: RemediationProposal = await loop.run_in_executor(
            None, generate_remediation_profile, latest_report
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Remediation pipeline error: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unexpected remediation pipeline error: {exc}",
        ) from exc

    return proposal


# ---------------------------------------------------------------------------
# Real-time acoustic monitor (Gemini inference on live mic snapshot)
# ---------------------------------------------------------------------------


@app.post(
    "/api/patients/{patient_id}/monitor",
    response_model=MonitorResult,
    tags=["Monitor"],
    summary="Run real-time Gemini inference on a live acoustic snapshot",
)
async def monitor_patient(
    patient_id: str,
    snapshot: MonitorSnapshot,
) -> MonitorResult:
    """
    Receives a 10-second acoustic snapshot from the browser, runs a fast Gemini
    classification to determine if the signals indicate an active distress episode,
    and returns a structured result with severity score and clinical reasoning.

    This endpoint is called by the PatientMonitor page every ~10 s while the
    microphone is active. The LLM call is offloaded to a thread pool so the
    async event loop is never blocked.
    """
    loop = asyncio.get_event_loop()
    result: MonitorResult = await loop.run_in_executor(
        None,
        analyze_acoustic_snapshot,
        snapshot.rms_db,
        snapshot.spectral_flux,
        snapshot.zcr,
        snapshot.f0_hz,
        snapshot.spectral_centroid,
    )
    return result


# ---------------------------------------------------------------------------
# Telemetry ingest
# ---------------------------------------------------------------------------


@app.post(
    "/api/telemetry/batch",
    status_code=status.HTTP_202_ACCEPTED,
    tags=["Telemetry"],
    summary="Ingest a 500-ms aggregated telemetry batch from the browser",
)
async def ingest_telemetry_batch(
    payload: TelemetryBatchPayload,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Receives a batched telemetry window from the browser TelemetryWorker.
    Each batch covers 500 ms of aggregated facial, audio, motion, and pointer data.
    Responds with 202 Accepted immediately — processing is fire-and-forget.
    """
    await _ensure_patient(payload.patient_id, db)
    db.add(
        TelemetryBatch(
            patient_id=payload.patient_id,
            window_start_ms=payload.window_start_ms,
            window_end_ms=payload.window_end_ms,
            face_json=payload.face,
            audio_json=payload.audio,
            motion_json=payload.motion,
            pointer_json=payload.pointer,
        )
    )
    return {
        "status": "accepted",
        "patient_id": payload.patient_id,
        "window_ms": payload.window_end_ms - payload.window_start_ms,
    }


# ---------------------------------------------------------------------------
# Evaluation harness — DB persistence helper
# ---------------------------------------------------------------------------
async def _persist_eval_summary(summary: EvalSummary, db: AsyncSession) -> None:
    """Write a completed EvalSummary to the eval_runs and eval_case_results tables."""
    run_id = str(uuid.uuid4())

    db_run = EvalRun(
        id=run_id,
        timestamp=summary.generated_at,
        model=summary.model,
        utility_score=summary.utility_precision_at_high,
        fairness_cv=summary.fairness_coefficient_of_variation,
        total_cases=summary.dataset_size,
        failed_cases=summary.failed_cases,
        # Store the full EvalSummary as JSON so GET /api/evals/latest is O(1).
        summary_json=summary.model_dump(mode="json"),
    )
    db.add(db_run)
    await db.flush()

    for case in summary.case_results:
        db.add(
            EvalCaseResult(
                id=str(uuid.uuid4()),
                run_id=run_id,
                patient_id=case.get("patient_id", ""),
                dialect_group=case.get("dialect", ""),
                expected_severity=bool(case.get("expected_high", False)),
                actual_score=case.get("severity_score"),
                passed=bool(case.get("correctly_flagged", False)),
            )
        )


# ---------------------------------------------------------------------------
# Evaluation harness endpoints
# ---------------------------------------------------------------------------
@app.get(
    "/api/evals/latest",
    tags=["Evals"],
    summary="Return the most recent evaluation harness summary",
)
async def get_latest_eval(
    db: AsyncSession = Depends(get_db),
) -> EvalSummary:
    """
    Serves from the in-memory cache when available (populated at startup and
    after each run). Falls back to the DB on a cache miss. Returns 404 when no
    runs have been recorded — call POST /api/evals/run to trigger the first one.
    """
    if _eval_cache["latest"] is not None:
        return _eval_cache["latest"]

    # Cache miss — check DB.
    result = await db.execute(
        select(EvalRun).order_by(EvalRun.timestamp.desc()).limit(1)
    )
    latest_run = result.scalar_one_or_none()

    if latest_run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "No evaluation runs recorded yet. "
                "Trigger one via POST /api/evals/run."
            ),
        )

    summary = EvalSummary(**latest_run.summary_json)
    _eval_cache["latest"] = summary
    return summary


@app.post(
    "/api/evals/run",
    tags=["Evals"],
    summary="Re-run the evaluation harness and persist the result",
)
async def run_eval_endpoint(
    db: AsyncSession = Depends(get_db),
) -> EvalSummary:
    """
    Forces a fresh evaluation harness run (~10 LLM calls, 30–90 s), persists
    the `EvalRun` + `EvalCaseResult` rows to SQLite, updates the in-memory
    cache, and returns the new `EvalSummary`.
    """
    # Import lazily — the module-level EVAL_DATASET construction is cheap
    # but the Gemini calls only happen inside run_evals().
    from evals import run_evals

    loop = asyncio.get_event_loop()
    try:
        summary: EvalSummary = await loop.run_in_executor(
            None, lambda: run_evals(verbose=False)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Eval harness error: {exc}",
        ) from exc

    await _persist_eval_summary(summary, db)
    _eval_cache["latest"] = summary
    return summary
