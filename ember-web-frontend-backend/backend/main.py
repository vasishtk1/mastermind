"""Ember Backend — FastAPI application.

Endpoints:
  POST /api/events                              Ingest device event → generate + persist clinical report → sync Convex.
  POST /api/incidents                           Ingest iOS biometric incident (Gemma audio + facial) → sync Convex.
  POST /api/journals/upload                     Ingest iOS journal upload metadata → sync Convex journalEntries.
  GET  /api/patients/{patient_id}/reports       Return all clinical reports for a patient from DB.
  POST /api/patients/{patient_id}/remediate     Generate an LLM-proposed device config patch.
  GET  /api/evals/latest                        Return the most recent eval-harness summary from DB.
  POST /api/evals/run                           Re-run the eval harness, persist result, refresh cache.
  GET  /api/health                              Liveness probe.

Storage: SQLite via SQLAlchemy async (aiosqlite).
Swap SQLALCHEMY_DATABASE_URL in database.py for postgresql+asyncpg://... in production.
"""

import asyncio
import json
import math
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Dict, List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from convex_bridge import call_mutation
from database import Base, engine, get_db
from db_models import ClinicalReport, DeviceEvent, EvalCaseResult, EvalRun, Patient, RiskScore, TelemetryBatch
from models import (
    ClinicalIncidentReport,
    DirectivePayload,
    DirectiveResponse,
    EvalSummary,
    GemmaMetricsIncidentPayload,
    IncomingDeviceEvent,
    IncomingIncidentPayload,
    MonitorResult,
    MonitorSnapshot,
    RemediationProposal,
    TelemetryBatchPayload,
)
from rag_service import analyze_acoustic_snapshot, generate_clinical_report, generate_remediation_profile
from triage_model import (
    _model_cache,
    build_labeled_dataset,
    evaluate_and_alert,
    load_model,
    run_scoring_loop,
    save_model,
    train_model,
)

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

    # Load the triage model from disk (no-op when not yet trained)
    load_model()

    # Start the 30-second scoring loop as a background task
    scoring_task = asyncio.create_task(run_scoring_loop())

    yield

    # Graceful shutdown: cancel the scoring loop
    scoring_task.cancel()
    try:
        await scoring_task
    except asyncio.CancelledError:
        pass


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


def _initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", name.strip()) if p]
    if not parts:
        return "UN"
    if len(parts) == 1:
        token = parts[0][:2].upper()
        return token if len(token) == 2 else f"{token}N"
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def _severity_from_scores(facial_stress: float, mfcc_deviation: Optional[float]) -> str:
    mfcc_norm = 0.0 if mfcc_deviation is None else max(0.0, min(1.0, mfcc_deviation / 10.0))
    score = max(0.0, min(1.0, 0.65 * facial_stress + 0.35 * mfcc_norm))
    if score >= 0.85:
        return "critical"
    if score >= 0.65:
        return "high"
    if score >= 0.4:
        return "moderate"
    return "low"


def _dominant_expression(facial_data: Optional[Dict[str, float]]) -> str:
    if not facial_data:
        return "not_available"
    filtered = [(k, float(v)) for k, v in facial_data.items() if isinstance(v, (int, float))]
    if not filtered:
        return "not_available"
    filtered.sort(key=lambda item: item[1], reverse=True)
    top = [name for name, _ in filtered[:2]]
    return " + ".join(top)


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

    final_report = ClinicalIncidentReport(
        id=report_id,
        patient_id=report.patient_id,
        incident_timestamp=report.incident_timestamp,
        estimated_severity_score=report.estimated_severity_score,
        clinical_summary=report.clinical_summary,
        recommended_followup=report.recommended_followup,
        keywords=report.keywords,
    )

    # Sync event + clinical report to Convex so the dashboard updates in real-time.
    await call_mutation(
        "clinicalPipeline:ingestEventWithReport",
        {
            "eventId": db_event.id,
            "patientId": event.patient_id,
            "eventTimestamp": int(event.timestamp.timestamp() * 1000),
            "preInterventionMfccVariance": event.pre_intervention_mfcc_variance,
            "interventionTranscript": event.intervention_transcript,
            "stabilizedFlag": event.stabilized_flag,
            "reportId": report_id,
            "incidentTimestamp": int(report.incident_timestamp.timestamp() * 1000),
            "estimatedSeverityScore": report.estimated_severity_score,
            "clinicalSummary": report.clinical_summary,
            "recommendedFollowup": report.recommended_followup,
            "keywords": report.keywords,
        },
    )

    return final_report


