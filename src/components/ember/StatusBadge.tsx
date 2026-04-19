import { cn } from "@/lib/utils";
import type { IncidentSeverity } from "@/lib/ember-types";

export const StatusBadge = ({ severity, className }: { severity: IncidentSeverity | string; className?: string }) => {
  const isCrit = severity === "critical" || severity === "CRITICAL";
  const isHigh = severity === "high" || severity === "HIGH";
  const isMod = severity === "moderate" || severity === "MODERATE";

  const severityClass = isCrit
    ? "bg-red-900/40 text-red-300 border-red-500/50"
    : isHigh
    ? "bg-orange-900/30 text-orange-300 border-orange-500/45"
    : isMod
    ? "bg-amber-900/25 text-amber-200 border-amber-500/40"
    : "bg-slate-800 text-slate-300 border-slate-600/60";

  return (
    <span
      className={cn(
        "text-[11px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-sm border inline-flex items-center justify-center shrink-0",
        severityClass,
        className
      )}
    >
      {severity}
    </span>
  );
};
