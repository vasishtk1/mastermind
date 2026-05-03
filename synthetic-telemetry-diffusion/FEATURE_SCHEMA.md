# Feature schema v1.0 (what the numbers are)

Frozen column order is in `feature_schema.json` (`feature_names`). **Do not reorder** without bumping `version`.

## Window definition

- **Lookback:** 30 s (60 consecutive 500 ms batches when cadence is nominal).
- **Stride:** Configurable when building the dataset (e.g. 30 s non-overlapping windows).
- **Source rows:** SQLite `telemetry_batches` (`face_json`, `audio_json`, `motion_json`, `pointer_json`) matching the browser worker payload shape.

## Conventions

- **`*_avg` / `*_std` / `*_var`:** Computed across batches **within** the window (time axis).
- **`silence_ratio`:** Fraction of batches where `audio.rms_db_mean < -55` dBFS (rough “quiet” proxy).
- **`face_blink_combined_mean`:** `(blink_rate_left + blink_rate_right) / 2` per batch, then stats across batches.
- **`motion_spike_count`:** Count of batches where `motion.accel_magnitude_mean` exceeds the **80th percentile of that same window** (relative spike definition avoids assuming raw accel units).
- **`pointer_tap_rate`:** Sum of `pointer.tap_count` over the window, divided by `n_batches`.
- **`pointer_interaction_dropoff`:** `1.0` if none of the last **10** batches in the window have `tap_count > 0`, else `0.0`.
- **Slopes:** Ordinary least-squares slope vs batch index (0 … n−1), divided by `max(n_batches, 1)` for scale stability.
- **`n_batches_norm`:** `n_batches / 60` (expected count for 30 s at 500 ms); clipped to `[0, 1.5]`.

## Optional label (not part of the diffusion vector)

- **`pre_incident`:** `1` if any incident timestamp in the optional incidents file falls within `(window_end, window_end + lookahead_s]` (see `build_dataset.py`). Stored separately in `labels.npy`.

## Alignment with triage pseudocode

| Pseudocode idea | v1 schema mapping |
|-----------------|-------------------|
| Blink rate variance | `face_blink_combined_mean_var` |
| Pitch variability | `audio_f0_mean_var` |
| Motion magnitude / spikes | `motion_accel_magnitude_*`, `motion_spike_count` |
| Interaction drop-off | `pointer_interaction_dropoff` |
| “Silence” | `audio_silence_ratio` |
| Expression entropy | Not in v1 (would need categorical expression stream); `face_frame_count_mean` as weak engagement proxy |
