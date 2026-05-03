#!/usr/bin/env python3
"""Build (N, D) feature matrix from SQLite telemetry_batches or emit a dummy matrix for smoke tests."""

from __future__ import annotations

import argparse
import csv
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, DefaultDict, Dict, List, Optional, Tuple

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from synthetic_telemetry.features import extract_window_features, replace_nan_inf
from synthetic_telemetry.schema import load_feature_names


def _maybe_json(val: Any) -> Dict[str, Any]:
    if val is None:
        return {}
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except json.JSONDecodeError:
            return {}
    return {}


def load_incidents(path: Path) -> Dict[str, List[int]]:
    """patient_id -> sorted list of incident times (ms since epoch)."""
    out: DefaultDict[str, List[int]] = defaultdict(list)
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = row.get("patient_id") or row.get("patientId")
            if not pid:
                continue
            t_raw = row.get("incident_time_ms") or row.get("incidentTimeMs") or row.get("ts_ms")
            if t_raw is None or str(t_raw).strip() == "":
                continue
            out[str(pid).strip()].append(int(float(t_raw)))
    for k in out:
        out[k].sort()
    return dict(out)


def label_window(
    patient_id: str,
    window_end_ms: int,
    incidents: Dict[str, List[int]],
    lookahead_ms: int,
) -> int:
    times = incidents.get(patient_id, [])
    hi = window_end_ms + lookahead_ms
    for ts in times:
        if window_end_ms < ts <= hi:
            return 1
    return 0


def fetch_batches(conn: sqlite3.Connection) -> DefaultDict[str, List[Dict[str, Any]]]:
    cur = conn.execute(
        """
        SELECT patient_id, window_start_ms, window_end_ms,
               face_json, audio_json, motion_json, pointer_json
        FROM telemetry_batches
        ORDER BY patient_id, window_start_ms
        """
    )
    by_patient: DefaultDict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in cur.fetchall():
        by_patient[row[0]].append(
            {
                "patient_id": row[0],
                "window_start_ms": int(row[1]),
                "window_end_ms": int(row[2]),
                "face_json": _maybe_json(row[3]),
                "audio_json": _maybe_json(row[4]),
                "motion_json": _maybe_json(row[5]),
                "pointer_json": _maybe_json(row[6]),
            }
        )
    return by_patient


