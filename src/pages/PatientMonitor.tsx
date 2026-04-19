import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip as CTooltip,
  Legend,
} from "chart.js";
import { Activity, X } from "lucide-react";
import { CountUp } from "@/components/ember/CountUp";
import { PATIENTS, PROFILES } from "@/lib/ember-mock";
import { cn } from "@/lib/utils";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, CTooltip, Legend);

const WINDOW_SIZE = 90;
const TICK_MS = 140;

const REASONINGS = [
  "Anomaly score exceeded 0.87. Primary drivers: spectral flux +340%, pitch escalation, elevated breath rate. Intervention: auditory grounding initiated.",
  "MFCC deviation crossed threshold for 11 seconds. Voice count rising. Intervention: paced-breathing prompt with corridor relocation.",
  "Sharp transient at 3.8kHz · ZCR density spike. Acoustic-shock signature matched. Intervention: orienting cue + safe-window guidance.",
];

const PatientMonitor = () => {
  const patient = PATIENTS[0];
  const profile = PROFILES.find((p) => p.patient_id === patient.id && p.active) ?? PROFILES[0];

  const [db, setDb] = useState<number[]>(() => Array(WINDOW_SIZE).fill(54));
  const [anom, setAnom] = useState<number[]>(() => Array(WINDOW_SIZE).fill(20));
  const [curDb, setCurDb] = useState(54);
  const [curAnom, setCurAnom] = useState(0.22);
  const [spectralFlux, setSpectralFlux] = useState(0.18);
  const [voices, setVoices] = useState(2);
  const [breath, setBreath] = useState(15);
  const [pitchVar, setPitchVar] = useState(0.32);
  const [triggered, setTriggered] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [uptime, setUptime] = useState(0);
  const lastTrigger = useRef(Date.now());
  const tRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setUptime((u) => u + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      tRef.current += 1;
      const t = tRef.current;
      const baseDb = 56 + Math.sin(t * 0.18) * 5 + Math.sin(t * 0.07) * 4 + (Math.random() - 0.5) * 6;
      const baseAnom = 22 + Math.sin(t * 0.11) * 8 + (Math.random() - 0.5) * 6;
      const since = (Date.now() - lastTrigger.current) / 1000;
      const wantSpike = since > 14 && Math.random() < 0.07;
      const dbVal = wantSpike ? 88 + Math.random() * 6 : baseDb;
      const anomVal = wantSpike ? 88 + Math.random() * 8 : baseAnom;
      setDb((p) => [...p.slice(1), dbVal]);
      setAnom((p) => [...p.slice(1), anomVal]);
      setCurDb(Math.round(dbVal));
      setCurAnom(+(anomVal / 100).toFixed(2));
      if (wantSpike) {
        lastTrigger.current = Date.now();
        fireTrigger();
      }
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setSpectralFlux(+(0.1 + Math.random() * 0.7).toFixed(2));
      setVoices(1 + Math.floor(Math.random() * 5));
      setBreath(13 + Math.floor(Math.random() * 8));
      setPitchVar(+(0.15 + Math.random() * 0.6).toFixed(2));
    }, 500);
    return () => clearInterval(id);
  }, []);

  const fireTrigger = () => {
    setTriggered(true);
    setReasoning(REASONINGS[Math.floor(Math.random() * REASONINGS.length)]);
    setPulse((p) => p + 1);
    setTimeout(() => {
      setTriggered(false);
      setReasoning(null);
    }, 5000);
  };

  const data = useMemo(() => ({
    labels: db.map((_, i) => i),
    datasets: [
      {
        label: "Acoustic dB",
        data: db,
        borderColor: "hsl(171 100% 42%)",
        backgroundColor: "hsla(171, 100%, 42%, 0.1)",
        fill: true,
        pointRadius: 0,
        borderWidth: 1.5,
        tension: 0.35,
      },
      {
        label: "Anomaly score",
        data: anom,
        borderColor: "hsl(258 90% 66%)",
        backgroundColor: "transparent",
        fill: false,
        pointRadius: 0,
        borderWidth: 1.5,
        tension: 0.35,
        borderDash: [],
      },
    ],
  }), [db, anom]);

  const options = useMemo<any>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        display: true, position: "top", align: "end",
        labels: { color: "hsl(215 18% 70%)", font: { family: "JetBrains Mono", size: 10 }, usePointStyle: true, boxWidth: 8 },
      },
      tooltip: { enabled: false },
    },
    scales: {
      x: { grid: { color: "hsla(171, 50%, 50%, 0.04)" }, ticks: { display: false } },
      y: {
        min: 0, max: 100,
        grid: { color: "hsla(171, 50%, 50%, 0.06)" },
        ticks: { color: "hsl(215 18% 60%)", font: { family: "JetBrains Mono", size: 9 }, stepSize: 25 },
      },
    },
  }), []);

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, "0");
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${h}:${m}:${sec}`;
  };

  return (
    <div className="relative h-screen flex flex-col">
      {triggered && (
        <div
          key={pulse}
          className="absolute inset-0 pointer-events-none z-30 animate-radial-pulse"
          style={{
            background: "radial-gradient(circle at center, hsl(var(--danger) / 0.25), transparent 60%)",
          }}
        />
      )}

      <header className="px-8 py-4 border-b border-border flex items-center justify-between bg-surface/40 backdrop-blur-sm z-10">
        <div className="flex items-center gap-5">
          <div className={cn(
            "w-11 h-11 rounded-md grid place-items-center font-semibold border",
            patient.accent === "teal" && "bg-primary/15 text-primary border-primary/40",
            patient.accent === "violet" && "bg-secondary/15 text-secondary border-secondary/40",
            patient.accent === "coral" && "bg-danger/15 text-danger border-danger/40",
          )}>
            {patient.initials}
          </div>
          <div>
            <div className="label-tiny">Patient</div>
            <div className="text-base font-semibold">{patient.name}</div>
          </div>
          <div className="h-10 w-px bg-border" />
          <div>
            <div className="label-tiny">Active profile</div>
            <div className="text-base font-medium text-primary mono">{profile.name}</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className={cn(
            "px-3 py-1.5 rounded-md mono text-xs font-bold tracking-widest border flex items-center gap-2",
            triggered ? "bg-danger/15 border-danger text-danger animate-pulse-danger" : "bg-primary/10 border-primary/50 text-primary",
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full", triggered ? "bg-danger" : "bg-primary animate-pulse-dot")} />
            {triggered ? "TRIGGERED" : "MONITORING"}
          </div>
          <div className="text-right">
            <div className="label-tiny">Sentinel uptime</div>
            <div className="mono text-sm tabular-nums">{fmtUptime(uptime)}</div>
          </div>
        </div>
      </header>

      <section className="flex-1 px-8 py-6 min-h-0">
        <div className="panel p-5 h-full flex flex-col scanlines">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <div className="label-tiny">Live acoustic + anomaly stream</div>
            </div>
            <div className="flex items-center gap-4 mono text-[10px]">
              <span className="flex items-center gap-1.5 text-safe"><span className="w-3 h-px bg-safe" /> SAFE 60</span>
              <span className="flex items-center gap-1.5 text-warning"><span className="w-3 h-px bg-warning" /> WARN 75</span>
              <span className="flex items-center gap-1.5 text-danger"><span className="w-3 h-px bg-danger" /> DANGER 85</span>
            </div>
          </div>
          <div className="relative flex-1 min-h-0">
            <Line data={data} options={options} />
            {[
              { v: 60, color: "hsl(158 75% 50%)" },
              { v: 75, color: "hsl(38 92% 50%)" },
              { v: 85, color: "hsl(0 100% 71%)" },
            ].map(({ v, color }) => (
              <div
                key={v}
                className="absolute left-0 right-0 pointer-events-none"
                style={{
                  top: `${((100 - v) / 100) * 88 + 6}%`,
                  borderTop: `1px dashed ${color}`,
                  opacity: 0.5,
                }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="px-8 pb-6 grid grid-cols-6 gap-3">
        <Stat label="Current dB" value={curDb} unit="dB" warn={curDb > 75} />
        <Stat label="Anomaly score" value={curAnom} unit="" decimals={2} warn={curAnom > 0.7} danger={curAnom > 0.85} />
        <Stat label="Spectral flux" value={spectralFlux} unit="Δ" decimals={2} />
        <Stat label="Voice count" value={voices} unit="voices" />
        <Stat label="Breath rate" value={breath} unit="/min" />
        <Stat label="Pitch variance" value={pitchVar} unit="σ" decimals={2} />
      </section>

      {triggered && reasoning && (
        <div className="absolute left-0 right-0 bottom-0 z-40 px-8 pb-6 animate-slide-up" style={{ height: 300 }}>
          <div className="panel border-danger/50 glow-danger p-6 bg-card/95 backdrop-blur-md h-full flex flex-col">
            <div className="flex items-start gap-4 flex-1">
              <div className="w-12 h-12 rounded-md bg-danger/15 border border-danger grid place-items-center animate-pulse-danger">
                <Activity className="w-6 h-6 text-danger" />
              </div>
              <div className="flex-1 flex flex-col">
                <div className="flex items-center gap-3 mb-2">
                  <div className="mono text-[11px] tracking-[0.2em] text-danger font-bold">INTERVENTION TRIGGERED</div>
                  <div className="mono text-[10px] text-muted-foreground">gemma-4 · 142ms</div>
                </div>
                <p className="italic mono text-sm leading-relaxed text-foreground flex-1">
                  "{reasoning}"
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="label-tiny text-primary">Ember speaking</div>
                  <div className="flex items-end gap-1 h-5">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-1 bg-primary rounded-full origin-bottom animate-speak-bar"
                        style={{ height: "100%", animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => { setTriggered(false); setReasoning(null); }}
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

const Stat = ({
  label, value, unit, decimals = 0, warn = false, danger = false,
}: { label: string; value: number; unit: string; decimals?: number; warn?: boolean; danger?: boolean }) => (
  <div className={cn(
    "panel p-4 transition-colors",
    danger && "border-danger/60",
    warn && !danger && "border-warning/60",
  )}>
    <div className="label-tiny">{label}</div>
    <div className="mt-2 flex items-baseline gap-1.5">
      <CountUp
        value={value}
        decimals={decimals}
        duration={200}
        className={cn(
          "mono text-2xl font-bold tabular-nums",
          danger ? "text-danger text-glow-danger" : warn ? "text-warning" : "text-primary text-glow-teal",
        )}
      />
      {unit && <span className="mono text-[10px] text-muted-foreground">{unit}</span>}
    </div>
  </div>
);

export default PatientMonitor;
