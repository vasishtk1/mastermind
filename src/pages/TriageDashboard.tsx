import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, ArrowRight, Bell, ChevronRight, Users } from "lucide-react";
import type { IncidentReport, IncidentSeverity, IncidentStatus, Patient } from "@/lib/ember-types";
import { generateIncomingIncident } from "@/lib/incident-mock";
import { useEmberData } from "@/context/EmberClinicalContext";
import { cn } from "@/lib/utils";

const SEV_BADGE: Record<IncidentSeverity, string> = {
  critical: "bg-red-900/40 text-red-300 border-red-500/50",
  high: "bg-orange-900/30 text-orange-300 border-orange-500/45",
  moderate: "bg-amber-900/25 text-amber-200 border-amber-500/40",
  low: "bg-slate-800 text-slate-300 border-slate-600/60",
};

const ST_BADGE: Record<IncidentStatus, string> = {
  unreviewed: "text-red-300",
  in_review: "text-amber-300",
  resolved: "text-emerald-400/90",
};

function rankForTriage(i: IncidentReport): number {
  if (i.status === "unreviewed" && i.severity === "critical") return 0;
  if (i.status === "unreviewed" && i.severity === "high") return 1;
  if (i.status === "unreviewed") return 2;
  if (i.status === "in_review") return 3;
  return 4;
}

function timeAgo(iso: string) {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  return `${Math.round(diff / 60)}h ago`;
}

function PatientRosterCard({ patient, alertCount }: { patient: Patient; alertCount: number }) {
  return (
    <Link
      to={`/patients/${patient.id}/profile`}
      className="group shrink-0 w-[220px] rounded-lg border border-border bg-card/80 hover:border-primary/50 hover:bg-card p-4 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "w-9 h-9 rounded-md grid place-items-center mono text-xs font-bold border shrink-0",
              patient.accent === "teal" && "bg-primary/15 text-primary border-primary/40",
              patient.accent === "violet" && "bg-secondary/15 text-secondary border-secondary/40",
              patient.accent === "coral" && "bg-amber-500/10 text-amber-400 border-amber-500/35",
            )}
          >
            {patient.initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{patient.name}</p>
            <p className="mono text-[10px] text-muted-foreground truncate">{patient.condition}</p>
          </div>
        </div>
        {alertCount > 0 ? (
          <span className="mono text-[10px] px-1.5 py-0.5 rounded-full bg-red-900/50 text-red-200 border border-red-500/40">
            {alertCount}
          </span>
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        )}
      </div>
    </Link>
  );
}

