from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


def linear_beta_schedule(timesteps: int, beta_start: float, beta_end: float) -> torch.Tensor:
    return torch.linspace(beta_start, beta_end, timesteps, dtype=torch.float32)


def cosine_beta_schedule(timesteps: int, s: float = 0.008) -> torch.Tensor:
    """Nichol & Dhariwal style cosine schedule (betas derived from alphas_bar)."""
    steps = timesteps + 1
    x = torch.linspace(0, timesteps, steps, dtype=torch.float64)
    alphas_cumprod = torch.cos(((x / timesteps) + s) / (1 + s) * math.pi * 0.5) ** 2
    alphas_cumprod = alphas_cumprod / alphas_cumprod[0]
    betas = 1 - (alphas_cumprod[1:] / alphas_cumprod[:-1])
    return torch.clip(betas.float(), 1e-5, 0.999)


@dataclass
class GaussianDiffusion1D:
    """DDPM on vector data x0 in R^dim."""

    betas: torch.Tensor
    device: torch.device

    def __post_init__(self) -> None:
        b = self.betas.to(self.device)
        self.betas = b
        self.alphas = 1.0 - b
        self.alphas_cumprod = torch.cumprod(self.alphas, dim=0)
        self.sqrt_alphas_cumprod = torch.sqrt(self.alphas_cumprod)
        self.sqrt_one_minus_alphas_cumprod = torch.sqrt(1.0 - self.alphas_cumprod)
        self.sqrt_recip_alphas = torch.sqrt(1.0 / self.alphas)
        alphas_cumprod_prev = F.pad(self.alphas_cumprod[:-1], (1, 0), value=1.0)
        self.posterior_variance = b * (1.0 - alphas_cumprod_prev) / (1.0 - self.alphas_cumprod)

    @property
    def timesteps(self) -> int:
        return int(self.betas.shape[0])

    def q_sample(self, x0: torch.Tensor, t: torch.Tensor, noise: Optional[torch.Tensor] = None) -> torch.Tensor:
        """Forward diffusion: x_t = sqrt(ab)*x0 + sqrt(1-ab)*eps."""
        if noise is None:
            noise = torch.randn_like(x0)
        s1 = self._gather(self.sqrt_alphas_cumprod, t, x0.shape)
        s2 = self._gather(self.sqrt_one_minus_alphas_cumprod, t, x0.shape)
        return s1 * x0 + s2 * noise

    def p_losses(
        self,
        model: nn.Module,
        x0: torch.Tensor,
        t: Optional[torch.Tensor] = None,
        noise: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        bsz, _ = x0.shape
        if t is None:
            t = torch.randint(0, self.timesteps, (bsz,), device=x0.device, dtype=torch.long)
        if noise is None:
            noise = torch.randn_like(x0)
        x_noisy = self.q_sample(x0, t, noise=noise)
        pred = model(x_noisy, t)
        return F.mse_loss(pred, noise)

    @torch.no_grad()
    def p_sample_loop(self, model: nn.Module, shape: Tuple[int, int]) -> torch.Tensor:
        """Reverse diffusion; starts from N(0,I)."""
        model.eval()
        img = torch.randn(shape, device=self.device, dtype=torch.float32)
        for i in reversed(range(self.timesteps)):
            t = torch.full((shape[0],), i, device=self.device, dtype=torch.long)
            img = self.p_sample(model, img, t)
        return img

    @torch.no_grad()
    def p_sample(self, model: nn.Module, x: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        """One reverse step; DDPM mean + posterior noise (t>0)."""
        pred_noise = model(x, t)
        coef1 = self._gather(self.sqrt_recip_alphas, t, x.shape)
        coef2 = self._gather(self.betas, t, x.shape) / self._gather(self.sqrt_one_minus_alphas_cumprod, t, x.shape)
        x = coef1 * (x - coef2 * pred_noise)
        if int(t[0].item()) > 0:
            noise = torch.randn_like(x)
            sigma = torch.sqrt(self._gather(self.posterior_variance, t, x.shape))
            x = x + sigma * noise
        return x

    @staticmethod
    def _gather(constants: torch.Tensor, t: torch.Tensor, shape: torch.Size) -> torch.Tensor:
        b = t.shape[0]
        out = constants.gather(-1, t)
        return out.reshape(b, *((1,) * (len(shape) - 1)))


class SinusoidalTimeEmbedding(nn.Module):
    def __init__(self, dim: int) -> None:
        super().__init__()
        self.dim = dim

    def forward(self, t: torch.Tensor) -> torch.Tensor:
        half = self.dim // 2
        t = t.float().unsqueeze(-1)
        freqs = torch.exp(-math.log(10_000) * torch.arange(0, half, device=t.device) / max(half - 1, 1))
        args = t * freqs.unsqueeze(0)
        emb = torch.cat([torch.sin(args), torch.cos(args)], dim=-1)
        if self.dim % 2 == 1:
            emb = F.pad(emb, (0, 1))
        return emb


class MLPDenoiser(nn.Module):
    """Predicts epsilon from (x_t, t)."""

    def __init__(self, dim: int, hidden_dim: int, num_layers: int, time_embed_dim: int) -> None:
        super().__init__()
        self.time_embed = nn.Sequential(
            SinusoidalTimeEmbedding(time_embed_dim),
            nn.Linear(time_embed_dim, time_embed_dim),
            nn.SiLU(),
        )
        in_dim = dim + time_embed_dim
        blocks: list[nn.Module] = [nn.Linear(in_dim, hidden_dim), nn.SiLU()]
        for _ in range(max(num_layers - 1, 0)):
            blocks.extend([nn.Linear(hidden_dim, hidden_dim), nn.SiLU()])
        self.net = nn.Sequential(*blocks)
        self.out = nn.Linear(hidden_dim, dim)

    def forward(self, x: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        te = self.time_embed(t)
        h = torch.cat([x, te], dim=-1)
        h = self.net(h)
        return self.out(h)


def build_diffusion(
    schedule: Literal["linear", "cosine"],
    timesteps: int,
    beta_start: float,
    beta_end: float,
    device: torch.device,
) -> Tuple[GaussianDiffusion1D, torch.Tensor]:
    if schedule == "linear":
        betas = linear_beta_schedule(timesteps, beta_start, beta_end)
    else:
        betas = cosine_beta_schedule(timesteps)
    diff = GaussianDiffusion1D(betas=betas, device=device)
    return diff, betas
