#!/usr/bin/env python3
"""Train vector DDPM on features.npy."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from synthetic_telemetry.schema import load_feature_names
from synthetic_telemetry.trainer import TrainConfig, train_loop


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", type=Path, default=ROOT / "configs" / "default.yaml")
    ap.add_argument("--data-dir", type=Path, default=ROOT / "data" / "processed")
    ap.add_argument("--ckpt-dir", type=Path, default=None, help="Override config paths.checkpoint_dir")
    args = ap.parse_args()

    cfg_raw = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    paths = cfg_raw["paths"]
    diff = cfg_raw["diffusion"]
    model = cfg_raw["model"]
    train = cfg_raw["train"]
    norm = cfg_raw["normalize"]

    schema_path = ROOT / paths["schema_file"]
    names = load_feature_names(schema_path)
    dim = len(names)

    x_path = args.data_dir / "features.npy"
    if not x_path.is_file():
        print(f"Missing {x_path}; run scripts/build_dataset.py first.", file=sys.stderr)
        sys.exit(1)
    features = np.load(x_path)
    if features.ndim != 2 or features.shape[1] != dim:
        print(f"Expected features shape (N, {dim}), got {features.shape}", file=sys.stderr)
        sys.exit(1)

    ckpt_dir = args.ckpt_dir or (ROOT / paths["checkpoint_dir"])
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    cfg = TrainConfig(
        dim=dim,
        timesteps=int(diff["timesteps"]),
        beta_schedule=str(diff["beta_schedule"]),
        beta_start=float(diff["beta_start"]),
        beta_end=float(diff["beta_end"]),
        hidden_dim=int(model["hidden_dim"]),
        num_layers=int(model["num_layers"]),
        time_embed_dim=int(model["time_embed_dim"]),
        batch_size=int(train["batch_size"]),
        learning_rate=float(train["learning_rate"]),
        epochs=int(train["epochs"]),
        num_workers=int(train["num_workers"]),
        device=str(train["device"]),
        val_fraction=float(train["val_fraction"]),
        seed=int(train["seed"]),
        clip_std=float(norm["clip_std"]),
    )

    summary = train_loop(features.astype(np.float64), cfg, ckpt_dir, norm_stats_path=ckpt_dir / "norm.npz")
    (ckpt_dir / "train_summary.json").write_text(json.dumps(summary, indent=2, default=float), encoding="utf-8")
    print(f"Done. Checkpoints in {ckpt_dir}")


if __name__ == "__main__":
    main()
