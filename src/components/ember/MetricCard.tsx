import { cn } from "@/lib/utils";

const fmtDelta = (delta: number) => `${delta >= 0 ? "+" : ""}${Math.round(delta)}`;

export const MetricCard = ({
  icon: Icon,
  name,
  description,
  safeValue,
  dangerValue,
}: {
  icon: any;
  name: string;
  description: string;
  safeValue: number;
  dangerValue: number;
}) => {
  const delta = dangerValue - safeValue;
  const deltaMagnitude = Math.min(100, Math.max(0, Math.abs(delta)));

  return (
    <div className="bg-card border border-border rounded-md p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold text-foreground">{name}</div>
          </div>
          <div className={cn("mono text-[11px] font-semibold", delta >= 0 ? "text-primary" : "text-[#8A95A5]")}>
            {fmtDelta(delta)}
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between mono text-[10px] text-muted-foreground mb-1">
          <span>SAFE {Math.round(safeValue)}</span>
          <span>DANGER {Math.round(dangerValue)}</span>
        </div>
        <div className="relative h-2 rounded-full bg-[#16181A] border border-border overflow-hidden">
          <div className="absolute top-0 left-0 h-full bg-[#F2EEE3]/50" style={{ width: `${safeValue}%` }} />
          <div
            className="absolute top-0 left-0 h-full"
            style={{
              width: `${dangerValue}%`,
              background: "linear-gradient(90deg, #E27533 0%, #D6975A 100%)",
              boxShadow: "0 0 10px rgba(226,117,51,0.35)",
            }}
          />
        </div>
        <div className="mono text-[10px] text-muted-foreground mt-1">Delta mag: {Math.round(deltaMagnitude)}</div>
      </div>
    </div>
  );
};
