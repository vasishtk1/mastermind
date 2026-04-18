import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Mic, Loader2, Check } from "lucide-react";
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
import { fetchProfiles, generateBaseline, activateProfile } from "@/lib/ember-api";
import type { Profile } from "@/lib/ember-types";
import { CountUp } from "@/components/ember/CountUp";
import { cn } from "@/lib/utils";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, CTooltip, Legend);

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const SAMPLE_TRANSCRIPT =
  "Patient becomes overwhelmed in the cafeteria when multiple voices overlap above 70 decibels for more than 10 seconds. Onset is rapid, recovery requires a quiet environment.";

const ResearcherIDE = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [generating, setGenerating] = useState(false);
  const [baseline, setBaseline] = useState<Profile | null>(null);
  const [threshold, setThreshold] = useState(72);
  const [deployed, setDeployed] = useState(false);

  useEffect(() => {
    fetchProfiles().then((p) => {
      setProfiles(p);
      setSelectedId(p[0]?.id ?? null);
      setBaseline(p[0] ?? null);
      if (p[0]?.metrics) setThreshold(p[0].metrics.db_threshold);
    });
  }, []);

  const filtered = useMemo(
    () => profiles.filter((p) => p.trigger_type.toLowerCase().includes(search.toLowerCase())),
    [profiles, search],
  );

  const selectProfile = (p: Profile) => {
    setSelectedId(p.id);
    setBaseline(p);
    setDeployed(false);
    if (p.metrics) setThreshold(p.metrics.db_threshold);
  };

  const handleRecord = () => {
    if (recording) {
      setRecording(false);
      return;
    }
    setRecording(true);
    setTranscript("");
    // simulate streaming transcription
    let i = 0;
    const id = setInterval(() => {
      i += 3;
      setTranscript(SAMPLE_TRANSCRIPT.slice(0, i));
      if (i >= SAMPLE_TRANSCRIPT.length) {
        clearInterval(id);
        setRecording(false);
      }
    }, 40);
  };

  const handleGenerate = async () => {
    if (!transcript.trim()) return;
    setGenerating(true);
    setDeployed(false);
    const p = await generateBaseline(transcript);
    setBaseline(p);
    if (p.metrics) setThreshold(p.metrics.db_threshold);
    setProfiles((prev) => [p, ...prev]);
    setSelectedId(p.id);
    setGenerating(false);
  };

  const handleDeploy = async () => {
    if (!baseline) return;
    await activateProfile(baseline.id);
    setProfiles((prev) =>
      prev.map((p) => ({ ...p, active: p.id === baseline.id ? true : p.active })),
    );
    setDeployed(true);
  };

  // Distribution chart data
  const chartData = useMemo(() => {
    const labels = Array.from({ length: 60 }, (_, i) => i);
    const gauss = (mu: number, sigma: number) => (x: number) =>
      Math.exp(-Math.pow(x - mu, 2) / (2 * sigma * sigma));
    const safe = labels.map((x) => gauss(22, 8)(x) * 100);
    const danger = labels.map((x) => gauss(44, 9)(x) * 100);
    return {
      labels,
      datasets: [
        {
          label: "Safe",
          data: safe,
          borderColor: "hsl(174 84% 52%)",
          backgroundColor: "hsla(174, 84%, 52%, 0.18)",
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: "Danger",
          data: danger,
          borderColor: "hsl(0 100% 71%)",
          backgroundColor: "hsla(0, 100%, 71%, 0.16)",
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    };
  }, []);

  const chartOptions = useMemo<any>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          grid: { color: "hsla(174, 50%, 50%, 0.06)" },
          ticks: { color: "hsl(215 18% 60%)", font: { family: "JetBrains Mono", size: 9 }, maxTicksLimit: 6 },
          title: { display: true, text: "Acoustic load", color: "hsl(215 18% 60%)", font: { size: 10 } },
        },
        y: {
          grid: { color: "hsla(174, 50%, 50%, 0.06)" },
          ticks: { color: "hsl(215 18% 60%)", font: { family: "JetBrains Mono", size: 9 } },
          title: { display: true, text: "Frequency", color: "hsl(215 18% 60%)", font: { size: 10 } },
        },
      },
    }),
    [],
  );

  return (
    <div className="flex h-screen">
      {/* LEFT — Profile library */}
      <section className="w-[240px] shrink-0 bg-surface/80 border-r border-border/60 flex flex-col">
        <div className="p-4 border-b border-border/60">
          <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground mb-2">PROFILE LIBRARY</div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search profiles"
              className="w-full bg-input/60 border border-border rounded-md pl-8 pr-2 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProfile(p)}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded-md transition-all border",
                selectedId === p.id
                  ? "bg-primary/10 border-primary/40"
                  : "border-transparent hover:bg-surface-elevated",
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full",
                    p.active ? "bg-primary animate-pulse-dot" : "bg-muted-foreground/40",
                  )}
                />
                <span className="text-[13px] font-medium truncate">{p.trigger_type}</span>
              </div>
              <div className="mono text-[10px] text-muted-foreground pl-4">{fmtTime(p.updated_at)}</div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-border/60">
          <button
            onClick={() => {
              setBaseline(null);
              setTranscript("");
              setSelectedId(null);
              setDeployed(false);
            }}
            className="w-full flex items-center justify-center gap-2 bg-primary/15 border border-primary/50 text-primary rounded-md py-2 text-sm font-medium hover:bg-primary/25 hover:glow-teal transition-all"
          >
            <Plus className="w-4 h-4" /> New profile
          </button>
        </div>
      </section>

      {/* CENTER — Generator */}
      <section className="flex-1 min-w-0 overflow-y-auto">
        <header className="px-8 py-5 border-b border-border/60 flex items-center justify-between">
          <div>
            <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground">RESEARCHER IDE</div>
            <h1 className="text-xl font-semibold mt-0.5">Profile Generator</h1>
          </div>
          <div className="mono text-[11px] text-muted-foreground flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-dot" />
            backend: localhost:8000
          </div>
        </header>

        <div className="px-8 py-10 max-w-[760px] mx-auto">
          {/* Mic */}
          <div className="flex flex-col items-center">
            <div className="relative w-40 h-40 grid place-items-center">
              {recording && (
                <>
                  <span className="absolute inset-0 rounded-full border-2 border-primary/60 animate-pulse-ring" />
                  <span
                    className="absolute inset-0 rounded-full border-2 border-primary/40 animate-pulse-ring"
                    style={{ animationDelay: "0.6s" }}
                  />
                  <span
                    className="absolute inset-0 rounded-full border border-primary/20 animate-pulse-ring"
                    style={{ animationDelay: "1.2s" }}
                  />
                </>
              )}
              <button
                onClick={handleRecord}
                className={cn(
                  "relative w-28 h-28 rounded-full grid place-items-center transition-all border",
                  recording
                    ? "bg-primary text-primary-foreground border-primary glow-teal"
                    : "bg-surface-elevated border-primary/40 text-primary hover:bg-primary/10 hover:glow-teal",
                )}
              >
                <Mic className="w-9 h-9" />
              </button>
            </div>
            <div className="mt-4 mono text-xs tracking-widest text-muted-foreground">
              {recording ? "LISTENING…" : "DESCRIBE THE TRIGGER SCENARIO"}
            </div>
          </div>

          {/* Transcript */}
          <div className="mt-8">
            <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground mb-2">TRANSCRIPT</div>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={4}
              placeholder="Voice transcript will appear here…"
              className="w-full bg-input/40 border border-border rounded-lg p-4 text-sm leading-relaxed mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60 resize-none"
            />
          </div>

          {/* Generate button */}
          <div className="mt-6 flex justify-center">
            <button
              onClick={handleGenerate}
              disabled={!transcript.trim() || generating}
              className={cn(
                "inline-flex items-center gap-2 px-6 py-2.5 rounded-md border text-sm font-medium transition-all",
                generating
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "bg-primary/15 border-primary/60 text-primary hover:bg-primary/25 hover:glow-teal disabled:opacity-40 disabled:hover:bg-primary/15 disabled:hover:shadow-none",
              )}
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin-slow" /> : null}
              {generating ? "Generating baseline…" : "Generate baseline"}
            </button>
          </div>

          {/* Metrics */}
          {baseline?.metrics && (
            <div className="mt-10 grid grid-cols-4 gap-3 animate-fade-in">
              <MetricTile label="dB threshold" value={baseline.metrics.db_threshold} unit="dB" />
              <MetricTile label="Voice overlap" value={baseline.metrics.voice_overlap} unit="voices" />
              <MetricTile
                label="Freq variance"
                value={baseline.metrics.freq_variance}
                unit="σ"
                decimals={2}
              />
              <MetricTile label="Safe window" value={baseline.metrics.safe_window} unit="sec" />
            </div>
          )}
        </div>
      </section>

      {/* RIGHT — Distribution */}
      <section className="w-[320px] shrink-0 bg-surface/60 border-l border-border/60 flex flex-col">
        <div className="px-5 py-5 border-b border-border/60">
          <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground">DISTRIBUTION</div>
          <h2 className="text-base font-semibold mt-0.5">Acoustic envelope</h2>
        </div>

        <div className="p-5 flex-1 flex flex-col">
          <div className="relative h-[240px] panel p-3">
            <Line data={chartData} options={chartOptions} />
            {/* Threshold line */}
            <div
              className="absolute top-3 bottom-8 pointer-events-none"
              style={{ left: `calc(${(threshold / 100) * 100}% )` }}
            >
              <div className="w-px h-full bg-warning shadow-[0_0_10px_hsl(var(--warning))]" />
              <div className="absolute -top-1 -translate-x-1/2 w-3 h-3 rounded-full bg-warning glow-violet" />
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mono text-[10px] text-muted-foreground mb-1">
              <span>THRESHOLD</span>
              <span className="text-warning">{threshold} dB</span>
            </div>
            <input
              type="range"
              min={40}
              max={95}
              value={threshold}
              onChange={(e) => setThreshold(+e.target.value)}
              className="w-full accent-warning"
            />
          </div>

          <div className="mt-5 flex items-center gap-4 mono text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-primary rounded-sm" /> SAFE</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-destructive rounded-sm" /> DANGER</span>
          </div>

          <button
            onClick={handleDeploy}
            disabled={!baseline}
            className={cn(
              "mt-auto w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-semibold transition-all",
              deployed
                ? "bg-primary text-primary-foreground glow-teal"
                : "bg-primary text-primary-foreground hover:glow-teal disabled:opacity-30",
            )}
          >
            {deployed ? (
              <>
                <Check className="w-4 h-4 animate-fade-in" /> Deployed to Patient A
              </>
            ) : (
              <>Deploy to Patient A</>
            )}
          </button>
        </div>
      </section>
    </div>
  );
};

const MetricTile = ({
  label,
  value,
  unit,
  decimals = 0,
}: { label: string; value: number; unit: string; decimals?: number }) => (
  <div className="panel p-4 hover:border-primary/40 transition-colors">
    <div className="mono text-[9px] tracking-[0.18em] text-muted-foreground uppercase">{label}</div>
    <div className="mt-2 flex items-baseline gap-1.5">
      <CountUp
        value={value}
        decimals={decimals}
        className="mono text-2xl font-bold text-primary text-glow-teal tabular-nums"
      />
      <span className="mono text-[10px] text-muted-foreground">{unit}</span>
    </div>
  </div>
);

export default ResearcherIDE;