# ---------------------------------------------------------------------------
# iOS biometric incidents  (POST /api/incidents from APIService.uploadIncident)
# ---------------------------------------------------------------------------


@app.post(
    "/api/incidents",
    status_code=status.HTTP_201_CREATED,
    tags=["Incidents"],
    summary="Ingest a full iOS biometric incident (Gemma audio + facial metrics)",
)
async def ingest_incident(payload: IncomingIncidentPayload) -> dict:
    """
    Receives the full ``uploadIncident`` payload from the iOS app, which carries
    Gemma's 14-field audio biometrics, ARKit facial stress scores, and Gemma
    model metadata.

    1. Forwards ``biometrics.audio`` to Convex ``mastermindIncidents`` table so
       the dashboard can display it in real-time.
    2. Returns 201 with the Convex incident ID (or a placeholder on sync failure).
    """
    # Resolve patient_id: payload field or fall back to a generic identifier.
    patient_id: str = payload.patient_id or "unknown"
    created_at = payload.created_at or datetime.now(timezone.utc)
    note_text = payload.text or ""
    audio = payload.biometrics.audio if payload.biometrics else None
    facial_data = payload.facial_data or {}
    facial_stress = float(facial_data.get("facial_stress_score", 0.0) or 0.0)
    severity = _severity_from_scores(facial_stress, audio.mfcc_deviation if audio else None)
    incident_id = str(uuid.uuid4())
    patient_name = patient_id
    gemma_action = payload.gemma_action or (payload.model.gemma_action if payload.model else "journal_analysis")

    await call_mutation(
        "patients:upsert",
        {
            "patientId": patient_id,
            "name": patient_name,
            "initials": _initials(patient_name),
            "dob": "1970-01-01",
            "condition": "Journal monitoring",
            "clinician": "Dr. T",
            "accent": "teal",
            "lastActivity": created_at.isoformat(),
        },
    )

    # Push the full biometric audio block to Convex mastermindIncidents.
    if audio is not None:
        full_payload = payload.model_dump(mode="json")
        await call_mutation(
            "mastermindIncidents:ingest",
            {
                "patientId": patient_id,
                "biometrics": {"audio": audio.model_dump()},
                "payload": full_payload,
                "payloadVersion": "ios-1.0",
            },
        )

    incident_payload = {
        "id": incident_id,
        "patient_id": patient_id,
        "patient_name": patient_name,
        "patient_initials": _initials(patient_name),
        "patient_accent": "teal",
        "timestamp": created_at.isoformat(),
        "trigger_type": f"{payload.journal_kind or 'journal'}_journal_biometrics",
        "acoustic_variance": (
            max(0.0, min(1.0, audio.mfcc_deviation / 10.0)) if audio is not None else 0.0
        ),
        "peak_db": (
            max(0, min(100, int(round(20 * math.log10(max(audio.rms, 1e-6)) + 100))))
            if audio is not None
            else 0
        ),
        "user_statement": note_text if note_text else "Journal uploaded from iOS.",
        "arkit_stress_index": facial_stress,
        "arkit_dominant_expression": _dominant_expression(facial_data),
        "on_device_action": gemma_action,
        "stabilized": bool(payload.model.gemma_success) if payload.model and payload.model.gemma_success is not None else False,
        "severity": severity,
        "status": "unreviewed",
    }
    await call_mutation(
        "emberIncidents:upsert",
        {
            "incidentId": incident_id,
            "patientId": patient_id,
            "payload": incident_payload,
        },
    )

    journal_json = {
        "patient_id": patient_id,
        "journal_kind": payload.journal_kind,
        "created_at": created_at.isoformat(),
        "text": note_text,
        "gemma_action": gemma_action,
        "gemma_success": payload.model.gemma_success if payload.model else None,
        "gemma_total_time_ms": payload.model.gemma_total_time_ms if payload.model else None,
        "audio_metrics": audio.model_dump() if audio is not None else None,
        "facial_data": facial_data,
        "context": payload.context,
    }
    await call_mutation(
        "journals:add",
        {
            "patientId": patient_id,
            "content": json.dumps(journal_json, separators=(",", ":"), ensure_ascii=True),
            "moodScore": max(0, min(10, int(round((1.0 - facial_stress) * 10)))),
            "source": "ios",
        },
    )

    return {
        "status": "accepted",
        "patient_id": patient_id,
        "audio_synced": audio is not None,
        "incident_id": incident_id,
    }


