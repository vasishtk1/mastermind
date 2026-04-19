import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, Bell, Users } from "lucide-react";
import type { IncidentReport, IncidentSeverity, IncidentStatus } from "@/lib/ember-types";
import { generateIncomingIncident } from "@/lib/incident-mock";
import { useEmberData } from "@/context/EmberClinicalContext";
import { cn } from "@/lib/utils";

const SEV_BADGE: Record<IncidentSeverity, string> = {
  critical: "bg-red-900/40 text-red-300 border-red-500/50",
  high: "bg-orange-900/30 text-orange-300 border-orange-500/45",
  moderate: "bg-amber-900/25 text-amber-200 border-amber-500/40",
  low: "bg-slate-800 text-slate-300 border-slate-600/60",
};

const ST_LABEL: Record<IncidentStatus, string> = {
  unreviewed: "New",
  in_review: "In progress",
  resolved: "Closed",
};

const ST_BADGE: Record<IncidentStatus, string> = {
  unreviewed: "text-red-300/90",
  in_review: "text-amber-300/90",
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
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Incidents</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            When someone’s phone sends a check-in after distress, it appears here. Open a row to read what happened and
            respond.
          </p>
          <p className="text-xs text-muted-foreground/80 mt-2">
            <Link to="/patients" className="text-primary hover:underline">
              View patient list
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 bg-card tabular-nums">
            <Users className="w-3.5 h-3.5 shrink-0" />
            {patients.length} patients
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 bg-card tabular-nums">
            <Activity className="w-3.5 h-3.5 shrink-0" />
            {incidents.length} reports
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
          <p className="text-sm text-red-200">
            <span className="font-semibold tabular-nums">{pendingReview}</span> new report
            {pendingReview === 1 ? "" : "s"} to review
          </p>
        </div>
      )}

      <section className="flex-1 min-h-0 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground shrink-0">All reports</h2>
        <div className="rounded-lg border border-border bg-card overflow-hidden flex-1 min-h-[280px] flex flex-col">
          <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto_auto] gap-3 px-4 py-2.5 border-b border-border text-[11px] font-medium text-muted-foreground items-center">
            <span>What happened</span>
            <span>Patient</span>
            <span>Level</span>
            <span className="text-right pr-1">When</span>
          </div>
          <div className="divide-y divide-border overflow-y-auto flex-1">
            {sortedIncidents.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => openIncidentWorkspace(row)}
                className={cn(
                  "w-full text-left grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto_auto] gap-3 px-4 py-3 hover:bg-muted/15 transition-colors group items-center min-h-[4.25rem]",
                  newIncidentIds.has(row.id) && "bg-primary/5",
                )}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {newIncidentIds.has(row.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-primary/50 text-primary font-medium">
                        Just in
                      </span>
                    )}
                    <span className={cn("text-[11px] font-medium", ST_BADGE[row.status])}>{ST_LABEL[row.status]}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground line-clamp-1">{row.trigger_type}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">&ldquo;{row.user_statement}&rdquo;</p>
                </div>
                <div className="flex items-center min-w-0">
                  <span className="text-sm text-foreground truncate">{row.patient_name}</span>
                </div>
                <div className="flex items-center justify-start">
                  <span
                    className={cn(
                      "text-[11px] capitalize px-2 py-1 rounded-md border shrink-0",
                      SEV_BADGE[row.severity],
                    )}
                  >
                    {row.severity}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                    {timeAgo(row.timestamp)}
                  </span>
                  <AlertTriangle className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
