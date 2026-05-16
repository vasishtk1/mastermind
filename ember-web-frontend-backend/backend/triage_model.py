"""MasterMind — Triage Risk Scoring Model

Implements the full patient deterioration prediction pipeline from
mastermind_model_pseudocode.md:

  1. fetch_telemetry_window()   — pull the last 30 s of sensor batches from SQLite
  2. extract_features()         — compute 9 behavioral signals into a float vector
  3. build_labeled_dataset()    — join telemetry windows with clinical incident records
  4. train_model()              — GradientBoostingClassifier + Platt Scaling calibration
  5. save_model() / load_model()— joblib persistence under backend/models/
  6. score_patient()            — online inference (called every 30 s)
  7. evaluate_and_alert()       — threshold risk_prob → write RiskScore + emberIncident
  8. run_scoring_loop()         — async background task, wakes every 30 s
"""

from __future__ import annotations

import asyncio
import logging
import math
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.utils.class_weight import compute_sample_weight
from sqlalchemy import select

from convex_bridge import call_mutation
from database import AsyncSessionLocal
from db_models import ClinicalReport, Patient, RiskScore, TelemetryBatch

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants (all tunable)
# ---------------------------------------------------------------------------
LOOKBACK_SECONDS = 30
MIN_BATCHES_REQUIRED = 30           # 30 × 500 ms = 15 s minimum before scoring
SPIKE_THRESHOLD = 0.7               # motion magnitude treated as a "spike"
INCIDENT_LOOKAHEAD_SECONDS = 300    # 5 min: positive label window
SCORING_INTERVAL_SECONDS = 30       # scoring loop cadence

CRITICAL_THRESHOLD = 0.80
WARNING_THRESHOLD = 0.55

MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "triage_model.pkl"

# Ordered feature names — order must match extract_features() output
FEATURE_NAMES = [
    "avg_eye_openness",
    "blink_rate_variance",
    "expression_entropy",
    "speech_rate_change",
    "pitch_variance",
    "silence_ratio",
    "motion_magnitude_mean",
    "motion_spikes",
    "interaction_dropoff",
]

# Module-level model cache — populated by load_model() / train endpoint
_model_cache: dict[str, Optional[CalibratedClassifierCV]] = {"model": None}


# ---------------------------------------------------------------------------
# Pure math helpers
# ---------------------------------------------------------------------------

def _safe_float(v, default: float = 0.0) -> float:
    """Cast v to float; return default on error or non-finite value."""
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def _shannon_entropy(values: list) -> float:
    """Shannon entropy (bits) over a sequence of categorical or numeric values.

    Numeric values are rounded to 1 decimal place before bucketing so
    near-identical floats are treated as the same symbol.
    """
    if not values:
        return 0.0
    buckets = [
        round(_safe_float(v, 0.0), 1) if not isinstance(v, str) else v
        for v in values
    ]
    counts = Counter(buckets)
    total = sum(counts.values())
    if total == 0:
        return 0.0
    entropy = 0.0
    for c in counts.values():
        p = c / total
        if p > 0:
            entropy -= p * math.log2(p)
    return entropy


def _linear_slope(values: list) -> float:
    """Slope of the OLS best-fit line through the value sequence."""
    n = len(values)
    if n < 2:
        return 0.0
    xs = np.arange(n, dtype=float)
    ys = np.array([_safe_float(v) for v in values])
    try:
        slope = float(np.polyfit(xs, ys, 1)[0])
        return slope if math.isfinite(slope) else 0.0
    except (np.linalg.LinAlgError, ValueError):
        return 0.0


# ---------------------------------------------------------------------------
# Feature extraction (pure / synchronous)
# ---------------------------------------------------------------------------

