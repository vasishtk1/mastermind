import { useEffect, useMemo, useState } from "react";
import { Brain, Loader2, Save, Rocket, Waves, Activity, TrendingUp, Wind, Crosshair, Zap } from "lucide-react";
import { Radar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip as CTooltip,
  Legend,
} from "chart.js";
import { PATIENTS, PROFILES, FEATURE_EXPLAINERS } from "@/lib/ember-mock";
import type { Profile, TriggerCategory } from "@/lib/ember-types";
import { cn } from "@/lib/utils";

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, CTooltip, Legend);

const CATEGORIES: TriggerCategory[] = [
  "Auditory overstimulation",
  "Social crowding",
  "Sudden acoustic shock",
  "Sustained low-frequency stress",
  "Mixed environment",
  "Custom",
];

const STATUS_MSGS = [
  "Parsing clinical language...",
  "Extracting acoustic parameters...",
  "Fitting anomaly model...",
  "Calibrating MFCC thresholds...",
];

const ICONS: Record<string, any> = { Waves, Activity, TrendingUp, Wind, Crosshair, Zap };

const ResearcherIDE = () => {
  const [text, setText] = useState("");
  const [patientId, setPatientId] = useState(PATIENTS[0].id);
  const [category, setCategory] = useState<TriggerCategory>("Auditory overstimulation");
  const [loading, setLoading] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const [generated, setGenerated] = useState<Profile | null>(null);

  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setStatusIdx((i) => (i + 1) % STATUS_MSGS.length), 600);
    return () => clearInterval(id);
  }, [loading]);

  const handleGenerate = () => {
    setLoading(true);
    setStatusIdx(0);
    setGenerated(null);
    setTimeout(() => {
      const seed = PROFILES[Math.floor(Math.random() * PROFILES.length)];
      const newProf: Profile = {
        ...seed,
        id: `prof-gen-${Date.now()}`,
        patient_id: patientId,
        trigger_category: category,
        description: text || seed.description,
        name: `${category.split(" ")[0].toUpperCase().slice(0, 4)}-GEN-${String(Math.floor(Math.random() * 900) + 100)}`,
        active: false,
        updated_at: new Date().toISOString(),
      };
      setGenerated(newProf);
      setLoading(false);
    }, 2500);
  };

  const radarData = useMemo(() => {
    const labels = ["Spectral Flux", "MFCC Deviation", "Pitch Escalation", "Breath Rate", "Spectral Centroid", "ZCR Density"];
    const safe = generated?.safe_radar ?? PROFILES[0].safe_radar;
    const danger = generated?.danger_radar ?? PROFILES[0].danger_radar;
    const toArr = (r: any) => [r.spectral_flux, r.mfcc_deviation, r.pitch_escalation, r.breath_rate, r.spectral_centroid, r.zcr_density];
    return {
      labels,
      datasets: [
        {
          label: "Safe baseline",
          data: toArr(safe),
          borderColor: "hsl(171 100% 42%)",
          backgroundColor: "hsla(171, 100%, 42%, 0.18)",
          borderWidth: 1.5,
          pointBackgroundColor: "hsl(171 100% 42%)",
          pointRadius: 3,
        },
        {
          label: "Danger profile",
          data: toArr(danger),
          borderColor: "hsl(0 100% 71%)",
          backgroundColor: "hsla(0, 100%, 71%, 0.18)",
          borderWidth: 1.5,
          pointBackgroundColor: "hsl(0 100% 71%)",
          pointRadius: 3,
        },
      ],
    };
  }, [generated]);

  const radarOptions = useMemo<any>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top",
        labels: { color: "hsl(200 30% 92%)", font: { family: "Inter", size: 11 }, usePointStyle: true, boxWidth: 8 },
      },
      tooltip: { enabled: false },
    },
    scales: {
      r: {
        min: 0,
        max: 100,
        angleLines: { color: "hsla(171, 100%, 42%, 0.12)" },
        grid: { color: "hsla(171, 100%, 42%, 0.1)" },
        pointLabels: { color: "hsl(215 18% 70%)", font: { family: "JetBrains Mono", size: 10 } },
        ticks: { display: false, stepSize: 25 },
      },
    },
  }), []);

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Left column */}
      <div className="w-[420px] shrink-0 border-r border-border overflow-y-auto p-6 space-y-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">New clinical observation</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Describe what you observe about this patient's triggers in natural language.
          </p>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Patient shows elevated distress in environments with multiple overlapping voices, particularly when unable to identify an exit. History of combat PTSD. Crowded transit seems to be a primary trigger."
          className="w-full min-h-[140px] bg-input border border-border rounded-md p-3 text-sm font-sans focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 resize-y placeholder:text-muted-foreground/60"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="label-tiny mb-1.5">Patient</div>
            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
            >
              {PATIENTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <div className="label-tiny mb-1.5">Trigger category</div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TriggerCategory)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full bg-primary text-primary-foreground hover:bg-primary-glow transition-colors rounded-md py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-70 glow-teal"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
          {loading ? STATUS_MSGS[statusIdx] : "Generate neuroscience profile"}
        </button>

        {loading && (
          <div className="flex justify-center py-6">
            <div className="relative w-16 h-16 grid place-items-center">
              <span className="absolute inset-0 rounded-full border border-primary/40 animate-pulse-ring" />
              <span className="absolute inset-0 rounded-full border border-primary/40 animate-pulse-ring" style={{ animationDelay: "0.6s" }} />
              <Brain className="w-6 h-6 text-primary" />
            </div>
          </div>
        )}

        {generated && <GeneratedCard profile={generated} onChange={setGenerated} />}
      </div>

      {/* Right column */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Neuroscience signal breakdown</h2>
            <p className="text-xs text-muted-foreground mt-1">Six-axis comparison of safe baseline vs. generated danger profile.</p>
          </div>
          <div className="label-tiny">{generated ? generated.name : "Showing reference profile"}</div>
        </div>

        <div className="panel p-5 mb-5" style={{ height: 460 }}>
          <Radar data={radarData} options={radarOptions} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {FEATURE_EXPLAINERS.map((f) => {
            const Icon = ICONS[f.icon];
            return (
              <div key={f.key} className="bg-card border border-border rounded-md p-4 border-l-2 border-l-primary/70">
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className="w-4 h-4 text-primary" />
                  <div className="text-sm font-semibold">{f.name}</div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const GeneratedCard = ({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) => {
  const m = profile.metrics;
  const chips = [
    { label: "Spectral flux thresh.", value: m.spectral_flux_threshold.toFixed(2) },
    { label: "MFCC anomaly", value: m.mfcc_anomaly_score.toFixed(2) },
    { label: "Spectral centroid", value: `${m.spectral_centroid} Hz` },
    { label: "ZCR baseline", value: m.zcr_baseline.toFixed(2) },
    { label: "Breath rate ceil.", value: `${m.breath_rate_ceiling}/min` },
    { label: "Pitch variance max", value: `${m.pitch_variance_max} Hz` },
  ];
  return (
    <div className="panel p-4 animate-fade-in space-y-3">
      <div className="flex items-center justify-between">
        <div className="mono text-sm font-bold text-primary text-glow-teal">{profile.name}</div>
        <span className="mono text-[10px] tracking-widest px-2 py-1 rounded-sm bg-primary/15 text-primary border border-primary/40">
          {profile.trigger_category.toUpperCase()}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {chips.map((c) => (
          <div key={c.label} className="bg-input/60 border border-border rounded-sm px-2.5 py-2">
            <div className="label-tiny">{c.label}</div>
            <div className="mono text-sm font-semibold text-foreground mt-0.5">{c.value}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="flex items-center justify-between label-tiny mb-1.5">
          <span>Anomaly sensitivity</span>
          <span className="mono text-primary">{m.anomaly_sensitivity.toFixed(2)}</span>
        </div>
        <input
          type="range" min={0} max={1} step={0.01}
          value={m.anomaly_sensitivity}
          onChange={(e) => onChange({ ...profile, metrics: { ...m, anomaly_sensitivity: +e.target.value } })}
          className="w-full accent-primary"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button className="bg-surface-elevated border border-border hover:border-primary/60 text-sm rounded-md py-2 flex items-center justify-center gap-2 transition-colors">
          <Save className="w-3.5 h-3.5" /> Save to patient
        </button>
        <button className="bg-primary text-primary-foreground hover:bg-primary-glow text-sm rounded-md py-2 flex items-center justify-center gap-2 font-semibold transition-colors">
          <Rocket className="w-3.5 h-3.5" /> Deploy to sentinel
        </button>
      </div>
    </div>
  );
};

export default ResearcherIDE;
