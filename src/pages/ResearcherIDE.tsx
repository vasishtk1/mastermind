import { useEffect, useState } from "react";
import { Activity, Brain, Crosshair, Loader2, Rocket, Save, TrendingUp, Waves, Wind, Zap } from "lucide-react";
import { PROFILES, FEATURE_EXPLAINERS } from "@/lib/ember-mock";
import type { Profile, RadarMetrics, TriggerCategory } from "@/lib/ember-types";
import { useEmberData } from "@/context/EmberClinicalContext";
import { cn } from "@/lib/utils";

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
const RADAR_KEYS: Array<keyof RadarMetrics> = [
  "spectral_flux",
  "mfcc_deviation",
  "pitch_escalation",
  "breath_rate",
  "spectral_centroid",
  "zcr_density",
];

const toArray = (r: RadarMetrics) => RADAR_KEYS.map((k) => r[k]);
const fmtDelta = (delta: number) => `${delta >= 0 ? "+" : ""}${Math.round(delta)}`;

const ResearcherIDE = () => {
  const { patients } = useEmberData();
  const [text, setText] = useState("");
  const [patientId, setPatientId] = useState(() => patients[0]?.id ?? "");

  useEffect(() => {
    if (patients.length === 0) return;
    setPatientId((id) => (patients.some((p) => p.id === id) ? id : patients[0].id));
  }, [patients]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>(CATEGORIES);
  const [category, setCategory] = useState<string>("Auditory overstimulation");
  const [customCategory, setCustomCategory] = useState("");
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
      const triggerCategory = CATEGORIES.includes(category as TriggerCategory)
        ? (category as TriggerCategory)
        : "Custom";
      const newProf: Profile = {
        ...seed,
        id: `prof-gen-${Date.now()}`,
        patient_id: patientId,
        trigger_category: triggerCategory,
        description: text || (triggerCategory === "Custom" ? `Custom trigger category: ${category}.` : seed.description),
        name: `${category.split(" ")[0].toUpperCase().slice(0, 4)}-GEN-${String(Math.floor(Math.random() * 900) + 100)}`,
        active: false,
        updated_at: new Date().toISOString(),
      };
      setGenerated(newProf);
      setLoading(false);
    }, 2500);
  };

  const addCustomCategory = () => {
    const value = customCategory.trim();
    if (!value) return;
    if (!categoryOptions.some((option) => option.toLowerCase() === value.toLowerCase())) {
      setCategoryOptions((prev) => [...prev.filter((v) => v !== "Custom"), value, "Custom"]);
    }
    setCategory(value);
    setCustomCategory("");
  };

  const safeRadar = generated?.safe_radar ?? PROFILES[0].safe_radar;
  const dangerRadar = generated?.danger_radar ?? PROFILES[0].danger_radar;
  const isReference = !generated;

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      <div className="basis-[30%] max-w-[460px] min-w-[360px] shrink-0 border-r border-border overflow-y-auto p-7 space-y-5 bg-card">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">New clinical observation</h1>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Describe what you observe about this patient's triggers in natural language.
          </p>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Patient exhibits rising distress with overlapping voices and constrained exits. Prosody instability increases during transit crowd density."
          className="w-full min-h-[150px] bg-[#16181A] border border-border rounded-md p-3 text-sm font-sans focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40 resize-y placeholder:text-[#798293]"
        />

        <div className="space-y-3">
          <div>
            <div className="label-tiny mb-1.5">Patient</div>
            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
            >
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="label-tiny mb-1.5">Trigger category</div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2.5 pr-9 text-sm leading-6 focus:outline-none focus:border-primary"
              title={category}
            >
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {category === "Custom" && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomCategory();
                    }
                  }}
                  placeholder="Add custom trigger name"
                  className="flex-1 bg-[#16181A] border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={addCustomCategory}
                  className="px-3 py-2 rounded-md text-xs font-semibold text-[#1B1D20]"
                  style={{ background: "linear-gradient(120deg, #E27533 0%, #D6975A 100%)" }}
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full rounded-md py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-70 text-[#1B1D20] transition-all"
          style={{
            background: "linear-gradient(120deg, #E27533 0%, #D6975A 100%)",
            boxShadow: "0 0 18px rgba(226,117,51,0.28)",
          }}
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

      <div className="basis-[70%] flex-1 overflow-y-auto p-7 bg-background">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Neuroscience signal breakdown</h2>
            <p className="text-xs text-muted-foreground mt-1">Six-axis comparison of safe baseline vs. generated danger profile.</p>
          </div>
          <div className="px-2.5 py-1 rounded border border-border bg-card">
            <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
              {isReference ? "Showing reference profile" : `Showing ${generated.name}`}
            </div>
          </div>
        </div>

        <div className="panel p-5 mb-5" style={{ height: 470 }}>
          <AcousticThresholdRadar safeValues={toArray(safeRadar)} dangerValues={toArray(dangerRadar)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {FEATURE_EXPLAINERS.map((f, idx) => {
            const Icon = ICONS[f.icon];
            const safeValue = toArray(safeRadar)[idx];
            const dangerValue = toArray(dangerRadar)[idx];
            return (
              <MetricCard
                key={f.key}
                icon={Icon}
                name={f.name}
                description={f.desc}
                safeValue={safeValue}
                dangerValue={dangerValue}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

const AcousticThresholdRadar = ({ safeValues, dangerValues }: { safeValues: number[]; dangerValues: number[] }) => {
  const size = 520;
  const center = size / 2;
  const maxRadius = 188;
  const labels = ["Spectral Flux", "MFCC Deviation", "Pitch Escalation", "Breath Rate", "Spectral Centroid", "ZCR Density"];
  const ringRatios = [0.33, 0.66, 1];
  const ringLabels = ["Baseline", "Elevated", "Critical"];

  const pointFor = (index: number, valueRatio: number) => {
    const angle = (-Math.PI / 2) + (index * (2 * Math.PI) / 6);
    const r = maxRadius * valueRatio;
    return {
      x: center + (Math.cos(angle) * r),
      y: center + (Math.sin(angle) * r),
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
    <div className="h-full w-full flex items-center justify-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
        <defs>
          <radialGradient id="emberDangerFill" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor="#E27533" stopOpacity="0.06" />
            <stop offset="70%" stopColor="#E27533" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#D6975A" stopOpacity="0.32" />
          </radialGradient>
          <filter id="emberGlow">
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
        <polygon points={dangerPolygon} fill="url(#emberDangerFill)" stroke="#E27533" strokeWidth={2.2} filter="url(#emberGlow)" />

        {dangerValues.map((value, idx) => {
          const p = pointFor(idx, Math.min(1, Math.max(0, value / 100)));
          return <circle key={idx} cx={p.x} cy={p.y} r={4.6} fill="#E27533" filter="url(#emberGlow)" />;
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
            <text
              key={ringLabels[idx]}
              x={p.x + 8}
              y={p.y - 8}
              fill="#8A95A5"
              fontSize="10"
              fontFamily="Inter, sans-serif"
            >
              {ringLabels[idx]}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

const MetricCard = ({
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
    <div className="bg-card border border-border rounded-md p-4">
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
        <div className="mono text-[10px] text-muted-foreground mt-1">Delta magnitude: {Math.round(deltaMagnitude)}</div>
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
        <div className="mono text-sm font-bold text-primary">{profile.name}</div>
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
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={m.anomaly_sensitivity}
          onChange={(e) => onChange({ ...profile, metrics: { ...m, anomaly_sensitivity: +e.target.value } })}
          className="w-full accent-primary"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button className="bg-surface-elevated border border-border hover:border-primary/60 text-sm rounded-md py-2 flex items-center justify-center gap-2 transition-colors">
          <Save className="w-3.5 h-3.5" /> Save to patient
        </button>
        <button
          className="text-sm rounded-md py-2 flex items-center justify-center gap-2 font-semibold transition-colors text-[#1B1D20]"
          style={{ background: "linear-gradient(120deg, #E27533 0%, #D6975A 100%)" }}
        >
          <Rocket className="w-3.5 h-3.5" /> Deploy to sentinel
        </button>
      </div>
    </div>
  );
};

export default ResearcherIDE;