def extract_features(batches: list[dict]) -> Optional[np.ndarray]:
    """Compute the 9-dimensional feature vector from a window of telemetry batches.

    Each batch dict must have keys: "face", "audio", "motion", "pointer"
    (each a dict, as stored in the SQLite JSON columns).

    Returns a (9,) float64 array, or None when batches is empty.
    """
    if not batches:
        return None

    face_list    = [b.get("face",    {}) or {} for b in batches]
    audio_list   = [b.get("audio",   {}) or {} for b in batches]
    motion_list  = [b.get("motion",  {}) or {} for b in batches]
    pointer_list = [b.get("pointer", {}) or {} for b in batches]
    n = len(batches)

    # --- Face signals ---
    eye_openness = [
        _safe_float(f.get("eyeOpenness", f.get("eye_openness", 1.0)))
        for f in face_list
    ]
    blink_rates = [
        _safe_float(f.get("blinkRate", f.get("blink_rate", 0.0)))
        for f in face_list
    ]
    # expression may be a string label or a numeric blend-shape value
    expressions = [
        f.get("expression", f.get("dominantExpression", "neutral")) or "neutral"
        for f in face_list
    ]

    avg_eye_openness    = float(np.mean(eye_openness))
    blink_rate_variance = float(np.var(blink_rates))
    expression_entropy  = _shannon_entropy(expressions)

    # --- Audio signals ---
    speech_rates = [
        _safe_float(a.get("speechRate", a.get("speech_rate", 0.0)))
        for a in audio_list
    ]
    pitches = [
        _safe_float(
            a.get("pitch", a.get("f0Hz", a.get("fundamental_frequency_hz", 0.0)))
        )
        for a in audio_list
    ]
    # A frame is silent when the isSilent flag is set OR the RMS is near zero
    silent_flags = [
        bool(a.get("isSilent", a.get("is_silent", False)))
        or _safe_float(a.get("rms", 1.0)) < 0.01
        for a in audio_list
    ]

    speech_rate_change = _linear_slope(speech_rates)
    pitch_variance     = float(np.var(pitches))
    silence_ratio      = sum(silent_flags) / n

    # --- Motion signals ---
    magnitudes = [
        _safe_float(m.get("magnitude", 0.0)) for m in motion_list
    ]
    motion_magnitude_mean = float(np.mean(magnitudes))
    motion_spikes = float(sum(1 for mag in magnitudes if mag > SPIKE_THRESHOLD))

    # --- Interaction signal ---
    # interactionDropoff = 1 if the last 10 batches produced no pointer events
    tail = pointer_list[-10:] if n >= 10 else pointer_list
    has_interaction = any(
        bool(p.get("events", p.get("hasEvents", False))) or (len(p) > 0)
        for p in tail
        if p
    )
    interaction_dropoff = 0.0 if has_interaction else 1.0

    features = np.array(
        [
            avg_eye_openness,
            blink_rate_variance,
            expression_entropy,
            speech_rate_change,
            pitch_variance,
            silence_ratio,
            motion_magnitude_mean,
            motion_spikes,
            interaction_dropoff,
        ],
        dtype=np.float64,
    )

    # Guard against any residual NaN / inf from edge-case inputs
    features = np.where(np.isfinite(features), features, 0.0)
    return features


# ---------------------------------------------------------------------------
# Data layer (async — queries SQLite)
# ---------------------------------------------------------------------------

