"""Ember Backend — FastAPI application.

Endpoints:
  POST /api/events                              Ingest device event → generate + store clinical report.
  GET  /api/patients/{patient_id}/reports       Return all clinical reports for a patient.
  POST /api/patients/{patient_id}/remediate     Generate an LLM-proposed device config patch.
  GET  /api/evals/latest                        Return the cached eval-harness summary.
  POST /api/evals/run                           Re-run the eval harness and refresh the cache.
  GET  /api/health                              Liveness probe.

Storage: in-memory dict for development speed. Replace with SQLite/PostgreSQL in production.
"""

import os
import threading
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from models import (
    ClinicalIncidentReport,
    EvalSummary,
    IncomingDeviceEvent,
    RemediationProposal,
)
from rag_service import generate_clinical_report, generate_remediation_profile

load_dotenv()

# ---------------------------------------------------------------------------
# In-memory store  {patient_id: [ClinicalIncidentReport, ...]}
# ---------------------------------------------------------------------------
_reports_store: Dict[str, List[ClinicalIncidentReport]] = defaultdict(list)

# Cached eval-harness summary so the dashboard never has to wait for a
# 10-call LLM run to render. Re-populated by POST /api/evals/run.
_eval_cache: Dict[str, Optional[EvalSummary]] = {"latest": None}
_eval_cache_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not os.environ.get("GEMINI_API_KEY"):
        print(
            "\n[EMBER WARNING] GEMINI_API_KEY is not set. "
            "POST /api/events will fail. Set it in backend/.env\n"
        )
    yield


app = FastAPI(
    title="Ember Clinical Backend",
    description="Receives on-device distress events and generates compliance-grade clinical incident reports via RAG.",
    version="1.0.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — allow the Vite dev server (port 8080/5173) and any localhost origin
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    # Match any localhost / 127.0.0.1 port so `npm run dev` (8080),
    # `vite` default (5173), and `npm run preview` (4173) all work.
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/health", tags=["Infra"])
def health_check():
    """Liveness probe for load balancers and CI checks."""
    return {"status": "ok", "service": "ember-backend"}


@app.post(
    "/api/events",
    status_code=status.HTTP_200_OK,
    tags=["Events"],
    summary="Ingest a device distress event",
)
def ingest_event(event: IncomingDeviceEvent) -> ClinicalIncidentReport:
    """
    Accepts an `IncomingDeviceEvent` from the patient's iPhone,
    runs it through the RAG pipeline to produce a `ClinicalIncidentReport`,
    persists the report in memory, and returns it.

    Raises HTTP 422 if the payload fails Pydantic validation.
    Raises HTTP 502 if the LLM pipeline fails.
    """
    try:
        report = generate_clinical_report(event)
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

    _reports_store[report.patient_id].append(report)
    # Keep newest first for the dashboard
    _reports_store[report.patient_id].sort(
        key=lambda r: r.incident_timestamp, reverse=True
    )
    return report


@app.get(
    "/api/patients/{patient_id}/reports",
    tags=["Reports"],
    summary="Retrieve clinical reports for a patient",
)
def get_patient_reports(patient_id: str) -> List[ClinicalIncidentReport]:
    """
    Returns all `ClinicalIncidentReport` objects stored for the given patient,
    sorted newest-first.

    Returns an empty list (not 404) when no reports exist yet — the dashboard
    handles the empty state gracefully.
    """
    return _reports_store.get(patient_id, [])


# ---------------------------------------------------------------------------
# Agentic Remediation
# ---------------------------------------------------------------------------


@app.post(
    "/api/patients/{patient_id}/remediate",
    tags=["Remediation"],
    summary="Generate an LLM-proposed device configuration patch",
)
def remediate_patient(patient_id: str) -> RemediationProposal:
    """
    Picks the most recent `ClinicalIncidentReport` for the patient and asks the
    Gemini-backed remediation pipeline to propose new acoustic thresholds and
    a new on-device system prompt. The clinician reviews the returned proposal
    in the UI before approving deployment to the edge device.

    Raises HTTP 404 if no reports exist for this patient.
    Raises HTTP 502 if the LLM pipeline fails or returns an unparseable proposal.
    """
    reports = _reports_store.get(patient_id, [])
    if not reports:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No clinical reports stored for patient {patient_id}. "
                "Ingest at least one event via POST /api/events before remediating."
            ),
        )

    # Reports are kept newest-first by ingest_event.
    latest_report = reports[0]

    try:
        proposal = generate_remediation_profile(latest_report)
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
# Evaluation Harness
# ---------------------------------------------------------------------------


def _refresh_eval_cache() -> EvalSummary:
    """Run the eval harness (blocking) and update the in-memory cache."""
    # Local import to avoid pulling the heavy module at app boot.
    from evals import run_evals

    summary = run_evals(verbose=False)
    with _eval_cache_lock:
        _eval_cache["latest"] = summary
    return summary


@app.get(
    "/api/evals/latest",
    tags=["Evals"],
    summary="Return the most recent evaluation harness summary",
)
def get_latest_eval() -> EvalSummary:
    """
    Returns the cached `EvalSummary` from the most recent harness run. If the
    cache is empty (e.g. on a fresh boot) the harness is executed once on the
    request thread to populate it. Subsequent calls are O(1).

    Raises HTTP 502 if the harness fails (typically a missing `GEMINI_API_KEY`).
    """
    with _eval_cache_lock:
        cached = _eval_cache["latest"]
    if cached is not None:
        return cached

    try:
        return _refresh_eval_cache()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Eval harness error: {exc}",
        ) from exc


@app.post(
    "/api/evals/run",
    tags=["Evals"],
    summary="Re-run the evaluation harness and refresh the cache",
)
def run_eval_endpoint() -> EvalSummary:
    """
    Forces a fresh evaluation harness run and returns the new `EvalSummary`.
    This is a blocking call — expect ~10 LLM round-trips of latency.
    """
    try:
        return _refresh_eval_cache()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Eval harness error: {exc}",
        ) from exc