def build_windows(
    rows: List[Dict[str, Any]],
    *,
    dim: int,
    expected_batches: int,
    stride_batches: int,
    rms_silence_db: float,
    motion_spike_pct: float,
    dropoff_tail: int,
) -> List[Tuple[np.ndarray, int, int, str]]:
    """Returns list of (feature_vec, w_start_ms, w_end_ms, patient_id)."""
    out: List[Tuple[np.ndarray, int, int, str]] = []
    n = len(rows)
    if n < expected_batches:
        return out
    pid = rows[0]["patient_id"]
    for start in range(0, n - expected_batches + 1, stride_batches):
        end = start + expected_batches
        window = rows[start:end]
        w0 = window[0]["window_start_ms"]
        w1 = window[-1]["window_end_ms"]
        vec = extract_window_features(
            window,
            dim=dim,
            rms_silence_db=rms_silence_db,
            motion_spike_percentile=motion_spike_pct,
            dropoff_tail_batches=dropoff_tail,
            expected_batches=expected_batches,
        )
        vec = replace_nan_inf(vec)
        out.append((vec, w0, w1, pid))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", type=Path, default=ROOT / "configs" / "default.yaml")
    ap.add_argument("--output-dir", type=Path, default=ROOT / "data" / "processed")
    ap.add_argument("--db", type=Path, help="Path to ember SQLite (telemetry_batches table)")
    ap.add_argument("--incidents-csv", type=Path, help="Optional CSV: patient_id, incident_time_ms")
    ap.add_argument("--dummy-rows", type=int, default=0, help="If >0, skip DB and write random features for smoke tests")
    args = ap.parse_args()

    cfg = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    data_cfg = cfg["data"]
    schema_path = ROOT / cfg["paths"]["schema_file"]
    names = load_feature_names(schema_path)
    dim = len(names)

    args.output_dir.mkdir(parents=True, exist_ok=True)

    if args.dummy_rows and args.dummy_rows > 0:
        rng = np.random.default_rng(0)
        x = rng.normal(size=(args.dummy_rows, dim)).astype(np.float32)
        y = (rng.random(args.dummy_rows) > 0.97).astype(np.int8)
        np.save(args.output_dir / "features.npy", x)
        np.save(args.output_dir / "labels.npy", y)
        with (args.output_dir / "meta.csv").open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["idx", "patient_id", "window_start_ms", "window_end_ms"])
            for i in range(args.dummy_rows):
                w.writerow([i, "synthetic", -1, -1])
        info = {"mode": "dummy", "rows": args.dummy_rows, "dim": dim, "schema": str(schema_path)}
        (args.output_dir / "build_info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
        print(f"Wrote dummy dataset: {args.output_dir} shape={x.shape}")
        return

    if not args.db or not args.db.is_file():
        ap.error("--db is required unless --dummy-rows is set")

    lookback_s = float(data_cfg["lookback_seconds"])
    stride_s = float(data_cfg["stride_seconds"])
    expected_batches = int(round(lookback_s / 0.5))
    stride_batches = max(1, int(round(stride_s / 0.5)))
    incidents: Dict[str, List[int]] = {}
    if args.incidents_csv and args.incidents_csv.is_file():
        incidents = load_incidents(args.incidents_csv)

    lookahead_ms = int(float(data_cfg["incident_lookahead_seconds"]) * 1000)

    conn = sqlite3.connect(str(args.db))
    try:
        by_patient = fetch_batches(conn)
    finally:
        conn.close()

    feats: List[np.ndarray] = []
    labels: List[int] = []
    meta_rows: List[Tuple[int, str, int, int]] = []

    idx = 0
    for pid, rows in by_patient.items():
        if len(rows) < expected_batches:
            continue
        wins = build_windows(
            rows,
            dim=dim,
            expected_batches=expected_batches,
            stride_batches=stride_batches,
            rms_silence_db=float(data_cfg["rms_silence_db"]),
            motion_spike_pct=float(data_cfg["motion_spike_percentile"]),
            dropoff_tail=int(data_cfg["dropoff_tail_batches"]),
        )
        for vec, w0, w1, patient_id in wins:
            if vec.shape[0] != dim:
                raise RuntimeError(f"Feature dim mismatch: got {vec.shape[0]} expected {dim}")
            feats.append(vec)
            labels.append(label_window(patient_id, w1, incidents, lookahead_ms))
            meta_rows.append((idx, patient_id, w0, w1))
            idx += 1

    if not feats:
        print("No windows produced (need more telemetry_batches per patient).", file=sys.stderr)
        sys.exit(1)

    x = np.stack(feats, axis=0).astype(np.float32)
    y = np.array(labels, dtype=np.int8)
    np.save(args.output_dir / "features.npy", x)
    np.save(args.output_dir / "labels.npy", y)
    with (args.output_dir / "meta.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["idx", "patient_id", "window_start_ms", "window_end_ms"])
        w.writerows(meta_rows)

    info = {
        "mode": "sqlite",
        "db": str(args.db),
        "rows": int(x.shape[0]),
        "dim": dim,
        "lookback_seconds": lookback_s,
        "stride_seconds": stride_s,
        "expected_batches": expected_batches,
        "min_batches_config": int(data_cfg["min_batches"]),
        "schema": str(schema_path),
        "positive_rate": float(y.mean()) if y.size else 0.0,
    }
    (args.output_dir / "build_info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    print(f"Wrote dataset: {args.output_dir} X={x.shape} positives={int(y.sum())}/{y.size}")


if __name__ == "__main__":
    main()
