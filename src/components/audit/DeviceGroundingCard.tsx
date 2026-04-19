import { useQuery } from "convex/react";
import { Info, Smartphone } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type CellDef = {
  plainName: string;
  techLabel: string;
  tooltipBody: string;
  value: string;
};

const buildCells = (stats: {
  avgSpectralFlux: number | null;
  avgMfccDeviation: number | null;
  avgZcrDensity: number | null;
  avgSpectralCentroid: number | null;
  avgFundamentalHz: number | null;
  avgRms: number | null;
}): CellDef[] => {
  const fmt = (n: number | null) => (n == null ? "—" : n.toFixed(3));
  return [
    {
      plainName: "Spectral change",
      techLabel: "spectral flux",
      tooltipBody:
        "Engineering term: spectral flux. Higher often means more environmental change or uneven breathing (stressful contexts).",
      value: fmt(stats.avgSpectralFlux),
    },
    {
      plainName: "Voice-shape drift",
      techLabel: "MFCC deviation",
      tooltipBody:
        "Engineering term: MFCC deviation — shape of the voice fingerprint vs. baseline. Larger = farther from calm voice fingerprint.",
      value: fmt(stats.avgMfccDeviation),
    },
    {
      plainName: "Noisiness",
      techLabel: "ZCR density",
      tooltipBody:
        "Engineering term: zero-crossing rate (ZCR) density — rapid sign changes in the waveform (tension or noisy environment).",
      value: fmt(stats.avgZcrDensity),
    },
    {
      plainName: "Brightness (centroid)",
      techLabel: "spectral centroid (Hz)",
      tooltipBody:
        "Engineering term: spectral centroid — where energy clusters on the frequency axis (brightness of the voice).",
      value: stats.avgSpectralCentroid != null ? stats.avgSpectralCentroid.toFixed(0) : "—",
    },
    {
      plainName: "Pitch (F0)",
      techLabel: "fundamental frequency",
      tooltipBody: "Engineering term: fundamental frequency (F0) — rough pitch of voiced sound.",
      value: stats.avgFundamentalHz != null ? stats.avgFundamentalHz.toFixed(1) : "—",
    },
    {
      plainName: "Loudness (RMS)",
      techLabel: "RMS energy",
      tooltipBody: "Engineering term: RMS — relative loudness/energy after processing.",
      value: fmt(stats.avgRms),
    },
  ];
};

function MetricLabelWithInfo({ cell }: { cell: CellDef }) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <span className="text-sm font-semibold text-foreground leading-snug">{cell.plainName}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="shrink-0 mt-0.5 rounded-full text-muted-foreground hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label={`Technical details: ${cell.techLabel}`}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          <p className="font-mono text-[10px] text-muted-foreground mb-1">{cell.techLabel}</p>
          <p>{cell.tooltipBody}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Real-device aggregates — use inside “Hardware sanity check” section. */
export function DeviceGroundingCard() {
  const stats = useQuery(api.validation.deviceGroundingStats, { limit: 200 });

  if (!stats) {
    return (
      <div className="rounded-lg border border-border/80 bg-background/40 p-4 text-sm text-muted-foreground">
        Loading field-device summary…
      </div>
    );
  }

  if (stats.count === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/80 bg-background/30 p-5 space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed">
          No device rows yet. When phones send MasterMind audio, averages appear here so reviewers can ask:{" "}
          <em>“Do real-world numbers look plausible?”</em> This does not grade the LLM. Add data from Benchmarking →{" "}
          <span className="text-foreground/90">Demo iOS payload</span> or the native app.
        </p>
      </div>
    );
  }

  const cells = buildCells(stats);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="mono text-[10px] text-muted-foreground">
          n={stats.count} · patients: {stats.patients.join(", ") || "—"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Averages from on-device audio features. Use as a <strong className="text-foreground/90">sanity band</strong> only — not a
        model pass/fail. Hover the info icon beside each label for engineering terms.
      </p>
      <TooltipProvider delayDuration={200}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cells.map((c) => (
            <div
              key={c.plainName}
              className={cn(
                "rounded-lg border px-3 py-3 text-left",
                "border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-950/40",
              )}
            >
              <MetricLabelWithInfo cell={c} />
              <div className="mono text-2xl font-bold text-primary mt-3 tabular-nums tracking-tight">{c.value}</div>
            </div>
          ))}
        </div>
      </TooltipProvider>
    </div>
  );
}

/** Optional header row when embedding in a parent section (icon only). */
export function DeviceGroundingCardHeader() {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <Smartphone className="w-4 h-4 text-primary" />
      Pocket devices (Convex feed)
    </div>
  );
}
