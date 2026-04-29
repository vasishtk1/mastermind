# MasterMind — Triage Risk Scoring Model (Pseudocode)

Probability model for real-time patient deterioration prediction,
integrating with the existing Convex schema (telemetryBatches → emberIncidents).

---

## Data Layer

```
FUNCTION fetchTelemetryWindow(patientId, lookbackSeconds=30):
    // Pull recent telemetry from Convex telemetryBatches table
    batches = query telemetryBatches
                WHERE patientId == patientId
                AND timestamp >= (now - lookbackSeconds)
                ORDER BY timestamp ASC
    RETURN batches  // each batch: { faceMetrics, audioMetrics, motionMetrics, pointerMetrics }
```

---

## Feature Extraction

```
FUNCTION extractFeatures(batches):
    features = {}

    // Face signals
    features.avgEyeOpenness     = mean([b.faceMetrics.eyeOpenness for b in batches])
    features.blinkRateVariance  = variance([b.faceMetrics.blinkRate for b in batches])
    features.expressionEntropy  = shannonEntropy([b.faceMetrics.expression for b in batches])

    // Audio signals
    features.speechRateChange   = linearSlope([b.audioMetrics.speechRate for b in batches])
    features.pitchVariance      = variance([b.audioMetrics.pitch for b in batches])
    features.silenceRatio       = count(silentFrames) / count(batches)

    // Motion signals
    features.motionMagnitudeMean = mean([b.motionMetrics.magnitude for b in batches])
    features.motionSpikes        = count(b for b in batches if b.motionMetrics.magnitude > SPIKE_THRESHOLD)

    // Pointer/interaction signals
    features.interactionDropoff  = 1 if last N batches have no pointer events else 0

    RETURN features  // flat numeric vector, ready for model input
```

---

## Model

### Offline Training (runs on historical labeled data)

```
FUNCTION trainModel(labeledDataset):
    // labeledDataset: list of (features, label) where label = 1 if incident occurred within 5 min
    X = [extractFeatures(sample.batches) for sample in labeledDataset]
    y = [sample.label for sample in labeledDataset]

    model = GradientBoostedClassifier(
        n_estimators   = 100,
        max_depth      = 4,
        learning_rate  = 0.05,
        class_weight   = "balanced"  // important: incidents are rare events
    )

    model.fit(X_train, y_train)
    calibratedModel = PlattScaling(model)  // ensures output is a true probability, not just a score
    RETURN calibratedModel
```

### Online Inference (runs every 30s per patient)

```
FUNCTION scorePatient(patientId, model):
    batches  = fetchTelemetryWindow(patientId, lookbackSeconds=30)
    IF len(batches) < MIN_BATCHES_REQUIRED:
        RETURN null  // not enough data yet

    features = extractFeatures(batches)
    riskProb = model.predict_proba(features)  // float in [0.0, 1.0]
    RETURN riskProb
```

---

## Decision + Alerting

```
FUNCTION evaluateAndAlert(patientId, model):
    riskProb = scorePatient(patientId, model)
    IF riskProb == null: RETURN

    IF riskProb >= 0.80:
        severity = "critical"
    ELSE IF riskProb >= 0.55:
        severity = "warning"
    ELSE:
        severity = "normal"
        RETURN  // no alert needed

    // Write to Convex emberIncidents table
    INSERT INTO emberIncidents {
        patientId:   patientId,
        riskScore:   riskProb,
        severity:    severity,
        source:      "probability_model",
        timestamp:   now()
    }

    notifyClinician(patientId, severity, riskProb)
```

---

## Scheduler

```
FUNCTION runScoringLoop(model):
    EVERY 30 seconds:
        activePatients = query patients WHERE status == "active"
        FOR EACH patient IN activePatients:
            evaluateAndAlert(patient.id, model)
```

---

## Design Notes

- **Platt Scaling** calibrates the model so output is a genuine probability, not just a relative score — important in clinical contexts.
- **`class_weight = "balanced"`** compensates for class imbalance (most 30s windows won't precede an incident).
- The **30s lookback window** and **30s polling interval** are tunable — adjust based on how fast patients deteriorate in your data.
- The **thresholds (0.80 / 0.55)** are placeholders — pick these based on the precision/recall tradeoff acceptable to clinicians.

---

## Other Integration Points (future)

| Location | Model Type | Output |
|---|---|---|
| `clinicalReports` severity | Bayesian classifier | Calibrated severity probability |
| `journalEntries` mood | HMM / state-space model | Mood deterioration forecast |
| Voice agent audio | On-device distress classifier | Distress probability score |
| `evalRuns` fairness | Calibration audit | Per-demographic reliability metrics |
