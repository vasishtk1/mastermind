import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bell,
  ChevronRight,
  CheckCircle2,
  Clock,
  Eye,
  TrendingUp,
  Activity,
  Users,
  Zap,
} from "lucide-react";
import type { IncidentReport, IncidentSeverity } from "@/lib/ember-types";
import { MOCK_INCIDENTS, generateIncomingIncident } from "@/lib/incident-mock";
import { IncidentReviewModal } from "@/components/ember/IncidentReviewModal";

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const PATIENTS = [
  { id: "pat-mira",  name: "Mira K.",  initials: "MK", accent: "teal",   condition: "PTSD · AUD-003"  },
  { id: "pat-james", name: "James T.", initials: "JT", accent: "violet", condition: "GAD · SOC-001"   },
  { id: "pat-priya", name: "Priya S.", initials: "PS", accent: "coral",  condition: "PTSD · AUD-007"  },
];

const ACCENT_COLORS: Record<string, { ring: string; bg: string; text: string }> = {
  teal:   { ring: "ring-primary",    bg: "bg-primary/15",   text: "text-primary"       },
  violet: { ring: "ring-secondary",  bg: "bg-secondary/15", text: "text-secondary"     },
  coral:  { ring: "ring-warning",    bg: "bg-warning/15",   text: "text-warning"       },
};

const SEV_CONFIG: Record<IncidentSeverity, { label: string; border: string; badge: string; dot: string }> = {
  critical: { label: "CRITICAL", border: "border-l-red-500",    badge: "text-red-400 border-red-500/50 bg-red-900/20",    dot: "bg-red-500"    },
  high:     { label: "HIGH",     border: "border-l-orange-500", badge: "text-orange-400 border-orange-500/50 bg-orange-900/15", dot: "bg-orange-500" },
  moderate: { label: "MODERATE", border: "border-l-yellow-500", badge: "text-yellow-400 border-yellow-500/50 bg-yellow-900/15", dot: "bg-yellow-500" },
  low:      { label: "LOW",      border: "border-l-blue-500",   badge: "text-blue-400 border-blue-500/50 bg-blue-900/15",   dot: "bg-blue-400"   },
};

const STATUS_CONFIG = {
  unreviewed: { label: "UNREVIEWED", cls: "text-red-400"          },
  in_review:  { label: "IN REVIEW",  cls: "text-yellow-400"       },
  resolved:   { label: "RESOLVED",   cls: "text-green-400"        },
};

function timeAgo(iso: string) {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1)  return "just now";
  if (diff < 60) return `${diff}m ago`;
  return `${Math.round(diff / 60)}h ago`;
}

function MiniBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="mono text-[10px] text-muted-foreground">{(value * 100).toFixed(0)}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active Alerts Banner
// ---------------------------------------------------------------------------

