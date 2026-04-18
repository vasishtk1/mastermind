import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { Activity, X } from "lucide-react";
import { CountUp } from "@/components/ember/CountUp";
import { cn } from "@/lib/utils";

const WINDOW_SIZE = 80;
const TICK_MS = 120;

const RESPONSES = [
  "Take a slow breath. Let's step into the corridor — it's quieter there.",
  "I noticed the noise rising. You're safe. Try counting backwards from ten with me.",
  "The room is overwhelming right now. Let's move toward the window for fresh air.",
];

const EdgeSentinel = () => {
  const [waveform, setWaveform] = useState<number[]>(() => Array(WINDOW_SIZE).fill(50));
  const [db, setDb] = useState(58);
  const [voices, setVoices] = useState(2);
  const [variance, setVariance] = useState(0.3);
  const [triggered, setTriggered] = useState(false);
  const [flash, setFlash] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [uptime, setUptime] = useState(0);
  const lastTriggerRef = useRef(Date.now());
  const tRef = useRef(0);

  // uptime
  useEffect(() => {
    const id = setInterval(() => setUptime((u) => u + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // tick simulation
  useEffect(() => {
    const id = setInterval(() => {
      tRef.current += 1;
      const t = tRef.current;
      const base = 55 + Math.sin(t * 0.18) * 6 + Math.sin(t * 0.07) * 4;
      const noise = (Math.random() - 0.5) * 8;
      const sinceTrigger = (Date.now() - lastTriggerRef.current) / 1000;
      const wantSpike = sinceTrigger > 11 && Math.random() < 0.08;
      const value = wantSpike ? 88 + Math.random() * 6 : base + noise;
      setWaveform((prev) => {
        const next = prev.slice(1);
        next.push(value);
        return next;
      });
      if (wantSpike) {
        lastTriggerRef.current = Date.now();
        triggerSpike();
      }
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // stat updates every 500ms
  useEffect(() => {
    const id = setInterval(() => {
      setDb(Math.round(52 + Math.random() * 37));
      setVoices(1 + Math.floor(Math.random() * 5));
      setVariance(+(0.1 + Math.random() * 0.8).toFixed(2));
    }, 500);
    return () => clearInterval(id);
  }, []);

  const triggerSpike = () => {
    setTriggered(true);
    setFlash(true);
    setResponse(RESPONSES[Math.floor(Math.random() * RESPONSES.length)]);
    setTimeout(() => setFlash(false), 1800);
    setTimeout(() => setTriggered(false), 5000);
  };

  const data = useMemo(
    () => ({
      labels: waveform.map((_, i) => i),
      datasets: [
        {
          data: waveform,
          borderColor: "hsl(174 84% 52%)",
          backgroundColor: "hsla(174, 84%, 52%, 0.12)",
          fill: true,
          pointRadius: 0,
          borderWidth: 1.5,
          tension: 0.35,
        },
      ],
    }),
    [waveform],
  );

  const options = useMemo<any>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          grid: { color: "hsla(174, 50%, 50%, 0.05)" },
          ticks: { display: false },
        },
        y: {
          min: 30,
          max: 100,
          grid: { color: "hsla(174, 50%, 50%, 0.06)" },
          ticks: { color: "hsl(215 18% 60%)", font: { family: "JetBrains Mono", size: 9 }, stepSize: 20 },
        },
      },
    }),
    [],
  );

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, "0");
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${h}:${m}:${sec}`;
  };

  return (
    <div className="relative h-screen flex flex-col">
      {/* Flash overlay */}
      {flash && (
        <div className="absolute inset-0 pointer-events-none z-30 animate-flash-red bg-danger/10" />
      )}

      {/* Top bar */}
      <header className="px-8 py-4 border-b border-border/60 flex items-center justify-between bg-surface/40 backdrop-blur-sm z-10">
        <div className="flex items-center gap-6">
          <div>
            <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground">PATIENT</div>
            <div className="text-base font-semibold mt-0.5">Patient A · Mira K.</div>
          </div>
          <div className="h-10 w-px bg-border" />
          <div>
            <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground">ACTIVE PROFILE</div>
            <div className="text-base font-medium mt-0.5 text-primary">Auditory overstimulation</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div
            className={cn(
              "px-3 py-1.5 rounded-md mono text-xs font-bold tracking-widest border",
              triggered
                ? "bg-danger/15 border-danger text-danger animate-pulse-danger"
                : "bg-primary/10 border-primary/50 text-primary",
            )}
          >
            <span className="inline-flex items-center gap-2">
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  triggered ? "bg-danger" : "bg-primary animate-pulse-dot",
                )}
              />
              {triggered ? "TRIGGERED" : "MONITORING"}
            </span>
          </div>
          <div className="text-right">
            <div className="mono text-[9px] tracking-[0.2em] text-muted-foreground">SENTINEL ACTIVE</div>
            <div className="mono text-sm text-foreground tabular-nums">{fmtUptime(uptime)}</div>
          </div>
        </div>
      </header>

      {/* Waveform */}
      <section className="flex-1 px-8 py-6 min-h-0">
        <div className="panel p-5 h-full flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground">LIVE ACOUSTIC WAVEFORM</div>
            </div>
            <div className="flex items-center gap-4 mono text-[10px]">
              <span className="flex items-center gap-1.5 text-safe"><span className="w-3 h-px bg-safe" /> SAFE 60</span>
              <span className="flex items-center gap-1.5 text-warning"><span className="w-3 h-px bg-warning" /> WARN 75</span>
              <span className="flex items-center gap-1.5 text-danger"><span className="w-3 h-px bg-danger" /> DANGER 85</span>
            </div>
          </div>

          <div className="relative flex-1 min-h-0">
            <Line data={data} options={options} />
            {/* threshold lines */}
            {[
              { v: 60, color: "hsl(174 84% 52%)" },
              { v: 75, color: "hsl(42 100% 60%)" },
              { v: 85, color: "hsl(0 100% 67%)" },
            ].map(({ v, color }) => (
              <div
                key={v}
                className="absolute left-0 right-0 pointer-events-none"
                style={{
                  top: `${((100 - v) / 70) * 100}%`,
                  borderTop: `1px dashed ${color}`,
                  opacity: 0.55,
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Stat cards */}
      <section className="px-8 pb-6 grid grid-cols-3 gap-4">
        <StatCard label="Current dB" value={db} unit="dB" warn={db > 75} />
        <StatCard label="Voice count" value={voices} unit="voices" />
        <StatCard label="Freq variance" value={variance} unit="σ" decimals={2} />
      </section>

      {/* Intervention modal */}
      {triggered && response && (
        <div className="absolute left-0 right-0 bottom-0 z-40 px-8 pb-6 animate-slide-up">
          <div className="panel border-danger/50 glow-danger p-5 bg-card/90 backdrop-blur-md">
            <div className="flex items-start gap-4">
              <div className="shrink-0 mt-1">
                <div className="w-10 h-10 rounded-full bg-danger/15 border border-danger grid place-items-center animate-pulse-danger">
                  <Activity className="w-5 h-5 text-danger" />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <div className="mono text-[10px] tracking-[0.2em] text-danger">INTERVENTION FIRED</div>
                  <div className="mono text-[10px] text-muted-foreground">gemma-4 · 142ms</div>
                </div>
                <p className="italic text-base leading-relaxed text-foreground">"{response}"</p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="mono text-[10px] tracking-[0.2em] text-primary">EMBER IS SPEAKING</div>
                  <div className="flex items-end gap-0.5 h-4">
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                      <span
                        key={i}
                        className="w-0.5 bg-primary rounded-full origin-bottom animate-speak-bar"
                        style={{ height: "100%", animationDelay: `${i * 0.08}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setTriggered(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({
  label,
  value,
  unit,
  decimals = 0,
  warn = false,
}: { label: string; value: number; unit: string; decimals?: number; warn?: boolean }) => (
  <div className={cn("panel p-5 transition-colors", warn && "border-warning/60")}>
    <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground">{label.toUpperCase()}</div>
    <div className="mt-3 flex items-baseline gap-2">
      <CountUp
        value={value}
        decimals={decimals}
        duration={300}
        className={cn(
          "mono text-4xl font-bold tabular-nums",
          warn ? "text-warning text-glow-teal" : "text-primary text-glow-teal",
        )}
      />
      <span className="mono text-xs text-muted-foreground">{unit}</span>
    </div>
  </div>
);

export default EdgeSentinel;
