import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, AlertTriangle, Users } from "lucide-react";
import type { IncidentReport, IncidentStatus } from "@/lib/ember-types";
import { useEmberData } from "@/context/EmberClinicalContext";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ember/StatusBadge";

const ST_LABEL: Record<IncidentStatus, string> = {
  unreviewed: "New",
  in_review: "In progress",
  resolved: "Closed",
};

const ST_BADGE: Record<IncidentStatus, string> = {
  unreviewed: "text-destructive/90",
  in_review: "text-primary/90",
  resolved: "text-muted-foreground",
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
  const { patients, incidents } = useEmberData();

  const sortedIncidents = useMemo(() => {
    const copy = [...incidents];
    copy.sort((a, b) => {
      const d = rankForTriage(a) - rankForTriage(b);
      if (d !== 0) return d;
      return +new Date(b.timestamp) - +new Date(a.timestamp);
    });
    return copy;
  }, [incidents]);

  const openIncidentWorkspace = (i: IncidentReport) => {
    navigate(`/patients/${i.patient_id}/profile?incident=${encodeURIComponent(i.id)}`);
  };

  return (
    <div className="flex flex-col h-full min-h-0 p-8 gap-8 overflow-y-auto bg-background">
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 shrink-0 bg-card border border-border/60 rounded-xl p-6 shadow-sm">
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Incidents</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl leading-relaxed">
              When a device check-in detects distress, it appears here. Open a report row to read what happened and respond to the patient.
            </p>
          </div>
          <Link to="/patients" className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80 transition-colors">
            View patient roster &rarr;
          </Link>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground bg-muted/20 p-1.5 rounded-lg border border-border/40 shadow-sm">
          <span className="inline-flex items-center gap-2 rounded-md px-3 py-2 bg-background shadow-sm border border-border/50 tabular-nums">
            <Users className="w-3.5 h-3.5 shrink-0 text-primary" />
            {patients.length} PATIENTS
          </span>
          <span className="inline-flex items-center gap-2 rounded-md px-3 py-2 bg-background shadow-sm border border-border/50 tabular-nums">
            <Activity className="w-3.5 h-3.5 shrink-0 text-primary" />
            {incidents.length} REPORTS
          </span>
        </div>
      </header>

      <section className="flex-1 min-h-0 flex flex-col pt-2">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/40 shrink-0">
          <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">All reports</h2>
        </div>
        
        <div className="flex-1 min-h-[280px] flex flex-col">
          <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto_auto] gap-4 px-2 py-3 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground items-center">
            <span>What happened</span>
            <span>Patient</span>
            <span>Level</span>
            <span className="text-right pr-2">When</span>
          </div>
          <div className="divide-y divide-border/40 overflow-y-auto flex-1 pr-2">
            {sortedIncidents.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => openIncidentWorkspace(row)}
                className={cn(
                  "w-full text-left grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto_auto] gap-4 px-2 py-4 hover:bg-muted/10 transition-colors group items-center min-h-[4.5rem] rounded-md",
                )}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-[11px] font-medium", ST_BADGE[row.status])}>{ST_LABEL[row.status]}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground line-clamp-1">{row.trigger_type}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">&ldquo;{row.user_statement}&rdquo;</p>
                </div>
                <div className="flex items-center min-w-0">
                  <span className="text-sm text-foreground truncate">{row.patient_name}</span>
                </div>
                <div className="flex items-center justify-start">
                  <StatusBadge severity={row.severity} />
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