function AlertBanner({
  count,
  onViewFirst,
  isNew,
}: {
  count: number;
  onViewFirst: () => void;
  isNew: boolean;
}) {
  if (count === 0) return null;
  return (
    <div
      className={`flex items-center gap-3 px-5 py-3 rounded border border-red-500/50 bg-red-900/20 ${
        isNew ? "animate-pulse" : ""
      }`}
    >
      <span className="relative flex h-3 w-3 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
      </span>
      <p className="mono text-sm font-semibold text-red-300 tracking-wide">
        {count} ACTIVE ALERT{count > 1 ? "S" : ""} · IMMEDIATE REVIEW REQUIRED
      </p>
      <button
        onClick={onViewFirst}
        className="ml-auto mono text-xs text-red-300 hover:text-red-100 underline underline-offset-2 transition-colors"
      >
        Review now →
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Incident Card
// ---------------------------------------------------------------------------

function IncidentCard({
  incident,
  isNew,
  onClick,
}: {
  incident: IncidentReport;
  isNew: boolean;
  onClick: () => void;
}) {
  const sev = SEV_CONFIG[incident.severity];
  const stat = STATUS_CONFIG[incident.status];

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded border border-border border-l-4 ${sev.border} p-4 hover:bg-muted/20 transition-all group ${
        isNew ? "ring-1 ring-red-500/50" : ""
      }`}
      style={{ background: "hsl(var(--card))" }}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: info */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`mono text-[10px] tracking-widest px-1.5 py-0.5 rounded border font-bold ${sev.badge}`}>
              {sev.label}
            </span>
            {isNew && (
              <span className="mono text-[10px] tracking-widest px-1.5 py-0.5 rounded border border-red-500/60 text-red-300 bg-red-900/20 animate-pulse">
                NEW
              </span>
            )}
            <span className={`mono text-[10px] tracking-widest ${stat.cls}`}>
              {stat.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <p className="font-medium text-sm truncate">{incident.trigger_type}</p>
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            "{incident.user_statement}"
          </p>

          <div className="flex items-center gap-4">
            <div>
              <p className="mono text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5">
                Acoustic
              </p>
              <MiniBar
                value={incident.acoustic_variance}
                color={incident.acoustic_variance > 0.75 ? "bg-red-500" : "bg-orange-500"}
              />
            </div>
            <div>
              <p className="mono text-[9px] text-muted-foreground/60 uppercase tracking-widest mb-0.5">
                ARKit Stress
              </p>
              <MiniBar
                value={incident.arkit_stress_index}
                color={incident.arkit_stress_index > 0.7 ? "bg-red-500" : "bg-orange-400"}
              />
            </div>
            {incident.clinical_synthesis && (
              <div className="flex items-center gap-1 ml-auto">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                <span className="mono text-[10px] text-green-400">RAG</span>
              </div>
            )}
            {incident.deployed_directive && (
              <div className="flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="mono text-[10px] text-primary">Deployed</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: time + chevron */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="mono text-[10px] text-muted-foreground">{timeAgo(incident.timestamp)}</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Patient overview sidebar panel
// ---------------------------------------------------------------------------

function PatientOverview({
  patientId,
  incidents,
}: {
  patientId: string;
  incidents: IncidentReport[];
}) {
  const patient = PATIENTS.find((p) => p.id === patientId);
  const patientIncidents = incidents.filter((i) => i.patient_id === patientId);
  const unreviewed = patientIncidents.filter((i) => i.status === "unreviewed").length;
  const resolved   = patientIncidents.filter((i) => i.status === "resolved").length;
  const avgSeverity = patientIncidents.length
    ? patientIncidents.reduce((sum, i) => {
        const map: Record<IncidentSeverity, number> = { critical: 4, high: 3, moderate: 2, low: 1 };
        return sum + map[i.severity];
      }, 0) / patientIncidents.length
    : 0;

  const ac = patient ? ACCENT_COLORS[patient.accent] : ACCENT_COLORS.teal;
  const deployedDirectives = patientIncidents
    .filter((i) => i.deployed_directive)
    .map((i) => i.deployed_directive!);

  return (
    <div className="space-y-4">
      {/* Patient card */}
      {patient && (
        <div className="rounded border border-border p-4 space-y-2" style={{ background: "hsl(var(--card))" }}>
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full ring-2 ${ac.ring} ${ac.bg} grid place-items-center mono font-bold text-sm ${ac.text}`}
            >
              {patient.initials}
            </div>
            <div>
              <p className="font-semibold text-sm">{patient.name}</p>
              <p className="mono text-[10px] text-muted-foreground">{patient.condition}</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick stats */}
      <div className="rounded border border-border p-4 space-y-3" style={{ background: "hsl(var(--card))" }}>
        <p className="mono text-[10px] tracking-widest text-muted-foreground uppercase">Session Stats</p>
        <div className="grid grid-cols-3 gap-3">
          <StatBox label="Total" value={patientIncidents.length} icon={Activity} />
          <StatBox label="Pending" value={unreviewed} icon={Clock} color="text-orange-400" />
          <StatBox label="Resolved" value={resolved} icon={CheckCircle2} color="text-green-400" />
        </div>
        <div className="flex items-center justify-between">
          <p className="mono text-[10px] text-muted-foreground uppercase tracking-widest">Avg severity</p>
          <div className="flex items-center gap-1.5">
            <div className="w-20 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-orange-500"
                style={{ width: `${(avgSeverity / 4) * 100}%` }}
              />
            </div>
            <span className="mono text-xs text-muted-foreground">{avgSeverity.toFixed(1)}/4</span>
          </div>
        </div>
      </div>

      {/* Deployed directives */}
      {deployedDirectives.length > 0 && (
        <div className="rounded border border-border p-4 space-y-3" style={{ background: "hsl(var(--card))" }}>
          <p className="mono text-[10px] tracking-widest text-muted-foreground uppercase">
            Deployed Directives
          </p>
          <div className="space-y-2">
            {deployedDirectives.map((d) => (
              <div key={d.id} className="flex items-start gap-2">
                <Zap className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="mono text-[10px] text-primary">{d.directive_type}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {d.instructions}
                  </p>
                  <p className="mono text-[9px] text-muted-foreground/50 mt-0.5">
                    {d.acknowledged ? "✓ Acknowledged" : "Pending ACK"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="rounded border border-dashed border-border p-3 space-y-1">
        <p className="mono text-[9px] text-muted-foreground/60 uppercase tracking-widest">Workflow</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Click an incident to review raw device signals, then run the RAG pipeline to generate a clinical note and deploy an insight directive back to the patient's iPhone.
        </p>
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  icon: Icon,
  color = "text-foreground",
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div className="text-center space-y-1 p-2 rounded bg-muted/20">
      <Icon className={`w-3.5 h-3.5 mx-auto ${color}`} />
      <p className={`mono text-base font-bold ${color}`}>{value}</p>
      <p className="mono text-[9px] text-muted-foreground/70 uppercase tracking-wider">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function PatientDashboard() {
  const [incidents, setIncidents] = useState<IncidentReport[]>(MOCK_INCIDENTS);
  const [activePatient, setActivePatient] = useState(PATIENTS[0].id);
  const [selectedIncident, setSelectedIncident] = useState<IncidentReport | null>(null);
  const [newIncidentIds, setNewIncidentIds] = useState<Set<string>>(new Set());
  const [bannerIsNew, setBannerIsNew] = useState(false);
  const pollSeqRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Simulate new incident arriving every 45 seconds (demo polling) ───────
  const scheduleNextPoll = useCallback(() => {
    pollTimerRef.current = setTimeout(() => {
      const newInc = generateIncomingIncident(pollSeqRef.current++);
      setIncidents((prev) => [newInc, ...prev]);
      setNewIncidentIds((ids) => new Set([...ids, newInc.id]));
      setActivePatient(newInc.patient_id);
      setBannerIsNew(true);
      setTimeout(() => setBannerIsNew(false), 6000);
      scheduleNextPoll();
    }, 45_000);
  }, []);

  useEffect(() => {
    scheduleNextPoll();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [scheduleNextPoll]);

  // ── Filtered incidents for selected patient ───────────────────────────────
  const filtered = incidents.filter((i) => i.patient_id === activePatient);
  const activeAlerts = filtered.filter(
    (i) => (i.severity === "critical" || i.severity === "high") && i.status === "unreviewed"
  );

  const handleUpdateIncident = (updated: IncidentReport) => {
    setIncidents((prev) =>
      prev.map((i) => (i.id === updated.id ? updated : i))
    );
    setSelectedIncident(updated);
    // Clear "new" flag once reviewed
    setNewIncidentIds((ids) => {
      const next = new Set(ids);
      next.delete(updated.id);
      return next;
    });
  };

  const openFirstAlert = () => {
    const first = activeAlerts[0];
    if (first) setSelectedIncident(first);
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-6 gap-5">
      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Clinician Dashboard</h1>
          <p className="mono text-xs text-muted-foreground mt-0.5">
            Escalation Protocol · Incident review & directive deployment
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeAlerts.length > 0 && (
            <div className="flex items-center gap-1.5 mono text-xs text-red-400">
              <Bell className="w-3.5 h-3.5" />
              <span>{activeAlerts.length} active</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="mono text-xs text-muted-foreground">{incidents.length} total</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="mono text-xs text-muted-foreground">{PATIENTS.length} patients</span>
          </div>
        </div>
      </div>

      {/* ── Patient tabs ──────────────────────────────────────────────────── */}
      <div className="flex gap-2 shrink-0">
        {PATIENTS.map((p) => {
          const ac = ACCENT_COLORS[p.accent];
          const patIncidents = incidents.filter((i) => i.patient_id === p.id);
          const patAlerts = patIncidents.filter(
            (i) => (i.severity === "critical" || i.severity === "high") && i.status === "unreviewed"
          );
          const isActive = activePatient === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setActivePatient(p.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded border transition-all ${
                isActive
                  ? `border-primary ${ac.bg}`
                  : "border-border hover:border-muted hover:bg-muted/10"
              }`}
            >
              <div
                className={`w-7 h-7 rounded-full ${ac.bg} grid place-items-center mono text-xs font-bold ${ac.text} ring-1 ${
                  isActive ? ac.ring : "ring-border"
                }`}
              >
                {p.initials}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium leading-none">{p.name}</p>
                <p className="mono text-[10px] text-muted-foreground mt-0.5">{p.condition}</p>
              </div>
              {patAlerts.length > 0 && (
                <span className="ml-1 mono text-[10px] px-1.5 py-0.5 rounded-full bg-red-900/40 text-red-400 border border-red-500/40">
                  {patAlerts.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Active Alerts Banner ──────────────────────────────────────────── */}
      <div className="shrink-0">
        <AlertBanner
          count={activeAlerts.length}
          onViewFirst={openFirstAlert}
          isNew={bannerIsNew}
        />
      </div>

      {/* ── Main content grid ─────────────────────────────────────────────── */}
      <div className="flex gap-5 flex-1 min-h-0">
        {/* Incident feed */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 rounded border border-dashed border-border gap-3">
              <Eye className="w-6 h-6 text-muted-foreground/30" />
              <p className="mono text-xs text-muted-foreground">No incidents for this patient</p>
            </div>
          ) : (
            filtered.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                isNew={newIncidentIds.has(incident.id)}
                onClick={() => setSelectedIncident(incident)}
              />
            ))
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-64 shrink-0 overflow-y-auto space-y-4">
          <PatientOverview patientId={activePatient} incidents={incidents} />
        </div>
      </div>

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      {selectedIncident && (
        <IncidentReviewModal
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
          onUpdate={handleUpdateIncident}
        />
      )}
    </div>
  );
}
