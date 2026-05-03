# Quality checklist (fill in after each run)

Template for documenting synthetic data quality. Replace bracketed items.

## Run metadata

- Date:
- Config file:
- Checkpoint:
- Number of real windows (N):
- Number of synthetic samples:

## Sanity checks

- [ ] No `NaN` / `Inf` in `features.npy` or sampled arrays.
- [ ] Per-dimension min/max of synthetic vs real (spot-check or full table).
- [ ] Correlation / PCA overlay plot (optional) — do clusters overlap sensibly?

## Downstream (recommended before trusting synthesis)

- [ ] Train a tiny probe classifier on **real-only** vs **real+synthetic** and compare **held-out real** AUC / calibration.
- [ ] Review extreme synthetic rows for impossible combinations.

## Decision

- [ ] Approved for internal eval / mock data only  
- [ ] Rejected — notes:
