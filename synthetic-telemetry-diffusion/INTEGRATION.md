# Integrating with the main MasterMind / Ember repo

## What this package produces

1. **`data/processed/features.npy`** — `(N, 36)` float32 rows aligned with `feature_schema.json`.
2. **`data/processed/labels.npy`** — optional `pre_incident` flags (0/1) when `--incidents-csv` is supplied.
3. **`data/processed/meta.csv`** — `idx`, `patient_id`, `window_start_ms`, `window_end_ms` aligned row-wise with `features.npy`.
4. **`checkpoints/best.pt`** / **`last.pt`** — PyTorch weights for `MLPDenoiser` (not loaded by the web app).
5. **`checkpoints/norm.npz`** — `mean` and `std` vectors for denormalizing samples.
6. **`samples/synthetic_vectors.npy`** — generated raw-feature rows + sidecar `.json` with `feature_names`.

## How the main project can consume this

- **Training a classifier** (future triage model): load `features.npy` + `labels.npy` in a Python notebook or script under `ember-web-frontend-backend/backend/` without importing PyTorch in production.
- **Eval / dashboard mocks**: convert a slice of `synthetic_vectors.npy` to JSON fixtures matching whatever UI shape you need (manual mapping).
- **Do not** add `torch` to Convex or to the default FastAPI dependency set unless you explicitly want GPU servers for inference.

## Path references

- Ember batch JSON layout: `ember-web-frontend-backend/src/workers/TelemetryWorker.ts` (`buildBatch`).
- SQLite table: `telemetry_batches` in `ember-web-frontend-backend/backend/db_models.py`.

## Provenance

Any file under `samples/` or rows generated from the diffusion model must be labeled **synthetic** in downstream UIs and datasets until a validation workflow signs off.
