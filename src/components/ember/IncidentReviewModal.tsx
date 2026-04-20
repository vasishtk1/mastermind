import { useState, useEffect } from "react";
import {
  X,
  Wand2,
  Loader2,
  AlertTriangle,
  Mic,
  MessageSquareText,
  BrainCircuit,
  Cpu,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
} from "lucide-react";
import type { IncidentReport, ClinicalSynthesis, DeployedDirective } from "@/lib/ember-types";
import { InsightDeploymentForm } from "./InsightDeploymentForm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityColor(s: IncidentReport["severity"]) {
  return s === "critical"
    ? "text-destructive border-destructive/55 bg-destructive/10"
    : s === "high"
    ? "text-primary border-primary/55 bg-primary/10"
    : s === "moderate"
    ? "text-warning border-warning/55 bg-warning/10"
    : "text-muted-foreground border-border bg-muted";
}

function ScoreBar({
  value,
  color = "bg-primary",
}: {
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-700`}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="mono text-xs text-muted-foreground w-8 text-right">
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="mono text-[10px] tracking-widest text-muted-foreground uppercase">{label}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RAG synthesis helper — calls the existing /api/events pipeline
// ---------------------------------------------------------------------------

async function runRagSynthesis(incident: IncidentReport): Promise<ClinicalSynthesis> {
  const transcript = [
    `[PATIENT SELF-REPORT] "${incident.user_statement}"`,
    `[ON-DEVICE AI ACTION] ${incident.on_device_action}`,
    `[TRIGGER] ${incident.trigger_type}`,
    `[ARKIT DOMINANT EXPRESSION] ${incident.arkit_dominant_expression}`,
    `[PATIENT STABILISED] ${incident.stabilized ? "Yes" : "No — still distressed"}`,
  ].join("\n\n");

  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timestamp: incident.timestamp,
      patient_id: incident.patient_id,
      pre_intervention_mfcc_variance: incident.acoustic_variance,
      intervention_transcript: transcript,
      stabilized_flag: incident.stabilized,
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const report = await res.json();

  return {
    generated_at: new Date().toISOString(),
    model: "gemini",
    summary: report.clinical_summary ?? "—",
    dsm_mapping: `Severity score: ${(report.estimated_severity_score ?? 0).toFixed(1)}/10`,
    risk_assessment: report.keywords?.join(", ") ?? "—",
    recommended_followup: report.recommended_followup ?? "—",
    keywords: report.keywords ?? [],
    severity_score: report.estimated_severity_score ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  incident: IncidentReport;
  onClose: () => void;
  onUpdate: (updated: IncidentReport) => void;
}

export function IncidentReviewModal({ incident: initialIncident, onClose, onUpdate }: Props) {
  const [incident, setIncident] = useState(initialIncident);
  const [synthesising, setSynthesising] = useState(false);
  const [synthError, setSynthError] = useState<string | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);

  // Keep in sync if parent updates (e.g. realtime Gemini Flash synthesis arrived,
  // or directive was deployed). We compare on the full payload, not just id.
  useEffect(() => {
    setIncident(initialIncident);
    setDeployOpen(!!initialIncident.clinical_synthesis);
  }, [initialIncident]);

  const handleSynthesise = async () => {
    setSynthesising(true);
    setSynthError(null);
    try {
      const synthesis = await runRagSynthesis(incident);
      const updated: IncidentReport = {
        ...incident,
        clinical_synthesis: synthesis,
        status: "in_review",
      };
      setIncident(updated);
      onUpdate(updated);
      setDeployOpen(true);
    } catch (err) {
      setSynthError(err instanceof Error ? err.message : "Synthesis failed");
    } finally {
      setSynthesising(false);
    }
  };

  const handleDirectiveDeployed = (directive: DeployedDirective) => {
    const updated: IncidentReport = {
      ...incident,
      deployed_directive: directive,
      status: "resolved",
    };
    setIncident(updated);
    onUpdate(updated);
  };

  const sc = severityColor(incident.severity);
  const ts = new Date(incident.timestamp);
  const ago = Math.round((Date.now() - ts.getTime()) / 60000);
  const agoLabel = ago < 60 ? `${ago} min ago` : `${Math.round(ago / 60)} hr ago`;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "hsl(220 14% 18% / 0.45)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Modal shell */}
      <div
        className="relative w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded border border-border flex flex-col"
        style={{ background: "hsl(var(--surface))", boxShadow: "var(--shadow-panel)" }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 z-10"
          style={{ background: "hsl(var(--surface))" }}>
          <div className="flex items-center gap-3">
            <span
              className={`mono text-[10px] tracking-widest px-2 py-0.5 rounded border font-semibold uppercase ${sc}`}
            >
              {incident.severity}
            </span>
            <span className="font-semibold text-sm">{incident.patient_name}</span>
            <span className="text-muted-foreground text-xs">·</span>
            <span className="mono text-xs text-muted-foreground">{incident.id.toUpperCase()}</span>
            <span className="text-muted-foreground text-xs">·</span>
            <span className="mono text-xs text-muted-foreground">{agoLabel}</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-0 flex-1 min-h-0">

          {/* Left: Raw Device Signals */}
          <div className="flex-1 p-6 space-y-5 border-b lg:border-b-0 lg:border-r border-border">
            <div className="flex items-center gap-2 mb-1">
              <Cpu className="w-4 h-4 text-muted-foreground" />
              <span className="mono text-[10px] tracking-widest text-muted-foreground uppercase">
                Raw Device Signals
              </span>
            </div>

            {/* Trigger */}
            <DataRow label="Trigger">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-medium">{incident.trigger_type}</span>
              </div>
            </DataRow>

            {/* Acoustic variance */}
            <DataRow label="Acoustic Variance">
              <p className="mono text-lg font-semibold text-primary">
                {(incident.acoustic_variance * 100).toFixed(1)}%
              </p>
              <ScoreBar
                value={incident.acoustic_variance}
                color={
                  incident.acoustic_variance > 0.75
                    ? "bg-destructive"
                    : incident.acoustic_variance > 0.5
                    ? "bg-primary"
                    : "bg-warning"
                }
              />
              <p className="mono text-[10px] text-muted-foreground mt-1">
                Peak {incident.peak_db} dB · threshold exceeded
              </p>
            </DataRow>

            {/* ARKit stress */}
            <DataRow label="ARKit Facial Stress Index (5-sec avg)">
              <div className="flex items-center gap-2">
                <p className="mono text-lg font-semibold text-primary">
                  {(incident.arkit_stress_index * 100).toFixed(0)}%
                </p>
              </div>
              <ScoreBar
                value={incident.arkit_stress_index}
                color={
                  incident.arkit_stress_index > 0.7
                    ? "bg-destructive"
                    : "bg-primary"
                }
              />
              <p className="mono text-[10px] text-muted-foreground mt-1">
                Dominant: {incident.arkit_dominant_expression}
              </p>
            </DataRow>

            {/* Patient statement */}
            <DataRow label="Patient Self-Report">
              <div className="flex gap-2">
                <MessageSquareText className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <blockquote className="text-sm text-foreground/90 italic leading-relaxed border-l-2 border-primary/40 pl-3">
                  "{incident.user_statement}"
                </blockquote>
              </div>
            </DataRow>

            {/* On-device action */}
            <DataRow label="On-Device AI Action">
              <div className="flex gap-2">
                <Mic className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {incident.on_device_action}
                </p>
              </div>
            </DataRow>

            {/* Stabilised chip */}
            <div className="flex items-center gap-2">
              <span
                className={`mono text-[10px] px-2 py-0.5 rounded border tracking-wider ${
                  incident.stabilized
                    ? "text-primary border-primary/50 bg-primary/10"
                    : "text-destructive border-destructive/50 bg-destructive/10"
                }`}
              >
                {incident.stabilized ? "STABILISED" : "NOT STABILISED"}
              </span>
            </div>
          </div>

          {/* Right: Clinical Synthesis */}
          <div className="flex-1 p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <BrainCircuit className="w-4 h-4 text-muted-foreground" />
              <span className="mono text-[10px] tracking-widest text-muted-foreground uppercase">
                Clinical Synthesis
              </span>
            </div>

            {!incident.clinical_synthesis && !synthesising && (
              <div className="flex flex-col items-center justify-center h-64 gap-4 rounded border border-dashed border-border">
                <p className="text-muted-foreground text-sm text-center max-w-xs">
                  Run the Gemini RAG pipeline to generate a compliance-ready clinical note from the raw device signals.
                </p>
                <button
                  onClick={handleSynthesise}
                  className="flex items-center gap-2 px-5 py-2.5 rounded text-sm font-semibold transition-all"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary-glow)) 100%)",
                    color: "hsl(var(--primary-foreground))",
                    boxShadow: "0 0 18px hsl(var(--primary) / 0.4)",
                  }}
                >
                  <Wand2 className="w-4 h-4" />
                  Synthesise via RAG
                </button>
                {synthError && (
                  <p className="mono text-xs text-danger text-center">{synthError}</p>
                )}
              </div>
            )}

            {synthesising && (
              <div className="flex flex-col items-center justify-center h-64 gap-3">
                <Loader2 className="w-7 h-7 text-primary animate-spin" />
                <p className="mono text-xs text-muted-foreground">Querying Gemini RAG pipeline…</p>
              </div>
            )}

            {incident.clinical_synthesis && (
              <SynthesisPanel synthesis={incident.clinical_synthesis} />
            )}
          </div>
        </div>

        {/* ── Deploy Panel ───────────────────────────────────────────────── */}
        {incident.clinical_synthesis && (
          <div className="border-t border-border">
            <button
              onClick={() => setDeployOpen((o) => !o)}
              className="w-full flex items-center justify-between px-6 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
            >
              <span className="mono text-[10px] tracking-widest uppercase">
                {incident.deployed_directive
                  ? "Directive Deployed"
                  : "Deploy Insight to Device"}
              </span>
              {deployOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {deployOpen && (
              <div className="px-6 pb-5">
                {incident.deployed_directive ? (
                  <DeployedChip directive={incident.deployed_directive} />
                ) : (
                  <InsightDeploymentForm
                    incident={incident}
                    onDeployed={handleDirectiveDeployed}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-panels
// ---------------------------------------------------------------------------

function SynthesisPanel({ synthesis }: { synthesis: ClinicalSynthesis }) {
  const scoreColor =
    synthesis.severity_score >= 7
      ? "text-destructive"
      : synthesis.severity_score >= 4
      ? "text-primary"
      : "text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* AI badge */}
      <div className="flex items-center gap-2">
        <span className="mono text-[9px] tracking-widest px-2 py-0.5 rounded border border-primary/40 text-primary bg-primary/10 uppercase">
          AI · {synthesis.model}
        </span>
        <span className="mono text-[10px] text-muted-foreground">
          {new Date(synthesis.generated_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <span className={`ml-auto mono text-sm font-bold ${scoreColor}`}>
          {synthesis.severity_score.toFixed(1)}
          <span className="text-muted-foreground text-xs font-normal"> / 10</span>
        </span>
      </div>

      <SynthBlock label="Clinical Summary" content={synthesis.summary} />
      <SynthBlock label="DSM-5 Mapping" content={synthesis.dsm_mapping} />
      <SynthBlock label="Risk Assessment" content={synthesis.risk_assessment} />
      <SynthBlock label="Recommended Follow-up" content={synthesis.recommended_followup} highlight />

      {synthesis.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {synthesis.keywords.map((kw) => (
            <span
              key={kw}
              className="mono text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border"
            >
              {kw}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SynthBlock({
  label,
  content,
  highlight,
}: {
  label: string;
  content: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded p-3 space-y-1 ${
        highlight
          ? "border border-primary/20 bg-primary/5"
          : "border border-border bg-background/40"
      }`}
    >
      <p className="mono text-[10px] tracking-widest text-muted-foreground uppercase">{label}</p>
      <p className="text-sm text-foreground/90 leading-relaxed">{content}</p>
    </div>
  );
}

function DeployedChip({ directive }: { directive: DeployedDirective }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded border border-warning/40 bg-warning/10">
      <CheckCircle2 className="w-5 h-5 text-warning shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-warning">{directive.directive_type}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {directive.instructions}
        </p>
        <p className="mono text-[10px] text-muted-foreground/60 mt-1.5">
          Deployed{" "}
          {new Date(directive.deployed_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          ·{" "}
          {directive.acknowledged ? (
            <span className="text-foreground font-medium">Acknowledged by patient</span>
          ) : (
            <span className="text-warning">Awaiting acknowledgement</span>
          )}
        </p>
      </div>
    </div>
  );
}
