import { Activity, Crosshair, TrendingUp, Waves, Wind, Zap } from "lucide-react";
import type { RadarMetrics } from "@/lib/ember-types";
import { FEATURE_EXPLAINERS } from "@/lib/ember-mock";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof Waves> = {
  Waves,
  Activity,
  TrendingUp,
  Wind,
  Crosshair,
  Zap,
};

const RADAR_KEYS: Array<keyof RadarMetrics> = [
  "spectral_flux",
  "mfcc_deviation",
  "pitch_escalation",
  "breath_rate",
  "spectral_centroid",
  "zcr_density",
];

export const toRadarArray = (r: RadarMetrics) => RADAR_KEYS.map((k) => r[k]);

const fmtDelta = (delta: number) => `${delta >= 0 ? "+" : ""}${Math.round(delta)}`;

export function AcousticThresholdRadar({ safeValues, dangerValues }: { safeValues: number[]; dangerValues: number[] }) {
  const size = 520;
  const center = size / 2;
  const maxRadius = 188;
  const labels = ["Spectral Flux", "MFCC Deviation", "Pitch Escalation", "Breath Rate", "Spectral Centroid", "ZCR Density"];
  const ringRatios = [0.33, 0.66, 1];
  const ringLabels = ["Baseline", "Elevated", "Critical"];

  const pointFor = (index: number, valueRatio: number) => {
    const angle = -Math.PI / 2 + (index * (2 * Math.PI)) / 6;
    const r = maxRadius * valueRatio;
    return {
      x: center + Math.cos(angle) * r,
      y: center + Math.sin(angle) * r,
    };
  };

  const polygonFromValues = (values: number[]) =>
    values
      .map((value, idx) => pointFor(idx, Math.min(1, Math.max(0, value / 100))))
      .map((p) => `${p.x},${p.y}`)
      .join(" ");

  const ringPolygon = (ratio: number) =>
    Array.from({ length: 6 })
      .map((_, idx) => pointFor(idx, ratio))
      .map((p) => `${p.x},${p.y}`)
      .join(" ");

  const safePolygon = polygonFromValues(safeValues);
  const dangerPolygon = polygonFromValues(dangerValues);

  return (
    <div className="h-full w-full min-h-[320px] flex items-center justify-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full max-h-[min(520px,55vh)]">
        <defs>
          <radialGradient id="emberDangerFillPanel" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="#E27533" stopOpacity="0.06" />
            <stop offset="70%" stopColor="#E27533" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#D6975A" stopOpacity="0.32" />
          </radialGradient>
          <filter id="emberGlowPanel">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {ringRatios.map((ratio) => (
          <polygon
            key={ratio}
            points={ringPolygon(ratio)}
            fill="none"
            stroke="#3A3E45"
            strokeDasharray="5 6"
            strokeWidth={1}
          />
        ))}

        {Array.from({ length: 6 }).map((_, idx) => {
          const p = pointFor(idx, 1);
          return <line key={idx} x1={center} y1={center} x2={p.x} y2={p.y} stroke="#3A3E45" strokeWidth={1} />;
        })}

        <polygon points={safePolygon} fill="#F2EEE3" fillOpacity={0.2} stroke="#F2EEE3" strokeWidth={1.6} />
        <polygon
          points={dangerPolygon}
          fill="url(#emberDangerFillPanel)"
          stroke="#E27533"
          strokeWidth={2.2}
          filter="url(#emberGlowPanel)"
        />

        {dangerValues.map((value, idx) => {
          const p = pointFor(idx, Math.min(1, Math.max(0, value / 100)));
          return <circle key={idx} cx={p.x} cy={p.y} r={4.6} fill="#E27533" filter="url(#emberGlowPanel)" />;
        })}

        {labels.map((label, idx) => {
          const p = pointFor(idx, 1.13);
          return (
            <text
              key={label}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#9BA4B5"
              fontSize="11"
              fontFamily="Inter, sans-serif"
            >
              {label}
            </text>
          );
        })}

        {ringRatios.map((ratio, idx) => {
          const p = pointFor(0, ratio);
          return (
            <text key={ringLabels[idx]} x={p.x + 8} y={p.y - 8} fill="#8A95A5" fontSize="10" fontFamily="Inter, sans-serif">
              {ringLabels[idx]}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function SignalMetricCard({
  iconKey,
  name,
  description,
  safeValue,
  dangerValue,
}: {
  iconKey: string;
  name: string;
  description: string;
  safeValue: number;
  dangerValue: number;
}) {
  const Icon = ICONS[iconKey] ?? Activity;
  const delta = dangerValue - safeValue;
  const deltaMagnitude = Math.min(100, Math.max(0, Math.abs(delta)));

  return (
    <div className="bg-card border border-border rounded-md p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" />
          <div className="text-sm font-semibold text-foreground">{name}</div>
        </div>
        <div className={cn("mono text-[11px] font-semibold", delta >= 0 ? "text-primary" : "text-secondary")}>
          {fmtDelta(delta)}
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>

      <div className="mt-3">
        <div className="flex items-center justify-between mono text-[10px] text-muted-foreground mb-1">
          <span>SAFE {Math.round(safeValue)}</span>
          <span>DANGER {Math.round(dangerValue)}</span>
        </div>
        <div className="relative h-2 rounded-full bg-input border border-border overflow-hidden">
          <div className="absolute top-0 left-0 h-full bg-accent/50" style={{ width: `${safeValue}%` }} />
          <div
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary to-amber-500/90"
            style={{ width: `${dangerValue}%`, boxShadow: "0 0 10px rgba(226,117,51,0.35)" }}
          />
        </div>
        <div className="mono text-[10px] text-muted-foreground mt-1">Delta magnitude: {Math.round(deltaMagnitude)}</div>
      </div>
    </div>
  );
}

export function AcousticSignalPanel({ safeRadar, dangerRadar }: { safeRadar: RadarMetrics; dangerRadar: RadarMetrics }) {
  const safeArr = toRadarArray(safeRadar);
  const dangerArr = toRadarArray(dangerRadar);
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card/40 p-4 md:p-5" style={{ minHeight: 360 }}>
        <AcousticThresholdRadar safeValues={safeArr} dangerValues={dangerArr} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {FEATURE_EXPLAINERS.map((f, idx) => (
          <SignalMetricCard
            key={f.key}
            iconKey={f.icon}
            name={f.name}
            description={f.desc}
            safeValue={safeArr[idx]}
            dangerValue={dangerArr[idx]}
          />
        ))}
      </div>
    </div>
  );
}
