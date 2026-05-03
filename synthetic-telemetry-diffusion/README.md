# Synthetic telemetry diffusion (offline)

First draft of a **vector diffusion** package: learns distributions of fixed-length telemetry summary vectors, then samples new vectors for augmentation and testing. See `PLAN.md` for motivation.

## Layout

| Path | Purpose |
|------|---------|
| `feature_schema.json` | Frozen feature order (v1) |
| `FEATURE_SCHEMA.md` | Human-readable field definitions |
| `configs/default.yaml` | Data + model + training hyperparameters |
| `src/synthetic_telemetry/` | Features, DDPM, training loop |
| `scripts/build_dataset.py` | SQLite → `features.npy` / `labels.npy` / `meta.csv` |
| `scripts/train_diffusion.py` | Train MLP denoiser + save `checkpoints/` |
| `scripts/sample_diffusion.py` | Sample denormalized vectors to `samples/` |

## Setup

```bash
cd synthetic-telemetry-diffusion
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# optional editable install
pip install -e .
```

## Smoke test (no SQLite)

```bash
export PYTHONPATH=src
python scripts/build_dataset.py --dummy-rows 512
python scripts/train_diffusion.py
python scripts/sample_diffusion.py --num-samples 64
```

## Real data (Ember SQLite)

Point `--db` at the backend database that contains `telemetry_batches` (same shape as `TelemetryWorker` POST payloads).

```bash
export PYTHONPATH=src
python scripts/build_dataset.py \
  --db ../ember-web-frontend-backend/backend/ember.db \
  --output-dir data/processed
```

Optional weak labels for “incident within lookahead”:

```csv
patient_id,incident_time_ms
pat-001,1730000000000
```

```bash
python scripts/build_dataset.py --db .../ember.db --incidents-csv incidents.csv
```

## Notes

- Default `train.device` is `cpu`. Set to `mps` (Apple GPU) or `cuda` when available.
- Outputs are **not** clinical-grade; see `INTEGRATION.md` and `QUALITY_NOTES.md`.