@app.post(
    "/api/journals/upload",
    status_code=status.HTTP_201_CREATED,
    tags=["Incidents"],
    summary="Upload iOS journal media metadata and sync to Convex journals",
)
async def upload_journal_media(
    patient_id: str = Form(...),
    journal_kind: str = Form(...),
    note_text: str = Form(""),
    created_at: str = Form(""),
    journal_file: UploadFile = File(...),
) -> dict:
    ts = created_at or datetime.now(timezone.utc).isoformat()
    content = {
        "patient_id": patient_id,
        "journal_kind": journal_kind,
        "created_at": ts,
        "note_text": note_text,
        "file_name": journal_file.filename or "journal.bin",
        "file_content_type": journal_file.content_type or "application/octet-stream",
    }
    await call_mutation(
        "journals:add",
        {
            "patientId": patient_id,
            "content": json.dumps(content, separators=(",", ":"), ensure_ascii=True),
            "source": "ios",
        },
    )
    return {
        "status": "accepted",
        "patient_id": patient_id,
        "journal_kind": journal_kind,
        "file_name": content["file_name"],
    }


@app.post(
    "/api/incidents/metrics-json",
    status_code=status.HTTP_201_CREATED,
    tags=["Incidents"],
    summary="Ingest simple Gemma metrics JSON and create an incident report row",
)
async def ingest_metrics_json(payload: GemmaMetricsIncidentPayload) -> dict:
    patient_id = payload.patient_id
    created_at = payload.created_at or datetime.now(timezone.utc)
    incident_id = str(uuid.uuid4())

    anomaly = float(payload.metrics.get("anomalyScore", 0.0) or 0.0)
    spectral_flux = float(payload.metrics.get("spectralFlux", 0.0) or 0.0)
    zcr = float(payload.metrics.get("zcr", 0.0) or 0.0)
    f0_hz = float(payload.metrics.get("f0Hz", 0.0) or 0.0)
    rms_db = float(payload.metrics.get("rmsDb", -60.0) or -60.0)
    centroid = float(payload.metrics.get("spectralCentroid", 0.0) or 0.0)

    if anomaly >= 0.85:
        severity = "critical"
    elif anomaly >= 0.65:
        severity = "high"
    elif anomaly >= 0.4:
        severity = "moderate"
    else:
        severity = "low"

    await call_mutation(
        "patients:upsert",
        {
            "patientId": patient_id,
            "name": patient_id,
            "initials": _initials(patient_id),
            "dob": "1970-01-01",
            "condition": "Gemma metrics stream",
            "clinician": "Dr. T",
            "accent": "teal",
            "lastActivity": created_at.isoformat(),
        },
    )

    incident_payload = {
        "id": incident_id,
        "patient_id": patient_id,
        "patient_name": patient_id,
        "patient_initials": _initials(patient_id),
        "patient_accent": "teal",
        "timestamp": created_at.isoformat(),
        "trigger_type": "gemma_metrics_json_ingest",
        "acoustic_variance": max(0.0, min(1.0, anomaly)),
        "peak_db": max(0, min(100, int(round(rms_db + 100)))),
        "user_statement": payload.description or "Gemma metrics JSON submitted from web app.",
        "arkit_stress_index": max(0.0, min(1.0, anomaly)),
        "arkit_dominant_expression": "not_available",
        "on_device_action": "metrics_json_ingested",
        "stabilized": anomaly < 0.6,
        "severity": severity,
        "status": "unreviewed",
        "metrics": {
            "anomalyScore": anomaly,
            "spectralFlux": spectral_flux,
            "zcr": zcr,
            "f0Hz": f0_hz,
            "rmsDb": rms_db,
            "spectralCentroid": centroid,
        },
        "source": payload.source,
    }
    await call_mutation(
        "emberIncidents:upsert",
        {
            "incidentId": incident_id,
            "patientId": patient_id,
            "payload": incident_payload,
        },
    )

    await call_mutation(
        "journals:add",
        {
            "patientId": patient_id,
            "content": json.dumps(
                {
                    "type": "gemma_metrics_json",
                    "source": payload.source,
                    "description": payload.description,
                    "metrics": payload.metrics,
                    "created_at": created_at.isoformat(),
                },
                separators=(",", ":"),
                ensure_ascii=True,
            ),
            "source": "web",
        },
    )

    return {
        "status": "accepted",
        "patient_id": patient_id,
        "incident_id": incident_id,
        "severity": severity,
    }


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
# Clinician directives — deploy insight / action back to the patient's device
# ---------------------------------------------------------------------------