async def fetch_telemetry_window(
    patient_id: str,
    db,
    lookback_seconds: int = LOOKBACK_SECONDS,
) -> list[dict]:
    """Return recent telemetry batches for a patient as plain dicts, oldest first."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=lookback_seconds)
    result = await db.execute(
        select(TelemetryBatch)
        .where(
            TelemetryBatch.patient_id == patient_id,
            TelemetryBatch.received_at >= cutoff,
        )
        .order_by(TelemetryBatch.window_start_ms.asc())
    )
    rows = result.scalars().all()
    return [
        {
            "face":             row.face_json,
            "audio":            row.audio_json,
            "motion":           row.motion_json,
            "pointer":          row.pointer_json,
            "window_start_ms":  row.window_start_ms,
            "received_at":      row.received_at,
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# Dataset builder (async)
# ---------------------------------------------------------------------------

async def build_labeled_dataset(
    db,
    min_samples_per_class: int = 5,
) -> tuple[np.ndarray, np.ndarray]:
    """Build a supervised training dataset from historical DB records.

    Labeling strategy (from the pseudocode):
      label = 1  if a ClinicalReport incident occurs within 5 minutes after
                 the end of a 30-second telemetry window for the same patient.
      label = 0  otherwise.

    When fewer than `min_samples_per_class` real examples exist for either
    class, synthetic samples are appended to bootstrap training in
    development before real incident data has accumulated.
    """
    X_list: list[np.ndarray] = []
    y_list: list[int] = []

    # All clinical reports, sorted by time
    reports_result = await db.execute(
        select(ClinicalReport).order_by(ClinicalReport.incident_timestamp.asc())
    )
    reports = reports_result.scalars().all()

    # patient_id → sorted list of incident datetimes
    incident_times: dict[str, list[datetime]] = {}
    for r in reports:
        incident_times.setdefault(r.patient_id, []).append(r.incident_timestamp)

    # All patient IDs
    patients_result = await db.execute(select(Patient.id))
    patient_ids = [row[0] for row in patients_result.all()]

    for pid in patient_ids:
        telem_result = await db.execute(
            select(TelemetryBatch)
            .where(TelemetryBatch.patient_id == pid)
            .order_by(TelemetryBatch.window_start_ms.asc())
        )
        all_batches = telem_result.scalars().all()
        if not all_batches:
            continue

        p_incidents = incident_times.get(pid, [])
        window_ms   = LOOKBACK_SECONDS * 1000
        first_ts    = all_batches[0].window_start_ms
        last_ts     = all_batches[-1].window_end_ms
        window_start = first_ts

        # Slide non-overlapping 30-second windows across all stored telemetry
        while window_start + window_ms <= last_ts:
            window_end = window_start + window_ms
            window_batches = [
                {
                    "face":    b.face_json,
                    "audio":   b.audio_json,
                    "motion":  b.motion_json,
                    "pointer": b.pointer_json,
                }
                for b in all_batches
                if window_start <= b.window_start_ms < window_end
            ]

            if len(window_batches) < MIN_BATCHES_REQUIRED:
                window_start = window_end
                continue

            features = extract_features(window_batches)
            if features is None:
                window_start = window_end
                continue

            # Convert the window end timestamp (ms since epoch) to UTC datetime
            window_end_dt  = datetime.fromtimestamp(window_end / 1000.0, tz=timezone.utc)
            lookahead_dt   = window_end_dt + timedelta(seconds=INCIDENT_LOOKAHEAD_SECONDS)

            label = int(
                any(window_end_dt <= t <= lookahead_dt for t in p_incidents)
            )
            X_list.append(features)
            y_list.append(label)
            window_start = window_end

    X_real = np.array(X_list, dtype=np.float64) if X_list else np.empty((0, len(FEATURE_NAMES)))
    y_real = np.array(y_list, dtype=int)       if y_list else np.empty(0, dtype=int)

    pos_count = int(np.sum(y_real == 1)) if len(y_real) > 0 else 0
    neg_count = int(np.sum(y_real == 0)) if len(y_real) > 0 else 0

    log.info(
        "[triage] Real training data: %d positive, %d negative",
        pos_count, neg_count,
    )

    need_synthetic = pos_count < min_samples_per_class or neg_count < min_samples_per_class
    if need_synthetic:
        log.info(
            "[triage] Augmenting with synthetic samples (need >= %d per class)",
            min_samples_per_class,
        )
        X_syn, y_syn = _generate_synthetic_samples(
            n_positive=max(0, min_samples_per_class - pos_count),
            n_negative=max(0, min_samples_per_class - neg_count),
        )
        X = np.vstack([X_real, X_syn]) if len(X_real) > 0 else X_syn
        y = np.concatenate([y_real, y_syn]) if len(y_real) > 0 else y_syn
    else:
        X, y = X_real, y_real

    return X, y


def _generate_synthetic_samples(
    n_positive: int = 20,
    n_negative: int = 20,
    seed: int = 42,
) -> tuple[np.ndarray, np.ndarray]:
    """Synthetic training data to bootstrap the model before real incidents accumulate.

    Positive class (impending crisis):
      eyes closing, erratic blinks, chaotic expressions, speech slowing,
      high pitch variance, increasing silence, motion extremes, no interaction.

    Negative class (baseline):
      eyes open, stable blinks, moderate expression, steady speech,
      low pitch variance, low silence, moderate motion, active interaction.
    """
    rng = np.random.default_rng(seed)

    def sample_crisis() -> np.ndarray:
        # Agitation (high motion) or freezing (near-zero motion) — both are crisis signals
        agitated = rng.random() > 0.5
        return np.array([
            rng.uniform(0.0, 0.35),      # avg_eye_openness: closing
            rng.uniform(0.1,  0.5),      # blink_rate_variance: erratic
            rng.uniform(1.5,  3.0),      # expression_entropy: high
            rng.uniform(-0.3, -0.05),    # speech_rate_change: slowing
            rng.uniform(800., 3000.),    # pitch_variance: high
            rng.uniform(0.4,  0.9),      # silence_ratio: going quiet
            rng.uniform(0.7,  1.0) if agitated else rng.uniform(0.0, 0.05),
            float(rng.integers(3, 10)),  # motion_spikes: frequent
            1.0,                         # interaction_dropoff: dropped off
        ], dtype=np.float64)

    def sample_normal() -> np.ndarray:
        return np.array([
            rng.uniform(0.6,   1.0),     # avg_eye_openness: open
            rng.uniform(0.0,   0.05),    # blink_rate_variance: stable
            rng.uniform(0.3,   1.2),     # expression_entropy: moderate
            rng.uniform(-0.02, 0.02),    # speech_rate_change: stable
            rng.uniform(0.,    200.),    # pitch_variance: low
            rng.uniform(0.0,   0.2),     # silence_ratio: mostly speaking
            rng.uniform(0.1,   0.4),     # motion_magnitude_mean: some motion
            float(rng.integers(0, 3)),   # motion_spikes: rare
            0.0,                         # interaction_dropoff: active
        ], dtype=np.float64)

    X_pos = np.array([sample_crisis() for _ in range(n_positive)])
    X_neg = np.array([sample_normal() for _ in range(n_negative)])
    y_pos = np.ones(n_positive, dtype=int)
    y_neg = np.zeros(n_negative, dtype=int)
    return np.vstack([X_pos, X_neg]), np.concatenate([y_pos, y_neg])


# ---------------------------------------------------------------------------
# Model training (synchronous — run in thread pool for large datasets)
# ---------------------------------------------------------------------------

def train_model(X: np.ndarray, y: np.ndarray) -> CalibratedClassifierCV:
    """Fit a GradientBoostingClassifier and calibrate it with Platt Scaling.

    Sample weights are computed with sklearn's 'balanced' strategy so the
    rare positive class is not swamped by the majority negative class.

    Returns:
        A CalibratedClassifierCV whose predict_proba() output is a
        true probability in [0, 1], not just a relative score.
    """
    if len(X) == 0:
        raise ValueError("Empty dataset — nothing to train on.")
    if len(np.unique(y)) < 2:
        raise ValueError(
            "Dataset has only one class. Both positive and negative samples are required."
        )

    log.info(
        "[triage] Training on %d samples  (%d positive, %d negative)",
        len(y), int(np.sum(y == 1)), int(np.sum(y == 0)),
    )

    sample_weights = compute_sample_weight("balanced", y)

    base = GradientBoostingClassifier(
        n_estimators=100,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        random_state=42,
    )
    base.fit(X, y, sample_weight=sample_weights)

    # cv='prefit': keep the already-fitted base, only fit the sigmoid layer
    calibrated = CalibratedClassifierCV(base, method="sigmoid", cv="prefit")
    calibrated.fit(X, y)

    log.info("[triage] Training complete.")
    return calibrated


# ---------------------------------------------------------------------------
# Model persistence
# ---------------------------------------------------------------------------

def save_model(model: CalibratedClassifierCV) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    log.info("[triage] Model saved → %s", MODEL_PATH)


def load_model() -> Optional[CalibratedClassifierCV]:
    """Load from disk into the module cache. Returns None if no model exists yet."""
    if not MODEL_PATH.exists():
        log.info(
            "[triage] No saved model at %s — call POST /api/model/train to create one.",
            MODEL_PATH,
        )
        return None
    model = joblib.load(MODEL_PATH)
    _model_cache["model"] = model
    log.info("[triage] Model loaded ← %s", MODEL_PATH)
    return model


# ---------------------------------------------------------------------------
# Online inference (async)
# ---------------------------------------------------------------------------

async def score_patient(
    patient_id: str,
    model: CalibratedClassifierCV,
    db,
) -> Optional[float]:
    """Return the deterioration risk probability for a patient, or None if
    there is not enough recent telemetry to make a prediction."""
    batches = await fetch_telemetry_window(patient_id, db, LOOKBACK_SECONDS)
    if len(batches) < MIN_BATCHES_REQUIRED:
        return None

    features = extract_features(batches)
    if features is None:
        return None

    risk_prob = float(model.predict_proba(features.reshape(1, -1))[0, 1])
    return risk_prob


# ---------------------------------------------------------------------------
# Decision + alerting (async)
# ---------------------------------------------------------------------------

async def evaluate_and_alert(
    patient_id: str,
    model: CalibratedClassifierCV,
    db,
) -> Optional[dict]:
    """Score the patient, persist the result, and emit a dashboard alert
    if the risk probability exceeds the WARNING or CRITICAL threshold.

    Always writes a RiskScore row (including 'normal' scores) for audit history.
    Returns a summary dict, or None when there was insufficient telemetry data.
    """
    risk_prob = await score_patient(patient_id, model, db)
    if risk_prob is None:
        return None

    if risk_prob >= CRITICAL_THRESHOLD:
        severity = "critical"
    elif risk_prob >= WARNING_THRESHOLD:
        severity = "warning"
    else:
        severity = "normal"

    db.add(RiskScore(patient_id=patient_id, risk_prob=risk_prob, severity=severity))

    result = {"patient_id": patient_id, "risk_prob": risk_prob, "severity": severity}

    if severity == "normal":
        return result

    # Write an incident to Convex so the clinician dashboard updates in real-time
    incident_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    incident_payload = {
        "id":                      incident_id,
        "patient_id":              patient_id,
        "patient_name":            patient_id,
        "patient_initials":        patient_id[:2].upper(),
        "patient_accent":          "amber",
        "timestamp":               now_iso,
        "trigger_type":            "probability_model",
        "source":                  "probability_model",
        "risk_score":              risk_prob,
        "severity":                severity,
        "status":                  "unreviewed",
        "on_device_action":        "ml_triage_alert",
        "user_statement":          f"ML triage model: risk probability {risk_prob:.2f}.",
        "acoustic_variance":       0.0,
        "peak_db":                 0,
        "arkit_stress_index":      0.0,
        "arkit_dominant_expression": "not_available",
        "stabilized":              False,
    }

    try:
        await call_mutation(
            "emberIncidents:upsert",
            {
                "incidentId": incident_id,
                "patientId":  patient_id,
                "payload":    incident_payload,
            },
        )
        result["incident_id"] = incident_id
    except Exception as exc:
        log.warning("[triage] Convex sync failed for patient %s: %s", patient_id, exc)

    log.info(
        "[triage] %s — risk=%.3f  severity=%s",
        patient_id, risk_prob, severity,
    )
    return result


# ---------------------------------------------------------------------------
# Scoring loop (async background task)
# ---------------------------------------------------------------------------

async def run_scoring_loop() -> None:
    """Background task: wake every SCORING_INTERVAL_SECONDS, score all patients
    that have received telemetry in the last 60 s, and alert where needed.

    Launched with asyncio.create_task() from the FastAPI lifespan.
    """
    log.info("[triage] Scoring loop started  (interval=%ds)", SCORING_INTERVAL_SECONDS)
    while True:
        await asyncio.sleep(SCORING_INTERVAL_SECONDS)

        model = _model_cache.get("model")
        if model is None:
            log.debug("[triage] No model loaded — skipping tick.")
            continue

        async with AsyncSessionLocal() as db:
            try:
                cutoff = datetime.now(timezone.utc) - timedelta(seconds=60)
                result = await db.execute(
                    select(TelemetryBatch.patient_id)
                    .where(TelemetryBatch.received_at >= cutoff)
                    .distinct()
                )
                active_ids = [row[0] for row in result.all()]

                for pid in active_ids:
                    try:
                        await evaluate_and_alert(pid, model, db)
                    except Exception as exc:
                        log.warning("[triage] Error scoring %s: %s", pid, exc)

                await db.commit()
                log.debug("[triage] Tick complete — scored %d patients.", len(active_ids))
            except Exception as exc:
                log.warning("[triage] Scoring loop error: %s", exc)
                await db.rollback()
