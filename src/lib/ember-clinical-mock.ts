/** High-level audit rigor metrics for clinician portal mock state */
export type AuditMetricSnapshot = {
  id: string;
  label: string;
  model: string;
  precision_at_high: number;
  calibration_drift: number;
  checked_at: string;
};

export const MOCK_AUDIT_METRICS: AuditMetricSnapshot[] = [
  {
    id: "m-1",
    label: "Distress classifier",
    model: "gemini-2.5-flash",
    precision_at_high: 0.91,
    calibration_drift: 0.04,
    checked_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: "m-2",
    label: "Acoustic RAG summarizer",
    model: "gemini-2.5-flash",
    precision_at_high: 0.87,
    calibration_drift: 0.07,
    checked_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: "m-3",
    label: "Dialect fairness harness",
    model: "eval-harness-v2",
    precision_at_high: 0.84,
    calibration_drift: 0.11,
    checked_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
];