export default function TriageDashboard() {
  const navigate = useNavigate();
  const { patients, incidents, setIncidents } = useEmberData();
  const [newIncidentIds, setNewIncidentIds] = useState<Set<string>>(new Set());
  const [bannerPulse, setBannerPulse] = useState(false);
  const pollSeqRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patientPool = useMemo(
    () =>
      patients.map((p) => ({
        id: p.id,
        patient_name: p.name,
        patient_initials: p.initials,
        patient_accent: p.accent,
      })),
    [patients],
  );

  const sortedIncidents = useMemo(() => {
    const copy = [...incidents];
    copy.sort((a, b) => {
      const d = rankForTriage(a) - rankForTriage(b);
      if (d !== 0) return d;
      return +new Date(b.timestamp) - +new Date(a.timestamp);
    });
    return copy;
  }, [incidents]);

  const unreviewedCritical = incidents.filter((i) => i.status === "unreviewed" && i.severity === "critical").length;
  const unreviewedHigh = incidents.filter((i) => i.status === "unreviewed" && i.severity === "high").length;
  const pendingReview = incidents.filter((i) => i.status === "unreviewed").length;

  const scheduleNextPoll = useCallback(() => {
    pollTimerRef.current = setTimeout(() => {
      const newInc = generateIncomingIncident(pollSeqRef.current++, patientPool);
      setIncidents((prev) => [newInc, ...prev]);
      setNewIncidentIds((ids) => new Set([...ids, newInc.id]));
      setBannerPulse(true);
      setTimeout(() => setBannerPulse(false), 5000);
      scheduleNextPoll();
    }, 45_000);
  }, [patientPool, setIncidents]);

  useEffect(() => {
    scheduleNextPoll();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [scheduleNextPoll]);

  const openIncidentWorkspace = (i: IncidentReport) => {
    navigate(`/patients/${i.patient_id}/profile?incident=${encodeURIComponent(i.id)}`);
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-6 md:p-8 gap-6 overflow-y-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 shrink-0">
        <div>
          <p className="mono text-[10px] tracking-[0.2em] text-primary uppercase mb-1">Triage center</p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Escalation queue &amp; roster</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Prioritized <span className="mono text-xs">IncomingDeviceEvent</span> stream. Open an alert to investigate
            neuroscience signals and deploy edge directives.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 mono text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 bg-card">
            <Users className="w-3.5 h-3.5" />
            {patients.length} patients
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 bg-card">
            <Activity className="w-3.5 h-3.5" />
            {incidents.length} events
          </span>
        </div>
      </header>

      {pendingReview > 0 && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-950/25 px-4 py-3",
            bannerPulse && "animate-pulse",
          )}
        >
          <Bell className="w-4 h-4 text-red-400 shrink-0" />
          <p className="mono text-sm text-red-200">
            <span className="font-semibold">{pendingReview}</span> device payload
            {pendingReview === 1 ? "" : "s"} awaiting review
          </p>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Patient roster</h2>
          <Link
            to="/patients"
            className="mono text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            Manage roster <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
          {patients.map((p) => {
            const alerts = incidents.filter(
              (i) =>
                i.patient_id === p.id &&
                i.status === "unreviewed" &&
                (i.severity === "critical" || i.severity === "high"),
            ).length;
            return <PatientRosterCard key={p.id} patient={p} alertCount={alerts} />;
          })}
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
        <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4">
          <p className="mono text-[10px] tracking-widest text-red-300/80 uppercase">Critical · unreviewed</p>
          <p className="mono text-2xl font-bold text-red-200 mt-1">{unreviewedCritical}</p>
        </div>
        <div className="rounded-lg border border-orange-500/30 bg-orange-950/15 p-4">
          <p className="mono text-[10px] tracking-widest text-orange-200/80 uppercase">High · unreviewed</p>
          <p className="mono text-2xl font-bold text-orange-100 mt-1">{unreviewedHigh}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mono text-[10px] tracking-widest text-muted-foreground uppercase">All pending</p>
          <p className="mono text-2xl font-bold text-foreground mt-1">{pendingReview}</p>
        </div>
      </section>

      <section className="flex-1 min-h-0 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground shrink-0">Prioritized device queue</h2>
        <div className="rounded-lg border border-border bg-card/50 overflow-hidden flex-1 min-h-[280px] flex flex-col">
          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_auto_auto] gap-3 px-4 py-2 border-b border-border mono text-[10px] tracking-widest text-muted-foreground uppercase">
            <span>Signal &amp; statement</span>
            <span>Patient</span>
            <span>Severity</span>
            <span className="text-right pr-2">Time</span>
          </div>
          <div className="divide-y divide-border overflow-y-auto flex-1">
            {sortedIncidents.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => openIncidentWorkspace(row)}
                className={cn(
                  "w-full text-left grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_auto_auto] gap-3 px-4 py-3 hover:bg-muted/15 transition-colors group",
                  newIncidentIds.has(row.id) && "bg-primary/5",
                )}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {newIncidentIds.has(row.id) && (
                      <span className="mono text-[9px] px-1.5 py-0.5 rounded border border-primary/50 text-primary">
                        NEW
                      </span>
                    )}
                    <span className={`mono text-[10px] uppercase tracking-wide ${ST_BADGE[row.status]}`}>
                      {row.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{row.trigger_type}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">&ldquo;{row.user_statement}&rdquo;</p>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="mono text-xs text-foreground truncate">{row.patient_name}</span>
                </div>
                <div className="flex items-center">
                  <span
                    className={cn(
                      "mono text-[10px] tracking-widest px-2 py-1 rounded border",
                      SEV_BADGE[row.severity],
                    )}
                  >
                    {row.severity}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="mono text-[10px] text-muted-foreground whitespace-nowrap">{timeAgo(row.timestamp)}</span>
                  <AlertTriangle className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
