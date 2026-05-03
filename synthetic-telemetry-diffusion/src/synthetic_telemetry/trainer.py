from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from synthetic_telemetry.diffusion import MLPDenoiser, build_diffusion


@dataclass
class TrainConfig:
    dim: int
    timesteps: int
    beta_schedule: str
    beta_start: float
    beta_end: float
    hidden_dim: int
    num_layers: int
    time_embed_dim: int
    batch_size: int
    learning_rate: float
    epochs: int
    num_workers: int
    device: str
    val_fraction: float
    seed: int
    clip_std: float


def pick_device(name: str) -> torch.device:
    name = (name or "cpu").lower()
    if name == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    if name == "mps" and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def fit_normalizer(x: np.ndarray, clip_std: float) -> Tuple[np.ndarray, np.ndarray]:
    mean = x.mean(axis=0)
    std = x.std(axis=0)
    std = np.clip(std, 1e-6, None)
    if clip_std and clip_std > 0:
        std = np.minimum(std, float(clip_std))
    return mean.astype(np.float32), std.astype(np.float32)


def normalize(x: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return (x - mean) / std


def denormalize(x: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return x * std + mean


def train_val_split(
    x: np.ndarray, val_fraction: float, seed: int
) -> Tuple[np.ndarray, np.ndarray]:
    n = x.shape[0]
    if n <= 1:
        return x, np.empty((0, x.shape[1]), dtype=x.dtype)
    rng = np.random.default_rng(seed)
    idx = np.arange(n)
    rng.shuffle(idx)
    n_val = max(1, int(round(n * val_fraction)))
    n_val = min(n_val, n - 1)
    val_idx = idx[:n_val]
    train_idx = idx[n_val:]
    return x[train_idx], x[val_idx]


def train_loop(
    features: np.ndarray,
    cfg: TrainConfig,
    ckpt_dir: Path,
    norm_stats_path: Optional[Path] = None,
) -> Dict[str, Any]:
    torch.manual_seed(cfg.seed)
    device = pick_device(cfg.device)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    x_train, x_val = train_val_split(features, cfg.val_fraction, cfg.seed)
    mean, std = fit_normalizer(x_train, cfg.clip_std)
    np.savez(norm_stats_path or (ckpt_dir / "norm.npz"), mean=mean, std=std)

    x_train_n = normalize(x_train, mean, std)
    x_val_n = normalize(x_val, mean, std) if x_val.size else np.empty((0, x_train.shape[1]), dtype=np.float32)

    train_ds = TensorDataset(torch.from_numpy(x_train_n).float())
    val_ds = TensorDataset(torch.from_numpy(x_val_n).float()) if x_val.size else None
    bs_train = max(1, min(cfg.batch_size, len(train_ds)))
    train_loader = DataLoader(
        train_ds,
        batch_size=bs_train,
        shuffle=True,
        num_workers=cfg.num_workers,
        drop_last=len(train_ds) > bs_train,
    )
    val_loader: Optional[DataLoader]
    if val_ds is not None and len(val_ds) > 0:
        bs_val = max(1, min(cfg.batch_size, len(val_ds)))
        val_loader = DataLoader(val_ds, batch_size=bs_val, shuffle=False, num_workers=0)
    else:
        val_loader = None

    model = MLPDenoiser(
        dim=cfg.dim,
        hidden_dim=cfg.hidden_dim,
        num_layers=cfg.num_layers,
        time_embed_dim=cfg.time_embed_dim,
    ).to(device)

    diff, _ = build_diffusion(
        cfg.beta_schedule if cfg.beta_schedule in ("linear", "cosine") else "linear",
        cfg.timesteps,
        cfg.beta_start,
        cfg.beta_end,
        device,
    )

    opt = torch.optim.AdamW(model.parameters(), lr=cfg.learning_rate)
    best_val = float("inf")
    history: list[dict[str, float]] = []

    for epoch in range(cfg.epochs):
        model.train()
        train_loss = 0.0
        n_seen = 0
        for (xb,) in train_loader:
            xb = xb.to(device)
            opt.zero_grad(set_to_none=True)
            loss = diff.p_losses(model, xb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            train_loss += float(loss.item()) * xb.shape[0]
            n_seen += xb.shape[0]
        train_loss /= max(n_seen, 1)

        model.eval()
        if val_loader is not None:
            val_loss = 0.0
            v_seen = 0
            with torch.no_grad():
                for (xb,) in val_loader:
                    xb = xb.to(device)
                    loss = diff.p_losses(model, xb)
                    val_loss += float(loss.item()) * xb.shape[0]
                    v_seen += xb.shape[0]
            val_loss /= max(v_seen, 1)
        else:
            val_loss = train_loss
        history.append({"epoch": epoch, "train_mse": train_loss, "val_mse": val_loss})

        if val_loss < best_val:
            best_val = val_loss
            torch.save(
                {
                    "model_state": model.state_dict(),
                    "config": cfg.__dict__,
                    "epoch": epoch,
                    "val_mse": val_loss,
                },
                ckpt_dir / "best.pt",
            )

    torch.save(
        {
            "model_state": model.state_dict(),
            "config": cfg.__dict__,
            "epoch": cfg.epochs - 1,
            "history": history,
        },
        ckpt_dir / "last.pt",
    )
    return {"best_val_mse": best_val, "ckpt_dir": str(ckpt_dir), "history": history}
