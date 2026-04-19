"""Ember Backend — FastAPI application.

Endpoints:
  POST /api/events                          Ingest device event → generate + store clinical report.
  GET  /api/patients/{patient_id}/reports   Return all clinical reports for a patient.
  GET  /api/health                          Liveness probe.

Storage: in-memory dict for development speed. Replace with SQLite/PostgreSQL in production.
"""

import os
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Dict, List

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from models import ClinicalIncidentReport, IncomingDeviceEvent
from rag_service import generate_clinical_report

load_dotenv()

# ---------------------------------------------------------------------------
# In-memory store  {patient_id: [ClinicalIncidentReport, ...]}
# ---------------------------------------------------------------------------
_reports_store: Dict[str, List[ClinicalIncidentReport]] = defaultdict(list)


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
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:8080",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8080",
    ],
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
