import { cn } from "@/lib/utils";
import type { IncidentSeverity } from "@/lib/ember-types";

export const StatusBadge = ({ severity, className }: { severity: IncidentSeverity | string; className?: string }) => {
  const isCrit = severity === "critical" || severity === "CRITICAL";
  const isHigh = severity === "high" || severity === "HIGH";
  const isMod = severity === "moderate" || severity === "MODERATE";

  const severityClass = isCrit
    ? "bg-destructive/15 text-destructive border-destructive/50"
    : isHigh
    ? "bg-primary/15 text-primary border-primary/50"
    : isMod
    ? "bg-primary-glow/20 text-primary border-primary-glow/50"
    : "bg-muted text-muted-foreground border-border";

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
