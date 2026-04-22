import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type MetricsShape = {
  anomalyScore?: number;
  f0Hz?: number;
  rmsDb?: number;
  spectralCentroid?: number;
  spectralFlux?: number;
  zcr?: number;
};

const SAMPLE = `{
  "description": "example description",
  "anomalyScore": 0.2,
  "f0Hz": 480,
  "rmsDb": -48.68651594306242,
  "spectralCentroid": 1361.0631019789932,
  "spectralFlux": 9.84356259216187e-7,
  "zcr": 468.75
}`;

const BACKEND_BASE = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://127.0.0.1:8001";

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export default function GemmaJSONIngest() {
  const [patientId, setPatientId] = useState("pat-test-1");
  const [source, setSource] = useState("web_gemma_json");
  const [jsonText, setJsonText] = useState(SAMPLE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<string>("");

  const payloadPreview = useMemo(() => {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const metrics: MetricsShape = {
        anomalyScore: asNumber(parsed.anomalyScore, 0),
        f0Hz: asNumber(parsed.f0Hz, 0),
        rmsDb: asNumber(parsed.rmsDb, -60),
        spectralCentroid: asNumber(parsed.spectralCentroid, 0),
        spectralFlux: asNumber(parsed.spectralFlux, 0),
        zcr: asNumber(parsed.zcr, 0),
      };
      return {
        patient_id: patientId.trim(),
        description: String(parsed.description ?? ""),
        metrics,
        source: source.trim() || "web_gemma_json",
      };
    } catch {
      return null;
    }
  }, [jsonText, patientId, source]);

  const submit = async () => {
    if (!payloadPreview) {
      toast.error("Invalid JSON", { description: "Fix the JSON body before submitting." });
      return;
    }
    if (!payloadPreview.patient_id) {
      toast.error("Patient ID required");
      return;
    }
    setIsSubmitting(true);
    setLastResult("");
    try {
      const response = await fetch(`${BACKEND_BASE}/api/incidents/metrics-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadPreview),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      setLastResult(text);
      toast.success("Gemma metrics incident ingested", {
        description: "Convex incident + journal rows were created.",
      });
    } catch (error) {
      toast.error("Ingest failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8 space-y-6">
      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-foreground font-semibold">
          <FlaskConical className="w-4 h-4 text-primary" />
          Gemma JSON to Incident Report
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Paste Gemma metrics JSON, then submit. This creates a MasterMind incident report and a matching `journalEntries` JSON row in Convex.
        </p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Patient ID</label>
            <Input value={patientId} onChange={(e) => setPatientId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Source tag</label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Gemma metrics JSON</label>
            <Textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="min-h-[300px] font-mono text-xs"
            />
          </div>
          <Button type="button" onClick={() => void submit()} disabled={isSubmitting} className="gap-2">
            <Upload className="w-4 h-4" />
            {isSubmitting ? "Submitting..." : "Create incident report"}
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">Normalized payload preview</h3>
          <pre className="text-xs bg-background border border-border rounded p-3 overflow-auto max-h-[420px]">
            {payloadPreview ? JSON.stringify(payloadPreview, null, 2) : "Invalid JSON"}
          </pre>
          {lastResult ? (
            <>
              <h4 className="text-sm font-semibold">API response</h4>
              <pre className="text-xs bg-background border border-border rounded p-3 overflow-auto max-h-[180px]">
                {lastResult}
              </pre>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