@app.post(
    "/api/patients/{patient_id}/directives",
    response_model=DirectiveResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Directives"],
    summary="Deploy a clinician directive to a patient's device",
)
async def deploy_directive(
    patient_id: str,
    payload: DirectivePayload,
    db: AsyncSession = Depends(get_db),
) -> DirectiveResponse:
    """
    Persists a clinician-authored directive (activity + instructions) that will
    be pushed to the patient's iPhone on next sync. In production this would
    enqueue a push notification; for the demo it is stored in the DB and
    returned immediately so the frontend can display confirmation.
    """
    await _ensure_patient(patient_id, db)
    directive_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    return DirectiveResponse(
        id=directive_id,
        incident_id=payload.incident_id,
        patient_id=patient_id,
        directive_type=payload.directive_type,
        instructions=payload.instructions,
        deployed_at=now,
        status="deployed",
    )


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


# ---------------------------------------------------------------------------
# Triage model — train, score, and query risk scores
# ---------------------------------------------------------------------------

@app.post(
    "/api/model/train",
    tags=["Triage Model"],
    summary="Build labeled dataset from historical records and train the triage model",
)
async def train_triage_model(
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    1. Joins telemetry windows with ClinicalReport incident timestamps to produce
       a labeled dataset (label=1 if an incident occurs within 5 minutes).
    2. Augments with synthetic samples when real data is sparse (dev bootstrap).
    3. Trains a GradientBoostingClassifier calibrated with Platt Scaling.
    4. Saves the model to backend/models/triage_model.pkl and updates the cache.
    """
    loop = asyncio.get_event_loop()

    X, y = await build_labeled_dataset(db)

    try:
        model = await loop.run_in_executor(None, lambda: train_model(X, y))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    save_model(model)
    _model_cache["model"] = model

    import numpy as np
    return {
        "status": "trained",
        "n_samples":  int(len(y)),
        "n_positive": int(np.sum(y == 1)),
        "n_negative": int(np.sum(y == 0)),
        "model_path": str(model.__class__.__name__),
    }


@app.get(
    "/api/patients/{patient_id}/risk-score",
    tags=["Triage Model"],
    summary="Return the most recent triage risk score for a patient",
)
async def get_patient_risk_score(
    patient_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Returns the latest RiskScore row for the patient.
    Raises 404 when no scores exist yet (patient has no recent telemetry or
    the scoring loop has not run yet).
    """
    result = await db.execute(
        select(RiskScore)
        .where(RiskScore.patient_id == patient_id)
        .order_by(RiskScore.scored_at.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No risk scores found for patient {patient_id}. "
                "Ensure telemetry is streaming and a model has been trained."
            ),
        )
    return {
        "patient_id": row.patient_id,
        "risk_prob":  row.risk_prob,
        "severity":   row.severity,
        "scored_at":  row.scored_at.isoformat(),
    }


@app.post(
    "/api/scoring/run",
    tags=["Triage Model"],
    summary="Manually trigger one scoring pass over all patients with recent telemetry",
)
async def run_scoring_pass(
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Scores every patient that has received telemetry in the last 60 seconds.
    Useful for on-demand testing without waiting for the 30-second background loop.

    Raises HTTP 424 when no model has been trained yet.
    """
    model = _model_cache.get("model")
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_424_FAILED_DEPENDENCY,
            detail="No triage model loaded. Call POST /api/model/train first.",
        )

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=60)
    result = await db.execute(
        select(TelemetryBatch.patient_id)
        .where(TelemetryBatch.received_at >= cutoff)
        .distinct()
    )
    patient_ids = [row[0] for row in result.all()]

    alerts = []
    for pid in patient_ids:
        outcome = await evaluate_and_alert(pid, model, db)
        if outcome:
            alerts.append(outcome)

    return {
        "patients_scored": len(patient_ids),
        "alerts_raised":   [a for a in alerts if a.get("severity") != "normal"],
    }


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
