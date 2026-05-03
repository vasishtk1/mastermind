# Plan: Synthetic “patient moment” generator (diffusion model)

## The big picture (read this first)

**What we’re doing:** The MasterMind / Ember app watches signals from a patient over short periods of time—things like voice-related numbers, face/movement summaries, and similar metrics—rolled up into a **single list of numbers** for each short window (think: a row in a spreadsheet where each column is one measurement).

**The problem:** Situations where something **bad is about to happen** are **rare** in real data. Machine learning works better when it sees many examples, including rare ones. We can’t always wait for real crises to collect enough examples.

**The idea:** We train a computer model called a **diffusion model** that learns patterns from lots of **normal** windows (and labeled windows when we have them). Then it can **dream up new rows** of numbers that **look statistically like real patient windows** but are **not copies** of any one real moment. Those fake rows are **synthetic data**.

**What we use it for:** Mostly **offline**—to train or test other models, to fill out evaluation sets, and to stress-test dashboards—**not** to replace doctors or the live app on day one. Later, if it proves reliable, we can connect it more tightly to the main project by **importing files** (like CSV or database seeds) that the rest of the app already knows how to read.

**Where the heavy work lives:** In **this folder** (or a separate repo), not inside the live web backend. That keeps experiments safe and the main codebase simple.

---

## Technical goal

Build a **small diffusion model** that operates on **fixed-length numeric feature vectors** (one vector per aggregated time window), trained on data derived from MasterMind/Ember telemetry or equivalent summaries. Sample new vectors for **data augmentation**, **evaluation**, and **pipeline stress-testing**, then **export** artifacts consumable by the main project (CSV, Parquet, JSON fixtures, or SQLite seed scripts)—without requiring PyTorch or training code in Convex or the production FastAPI hot path.

---

## Scope: what we are building vs not building

| In scope | Out of scope (initially) |
|----------|---------------------------|
| Vectors of tens to low hundreds of floats per window | Raw video, full audio waveforms, or giant images |
| Offline training and sampling in Python | Running diffusion inside the browser on every 500 ms batch |
| Exporting synthetic rows for training/evals/mocks | Replacing LLM clinical report generation |
| Optional simple conditioning (e.g. “normal” vs “pre-incident”) when labels exist | Clinical deployment claims without validation |

---

## Phase A — Define the feature vector (schema)

1. **Choose window length** aligned with existing ideas (e.g. 15–30 seconds of aggregated batches).
2. **List every number** in the vector with: name, meaning, units, valid range, aggregation rule (mean, variance, slope, etc.).
3. **Freeze v1** of the schema in a small table or JSON spec so real pipelines and synthetic pipelines stay identical.
4. **Reference:** align with `mastermind_model_pseudocode.md` feature ideas where possible (face, audio, motion, pointer) so the same vector can one day feed a triage classifier.

**Deliverable:** `FEATURE_SCHEMA.md` or `feature_schema.json` in this directory.

---

## Phase B — Build a real-data → vector pipeline

1. **Source:** SQLite `telemetry_batches` (via backend export), Convex export, or a CSV dump—whatever is available and legal for your use case.
2. **Script:** For each patient and time range, aggregate batches into **one vector per window** using the Phase A schema.
3. **Labels (optional but valuable):** If incident timestamps exist, mark windows where an incident occurred within a defined lookahead (e.g. 5 minutes), matching the pseudocode’s positive-label idea.
4. **Output:** `numpy` / `parquet` on disk with shapes `(N, D)` for features and `(N,)` or `(N, C)` for labels.

**Deliverable:** `scripts/build_dataset.py` (or similar) + a documented example run.

---

## Phase C — Model architecture (diffusion on vectors)

1. **Baseline:** Denoising Diffusion Probabilistic Model (DDPM) in **D-dimensional** space with a small **MLP** or lightweight **1D U-Net** treating the vector as a single “image row” of channels.
2. **Noise schedule:** Linear or cosine beta schedule; standard choices from literature.
3. **Conditioning (optional v2):** Class-conditional or embedding for “normal” vs “pre-incident” if label counts support it.

**Deliverable:** `model/diffusion.py` + `model/train.py` (names flexible).

---

## Phase D — Training

1. **Split:** Train / validation / test by patient or time block to avoid leakage.
2. **Metrics:** NLL or simplified diffusion loss during training; **downstream** check: train a tiny classifier on real+synthetic vs real-only and compare calibration or AUC on a **held-out real** set.
3. **Compute:** Local GPU preferred; CPU possible for small D and N.

**Deliverable:** Saved checkpoint + `config.yaml` recording hyperparameters and data version.

---

## Phase E — Sampling and quality checks

1. **Sample** M synthetic vectors from the trained model.
2. **Sanity checks:** Per-dimension min/max vs real data, correlation structure spot-checks, no NaNs/Infs.
3. **Reject or filter** samples outside clinically plausible ranges if hard bounds are known.

**Deliverable:** `samples/synthetic_v1.parquet` + a short `QUALITY_NOTES.md`.

---

## Phase F — Tie-back to the main MasterMind project

1. **Do not** embed training stack into Convex.
2. **Do** provide one of:
   - CSV/JSON fixtures for frontend mocks or Python evals;
   - Optional SQLite seed script compatible with existing tables **only if** the schema maps cleanly;
   - Documented mapping from vector fields back to `TelemetryBatch`-like summaries if the main app consumes that shape.
3. **Document** provenance: “synthetic, not for clinical use without review.”

**Deliverable:** `INTEGRATION.md` in this directory listing exact files the main repo should import and any manual steps.

---

## Dependencies (expected)

- Python 3.10+
- PyTorch (or JAX if you prefer one stack consistently)
- NumPy, Pandas; optional Polars
- tqdm, PyYAML for runs

Pin versions in `requirements.txt` when implementation starts.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Synthetic data leaks “wrong” statistics | Always keep a **real-only** test set; compare downstream metrics |
| Too few positive labels | Start unconditional or semi-supervised; use simpler augmentations first |
| Feature schema drift | Version the schema; never silently change column order |

---

## Order of execution (checklist)

1. [ ] Write and freeze feature schema (Phase A).
2. [ ] Implement dataset builder from real exports (Phase B).
3. [ ] Implement DDPM + training loop (Phases C–D).
4. [ ] Sample and document quality (Phase E).
5. [ ] Write integration instructions and sample exports for the main repo (Phase F).

---

## Glossary (quick)

- **Feature vector:** One row of numbers summarizing a short period of patient signals.
- **Diffusion model:** A generative model trained by repeatedly adding noise and learning to remove it; sampling runs that process backward to produce new examples.
- **Synthetic data:** Artificial examples used for training or testing, not recorded from a real patient session.
- **Offline:** Runs on your machine or a training server, not inside the live app users hit every second.
