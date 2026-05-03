from __future__ import annotations

import math
from typing import Any, Dict, List, Mapping, Optional

import numpy as np


def _get(d: Mapping[str, Any], *keys: str, default: float = 0.0) -> float:
    cur: Any = d
    for k in keys:
        if not isinstance(cur, Mapping) or k not in cur:
            return default
        cur = cur[k]
    try:
        return float(cur)
    except (TypeError, ValueError):
        return default


def _linear_slope(y: np.ndarray) -> float:
    """OLS slope vs 0..n-1; returns 0 for degenerate input."""
    y = np.asarray(y, dtype=np.float64).ravel()
    n = y.size
    if n < 2:
        return 0.0
    x = np.arange(n, dtype=np.float64)
    x_mean = x.mean()
    y_mean = y.mean()
    denom = ((x - x_mean) ** 2).sum()
    if denom < 1e-12:
        return 0.0
    return float(((x - x_mean) * (y - y_mean)).sum() / denom)


def extract_window_features(
    batches: List[Dict[str, Any]],
    *,
    dim: int,
    rms_silence_db: float = -55.0,
    motion_spike_percentile: float = 80.0,
    dropoff_tail_batches: int = 10,
    expected_batches: int = 60,
) -> np.ndarray:
    """
    Map a time-ordered list of DB rows (each with face_json, audio_json, …) to one float vector.

    Order must match `feature_schema.json` feature_names.
    """
    n = len(batches)
    if n == 0:
        return np.zeros(dim, dtype=np.float64)

    def audio_series(key: str) -> np.ndarray:
        return np.array([_get(b.get("audio_json") or {}, key) for b in batches], dtype=np.float64)

    def face_series(key: str) -> np.ndarray:
        return np.array([_get(b.get("face_json") or {}, key) for b in batches], dtype=np.float64)

    def motion_series(key: str) -> np.ndarray:
        return np.array([_get(b.get("motion_json") or {}, key) for b in batches], dtype=np.float64)

    def pointer_series(key: str) -> np.ndarray:
        return np.array([_get(b.get("pointer_json") or {}, key) for b in batches], dtype=np.float64)

    rms = audio_series("rms_db_mean")
    flux = audio_series("spectral_flux_mean")
    f0 = audio_series("f0_mean")
    zcr = audio_series("zcr_mean")
    amb = audio_series("ambient_db_mean")
    sc = audio_series("spectral_centroid_mean")

    blink_l = face_series("blink_rate_left")
    blink_r = face_series("blink_rate_right")
    blink_c = (blink_l + blink_r) * 0.5

    pitch = face_series("head_pitch_mean")
    yaw = face_series("head_yaw_mean")
    roll = face_series("head_roll_mean")
    face_fc = face_series("frame_count")

    acc_m = motion_series("accel_magnitude_mean")
    acc_mx = motion_series("accel_magnitude_max")
    trem = motion_series("tremor_index")
    ob = motion_series("orientation_beta_mean")
    og = motion_series("orientation_gamma_mean")

    taps = pointer_series("tap_count")
    prs = pointer_series("mean_pressure")
    vel = pointer_series("mean_velocity_px_per_ms")

    silence_ratio = float(np.mean(rms < rms_silence_db)) if n else 0.0

    thr = np.percentile(acc_m, motion_spike_percentile) if n else 0.0
    motion_spike_count = float(np.sum(acc_m > thr)) if n else 0.0

    tail = min(dropoff_tail_batches, n)
    tail_taps = taps[-tail:] if tail else taps
    interaction_dropoff = 1.0 if tail and np.all(tail_taps <= 0) else 0.0

    n_batches_norm = float(np.clip(n / max(expected_batches, 1), 0.0, 1.5))

    vec = np.asarray(
        [
            n_batches_norm,
            float(np.mean(rms)),
            float(np.std(rms)) if n > 1 else 0.0,
            float(np.max(rms)),
            float(np.mean(f0)),
            float(np.var(f0)) if n > 1 else 0.0,
            float(np.mean(flux)),
            float(np.std(flux)) if n > 1 else 0.0,
            float(np.mean(sc)),
            float(np.mean(zcr)),
            float(np.std(zcr)) if n > 1 else 0.0,
            float(np.mean(amb)),
            silence_ratio,
            float(np.mean(blink_c)),
            float(np.var(blink_c)) if n > 1 else 0.0,
            float(np.mean(pitch)),
            float(np.var(pitch)) if n > 1 else 0.0,
            float(np.mean(yaw)),
            float(np.var(yaw)) if n > 1 else 0.0,
            float(np.mean(roll)),
            float(np.var(roll)) if n > 1 else 0.0,
            float(np.mean(face_fc)),
            float(np.mean(acc_m)),
            float(np.std(acc_m)) if n > 1 else 0.0,
            float(np.max(acc_mx)),
            float(np.mean(trem)),
            motion_spike_count,
            float(np.mean(ob)),
            float(np.mean(og)),
            float(np.sum(taps)) / max(n, 1),
            float(np.mean(prs)),
            float(np.mean(vel)),
            interaction_dropoff,
            _linear_slope(rms) / max(n, 1),
            _linear_slope(flux) / max(n, 1),
            _linear_slope(acc_m) / max(n, 1),
        ],
        dtype=np.float64,
    )
    if vec.shape[0] != dim:
        raise ValueError(f"extract_window_features produced len {vec.shape[0]}, expected {dim}")
    return vec


def replace_nan_inf(x: np.ndarray, fill: float = 0.0) -> np.ndarray:
    y = np.array(x, dtype=np.float64, copy=True)
    bad = ~np.isfinite(y)
    y[bad] = fill
    return y
