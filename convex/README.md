# Convex — shared data for web + iOS

## Deployment URLs (this project)

| Use | URL |
|-----|-----|
| **Client** (`VITE_CONVEX_URL`) — React, iOS SDK | [https://acoustic-minnow-665.convex.cloud](https://acoustic-minnow-665.convex.cloud/) |
| **HTTP / site** (optional, for Convex HTTP actions) | [https://acoustic-minnow-665.convex.site](https://acoustic-minnow-665.convex.site) |

Copy `.env.example` to `.env.local` and set `VITE_CONVEX_URL` to the **`.convex.cloud`** URL so the dashboard and iOS hit the same backend. See [Convex docs](https://docs.convex.dev/).

## MasterMind `DoctorPayload` → `biometrics.audio`

The iOS app should call the public mutation **`incidents.ingest`** with:

```json
{
  "patientId": "pat-mira",
  "patientName": "Mira K.",
  "payloadVersion": "1.0.0",
  "biometrics": {
    "audio": {
      "breath_rate": 24.66,
      "duration_sec": 2.43,
      "fundamental_frequency_hz": 71.75,
      "jitter_approx": 0.246,
      "mfcc_1_to_13": [13 numbers],
      "mfcc_deviation": 4.12,
      "pitch_escalation": 0,
      "rms": 0.11,
      "sample_rate_hz": 16000,
      "shimmer_approx": 0.229,
      "spectral_centroid": 1286.34,
      "spectral_flux": 0.0873,
      "spectral_rolloff": 2564.45,
      "zcr_density": 0.1026
    }
  }
}
```

`mfcc_1_to_13` must always have length **13**.

### From the CLI (same project)

```bash
npx convex run incidents:ingest --arg-file payload.json
```

### From iOS

Use the Convex client for your stack with the **same deployment URL** as `VITE_CONVEX_URL` in the web app. Call mutation `incidents:ingest` with the JSON above.

## Tables (application data model)

| Table | Purpose |
|-------|---------|
| `patients` | Clinician roster (demographics, accent, optional dialect / baseline MFCC). |
| `emberIncidents` | Dashboard triage incidents (`IncidentReport` JSON in `payload`). |
| `deviceEvents` | Raw on-device engine rows (parity with SQLite `device_events`). |
| `clinicalReports` | RAG clinical reports (parity with SQLite `clinical_reports`). |
| `evalRuns` | Eval harness runs + full `EvalSummary` JSON in `summary`. |
| `telemetryBatches` | 500 ms browser telemetry windows (face/audio/motion/pointer JSON). |
| `directives` | Deployed clinician directives (persisted; survives refresh). |
| `remediationProposals` | Optional LLM remediation payloads for audit / replay. |
| `mastermindIncidents` | One row per iOS MasterMind incident (`biometrics.audio`). |
| `benchmarkRuns` | Clinician browser sessions; optional `mastermindAudioSnapshot`. |
| `journalEntries` | Patient text journals. |

## Mutations / queries (Convex modules)

| Module | Main entry points |
|--------|-------------------|
| `patients` | `upsert`, `list`, `getByPatientId` |
| `emberIncidents` | `upsert`, `listByPatient`, `listRecent` |
| `clinicalPipeline` | `ingestDeviceEvent`, `ingestClinicalReport`, `ingestEventWithReport`, `listClinicalReportsByPatient`, `listDeviceEventsByPatient` |
| `evals` | `saveRun`, `latest`, `listRecent` |
| `telemetry` | `ingestBatch`, `listByPatient` |
| `directives` | `record`, `listByPatient` |
| `remediation` | `saveProposal`, `latestForPatient` |
| `incidents` | `ingest` (MasterMind) — unchanged |
| `benchmarks` | `record`, `listByPatient` |
| `journals` | `add`, `listByPatient` |

## Queries

- **`compare.snapshotForPatient`** — benchmarks + iOS incidents + journals for a patient.
- **`compare.fullSnapshotForPatient`** — same plus patient row, ember incidents, clinical reports, device events, directives, telemetry tail.
- **`validation.deviceGroundingStats`** — aggregates over recent MasterMind incidents (Model Audit page).

## Local dev

Terminal 1: `npm run convex:dev`  
Terminal 2: `npm run dev`

Ensure `.env.local` contains `VITE_CONVEX_URL` (created by `npx convex dev`).
