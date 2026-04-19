"""Thin async bridge: call Convex mutations via the Convex REST API.

Convex exposes a REST endpoint at /api/mutation that accepts any registered
mutation by path.  We use this so the FastAPI backend can push data into
Convex (and therefore into the real-time dashboard) without a Node.js SDK.

Usage:
    await call_mutation("incidents:ingest", {"patientId": ..., "biometrics": {...}})

Errors are logged but never re-raised so a Convex outage never fails an iOS
device event upload.
"""

import logging
import os
from typing import Any, Dict

import httpx

logger = logging.getLogger(__name__)

# Set CONVEX_URL in backend/.env (copy from VITE_CONVEX_URL in the frontend).
# Example: https://acoustic-minnow-665.convex.cloud
_CONVEX_URL = os.getenv("CONVEX_URL", "").rstrip("/")


async def call_mutation(path: str, args: Dict[str, Any]) -> None:
    """Fire-and-forget POST to a Convex mutation.

    Args:
        path: Convex function path, e.g. ``"incidents:ingest"`` or
              ``"clinicalPipeline:ingestEventWithReport"``.
        args: Dict of arguments matching the mutation's validator schema.
    """
    if not _CONVEX_URL:
        logger.warning(
            "[convex_bridge] CONVEX_URL not set — skipping Convex sync for '%s'. "
            "Add CONVEX_URL to backend/.env to enable real-time dashboard updates.",
            path,
        )
        return

    url = f"{_CONVEX_URL}/api/mutation"
    payload = {"path": path, "args": args}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code not in (200, 201):
                logger.warning(
                    "[convex_bridge] '%s' → HTTP %d: %s",
                    path,
                    resp.status_code,
                    resp.text[:300],
                )
            else:
                logger.debug("[convex_bridge] '%s' synced OK", path)
    except httpx.TimeoutException:
        logger.warning("[convex_bridge] Timeout syncing '%s'", path)
    except Exception as exc:
        logger.warning("[convex_bridge] Failed to sync '%s': %s", path, exc)
