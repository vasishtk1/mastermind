#!/usr/bin/env python3
"""Sample synthetic feature vectors from a trained checkpoint."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import yaml

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from synthetic_telemetry.diffusion import MLPDenoiser, build_diffusion
from synthetic_telemetry.schema import load_feature_names
from synthetic_telemetry.trainer import denormalize, pick_device


@torch.no_grad()
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", type=Path, default=ROOT / "configs" / "default.yaml")
    ap.add_argument("--ckpt-dir", type=Path, default=ROOT / "checkpoints")
    ap.add_argument("--num-samples", type=int, default=512)
    ap.add_argument("--output", type=Path, default=ROOT / "samples" / "synthetic_vectors.npy")
    args = ap.parse_args()

    cfg_raw = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    paths = cfg_raw["paths"]
    diff_cfg = cfg_raw["diffusion"]
    model_cfg = cfg_raw["model"]
    train_cfg = cfg_raw["train"]

    schema_path = ROOT / paths["schema_file"]
    names = load_feature_names(schema_path)
    dim = len(names)

    ckpt_path = args.ckpt_dir / "best.pt"
    if not ckpt_path.is_file():
        ckpt_path = args.ckpt_dir / "last.pt"
    if not ckpt_path.is_file():
        print(f"No checkpoint in {args.ckpt_dir}", file=sys.stderr)
        sys.exit(1)

    norm_path = args.ckpt_dir / "norm.npz"
    if not norm_path.is_file():
        print(f"Missing {norm_path}; train first.", file=sys.stderr)
        sys.exit(1)

    z = np.load(norm_path)
    mean, std = z["mean"], z["std"]

    device = pick_device(str(train_cfg["device"]))
    diff, _ = build_diffusion(
        str(diff_cfg["beta_schedule"]) if str(diff_cfg["beta_schedule"]) in ("linear", "cosine") else "linear",
        int(diff_cfg["timesteps"]),
        float(diff_cfg["beta_start"]),
        float(diff_cfg["beta_end"]),
        device,
    )

    model = MLPDenoiser(
        dim=dim,
        hidden_dim=int(model_cfg["hidden_dim"]),
        num_layers=int(model_cfg["num_layers"]),
        time_embed_dim=int(model_cfg["time_embed_dim"]),
    ).to(device)

    try:
        state = torch.load(ckpt_path, map_location=device, weights_only=False)
    except TypeError:
        state = torch.load(ckpt_path, map_location=device)
    model.load_state_dict(state["model_state"])
    model.eval()

    shape = (args.num_samples, dim)
    x_norm = diff.p_sample_loop(model, shape).cpu().numpy().astype(np.float32)
    x_raw = denormalize(x_norm, mean, std).astype(np.float32)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.save(args.output, x_raw)
    meta = {
        "checkpoint": str(ckpt_path),
        "num_samples": args.num_samples,
        "dim": dim,
        "feature_names": names,
        "provenance": "synthetic_not_clinical",
    }
    (args.output.with_suffix(".json")).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Wrote {args.output} shape={x_raw.shape}")


if __name__ == "__main__":
    main()
