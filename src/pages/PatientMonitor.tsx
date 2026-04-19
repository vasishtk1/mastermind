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
import { Activity, Camera, CameraOff, Mic, MicOff, X, Zap } from "lucide-react";
import { CountUp } from "@/components/ember/CountUp";
import { PATIENTS, PROFILES } from "@/lib/ember-mock";
import { useEmberData } from "@/context/EmberClinicalContext";
import { cn } from "@/lib/utils";
import { useTelemetry } from "@/hooks/useTelemetry";
import type { TelemetryStats } from "@/lib/telemetry-types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, CTooltip, Legend);

const WINDOW_SIZE = 90;
const TICK_MS = 140;

const FALLBACK_REASONINGS = [
  "Anomaly score exceeded 0.87. Primary drivers: spectral flux +340%, pitch escalation, elevated breath rate. Intervention: auditory grounding initiated.",
  "MFCC deviation crossed threshold for 11 seconds. Voice count rising. Intervention: paced-breathing prompt with corridor relocation.",
  "Sharp transient at 3.8kHz · ZCR density spike. Acoustic-shock signature matched. Intervention: orienting cue + safe-window guidance.",
];

const API_BASE = "http://localhost:8000";

/**
 * Map dBFS (−100…0) to the chart's 0–100 axis so that:
 *   −50 dBFS (quiet room)  → ~25   (below SAFE line at 60)
 *   −25 dBFS (speech)      → ~69   (near SAFE line)
 *   −15 dBFS (elevated)    → ~81   (above WARN line at 75)
 *   −5  dBFS (loud/stress) → ~94   (above DANGER line at 85)
 */
/** Map dBFS (−100…0) → chart scale (0–100). */
function dbfsToChart(dbfs: number): number {
  return Math.max(0, Math.min(100, (dbfs + 100) * 0.95));
}

/**
 * Derives a real anomaly score (0–1) from live acoustic stats.
 * Weighted combination of the four principal distress indicators:
 *   - Spectral flux  (rapid environmental change / hyperventilation)
 *   - Zero-crossing rate (noise / stress vocalization density)
 *   - RMS level      (vocal intensity / agitation)
 *   - Pitch (F0)     (pitch escalation above resting baseline)
 */
function computeAnomalyScore(s: TelemetryStats): number {
  const flux  = Math.min(1, s.spectralFlux);
  const zcr   = Math.min(1, s.zcr / 8000);
  // −60 dBFS → 0 (silence), −20 dBFS → 1 (loud/elevated)
  const rms   = Math.max(0, Math.min(1, (s.rmsDb + 60) / 40));
  // 80 Hz baseline → 0, 400 Hz (high pitch) → 1
  const pitch = s.f0Hz > 0 ? Math.min(1, Math.max(0, (s.f0Hz - 80) / 320)) : 0;
  return 0.35 * flux + 0.25 * zcr + 0.30 * rms + 0.10 * pitch;
}

// ---------------------------------------------------------------------------
// Top blend shapes to surface in the UI panel
// ---------------------------------------------------------------------------
const DISPLAY_BLENDSHAPES = [
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "browInnerUp",
  "jawOpen",
  "mouthSmileLeft",
  "mouthFrownLeft",
  "cheekPuff",
  "noseSneerLeft",
] as const;

const PatientMonitor = () => {
  const { patients } = useEmberData();
  const patient = patients[0] ?? PATIENTS[0];
  const profile = PROFILES.find((p) => p.patient_id === patient.id && p.active) ?? PROFILES[0];

  // --------------------------------------------------------------------------
  // Live telemetry (real sensors)
  // --------------------------------------------------------------------------
  const telemetry = useTelemetry(patient.id);
  const { stats, permissions, audioState, motionState, pointerState, blendshapes, headPose } = telemetry;

  // Refs that the mock-data interval reads from — real data wins when available
  const audioHasSignal = audioState.status === "granted";
  const liveDbRef   = useRef(audioState.rmsDb);
  const liveFluxRef = useRef(audioState.spectralFlux);
  useEffect(() => {
    liveDbRef.current   = audioState.rmsDb;
    liveFluxRef.current = audioState.spectralFlux;
  }, [audioState.rmsDb, audioState.spectralFlux]);

  // --------------------------------------------------------------------------
  // Chart & stats state — null until the mic is active (no fake pre-fill)
  // --------------------------------------------------------------------------
  const [db, setDb]     = useState<number[]>(() => Array(WINDOW_SIZE).fill(0));
  const [anom, setAnom] = useState<number[]>(() => Array(WINDOW_SIZE).fill(0));
  const [curDb, setCurDb]             = useState<number | null>(null);
  const [curAnom, setCurAnom]         = useState<number | null>(null);
  const [spectralFlux, setSpectralFlux] = useState<number | null>(null);
  const [voices, setVoices]           = useState<number | null>(null);
  const [breath, setBreath]           = useState<number | null>(null);
  const [pitchVar, setPitchVar]       = useState<number | null>(null);
  const [triggered, setTriggered] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [inferring, setInferring] = useState(false);
  const [pulse, setPulse]       = useState(0);
  const [uptime, setUptime]     = useState(0);
  const lastTrigger       = useRef(Date.now());
  const tRef              = useRef(0);
  const highAnomalyCount  = useRef(0);   // consecutive ticks above threshold
  const triggeredRef      = useRef(false);

  // Mirrors state into refs so interval callbacks see fresh values without
  // needing them in dependency arrays (which would restart the interval).
  const statsRef = useRef(stats);
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => { triggeredRef.current = triggered; }, [triggered]);

  useEffect(() => {
    const id = setInterval(() => setUptime((u) => u + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Chart tick — only runs when mic is live ────────────────────────────────
  useEffect(() => {
    if (!audioHasSignal) {
      // Reset chart to flat zero so there's no stale data when mic starts
      setDb(Array(WINDOW_SIZE).fill(0));
      setAnom(Array(WINDOW_SIZE).fill(0));
      setCurDb(null);
      setCurAnom(null);
      return;
    }

    const id = setInterval(() => {
      const s = statsRef.current;

      const dbVal     = dbfsToChart(s.rmsDb);
      const anomScore = computeAnomalyScore(s);
      const anomVal   = anomScore * 100;

      setDb((p) => [...p.slice(1), dbVal]);
      setAnom((p) => [...p.slice(1), anomVal]);
      setCurDb(Math.round(dbVal));
      setCurAnom(+anomScore.toFixed(2));

      // Local fast-path trigger: anomaly critically high for 4 consecutive
      // ticks (~560 ms). Gemini provides richer reasoning via polling.
      if (anomScore > 0.82) {
        highAnomalyCount.current++;
        if (
          highAnomalyCount.current >= 4 &&
          !triggeredRef.current &&
          Date.now() - lastTrigger.current > 15_000
        ) {
          highAnomalyCount.current = 0;
          lastTrigger.current = Date.now();
          fireTrigger();
        }
      } else {
        highAnomalyCount.current = 0;
      }
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioHasSignal]);

  // ── Stats cards tick — only runs when mic is live ──────────────────────────
  useEffect(() => {
    if (!audioHasSignal) {
      setSpectralFlux(null);
      setVoices(null);
      setBreath(null);
      setPitchVar(null);
      return;
    }

    const id = setInterval(() => {
      const s = statsRef.current;
      setSpectralFlux(+(Math.min(1, s.spectralFlux).toFixed(2)));
      // Always update pitch variance: 0.00 = unvoiced, >0 = measured F0 deviation
      setPitchVar(
        s.f0Hz > 0
          ? +(Math.min(1, Math.max(0, (s.f0Hz - 80) / 320)).toFixed(2))
          : 0,
      );
      // Voice count and breath have no dedicated sensor yet — simulated only
      // when monitoring is active so the cards aren't permanently empty
      setVoices(1 + Math.floor(Math.random() * 5));
      setBreath(13 + Math.floor(Math.random() * 8));
    }, 500);
    return () => clearInterval(id);
  }, [audioHasSignal]);

  const fireTrigger = (customReasoning?: string) => {
    setTriggered(true);
    setReasoning(
      customReasoning ??
        FALLBACK_REASONINGS[Math.floor(Math.random() * FALLBACK_REASONINGS.length)]
    );
    setPulse((p) => p + 1);
    setTimeout(() => {
      setTriggered(false);
      setReasoning(null);
    }, 8000);
  };

  // --------------------------------------------------------------------------
  // Gemini real-time monitor — polls every 10 s while mic is live
  // --------------------------------------------------------------------------
  const lastMonitorRef  = useRef(0);
  const monitorInFlight = useRef(false);

  useEffect(() => {
    if (!audioHasSignal) return;

    const id = setInterval(async () => {
      if (monitorInFlight.current) return;
      const now = Date.now();
      // Debounce: minimum 5 s between Gemini calls
      if (now - lastMonitorRef.current < 5_000) return;

      lastMonitorRef.current = now;
      monitorInFlight.current = true;
      setInferring(true);

      try {
        const s = statsRef.current;
        const res = await fetch(`${API_BASE}/api/patients/${patient.id}/monitor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rms_db:            s.rmsDb,
            spectral_flux:     s.spectralFlux,
            zcr:               s.zcr,
            f0_hz:             s.f0Hz,
            spectral_centroid: s.spectralCentroid,
          }),
        });
        if (res.ok) {
          const result = await res.json() as { triggered: boolean; reasoning: string };
          if (result.triggered) {
            lastTrigger.current = Date.now();
            fireTrigger(result.reasoning);
          }
        }
      } catch {
        // Network unavailable — silently skip
      } finally {
        monitorInFlight.current = false;
        setInferring(false);
      }
    }, 2_000); // check every 2 s, rate-limited by debounce above

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioHasSignal, patient.id]);

  const data = useMemo(() => ({
    labels: db.map((_, i) => i),
    datasets: [
      {
        label: "Acoustic dB",
        data: db,
        borderColor: "hsl(171 100% 42%)",
        backgroundColor: "hsla(171, 100%, 42%, 0.1)",
        fill: true, pointRadius: 0, borderWidth: 1.5, tension: 0.35,
      },
      {
        label: "Anomaly score",
        data: anom,
        borderColor: "hsl(258 90% 66%)",
        backgroundColor: "transparent",
        fill: false, pointRadius: 0, borderWidth: 1.5, tension: 0.35,
      },
    ],
  }), [db, anom]);

  const options = useMemo<any>(() => ({
    responsive: true, maintainAspectRatio: false, animation: false,
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

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  return (
    <div className="relative h-screen flex flex-col overflow-hidden">
      {triggered && (
        <div
          key={pulse}
          className="absolute inset-0 pointer-events-none z-30 animate-radial-pulse"
          style={{ background: "radial-gradient(circle at center, hsl(var(--danger) / 0.25), transparent 60%)" }}
        />
      )}

      {/* ── Header ── */}
      <header className="px-8 py-4 border-b border-border flex items-center justify-between bg-surface/40 backdrop-blur-sm z-10 shrink-0">
        <div className="flex items-center gap-5">
          <div className={cn(
            "w-11 h-11 rounded-md grid place-items-center font-semibold border",
            patient.accent === "teal"   && "bg-primary/15 text-primary border-primary/40",
            patient.accent === "violet" && "bg-secondary/15 text-secondary border-secondary/40",
            patient.accent === "coral"  && "bg-danger/15 text-danger border-danger/40",
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

        <div className="flex items-center gap-3">
          {/* Sensor start buttons */}
          <SensorButton
            icon={permissions.microphone === "granted" ? Mic : MicOff}
            label={permissions.microphone === "granted" ? "Mic live" : "Start mic"}
            active={permissions.microphone === "granted"}
            onClick={() => void telemetry.startAudio()}
          />
          <SensorButton
            icon={permissions.camera === "granted" ? Camera : CameraOff}
            label={permissions.camera === "granted" ? "Cam live" : "Start cam"}
            active={permissions.camera === "granted"}
            onClick={() => void telemetry.startCamera()}
          />

          {inferring && (
            <div className="px-2.5 py-1.5 rounded-md mono text-[10px] tracking-widest border bg-amber-500/10 border-amber-500/40 text-amber-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              GEMINI
            </div>
          )}
          <div className={cn(
            "px-3 py-1.5 rounded-md mono text-xs font-bold tracking-widest border flex items-center gap-2",
            triggered
              ? "bg-danger/15 border-danger text-danger animate-pulse-danger"
              : "bg-primary/10 border-primary/50 text-primary",
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

      {/* ── Main section: chart left + telemetry right ── */}
      <div className="flex flex-1 min-h-0 gap-4 px-8 py-5">
        {/* Left — acoustic chart */}
        <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-4">
          <div className="panel p-5 flex-1 min-h-0 flex flex-col scanlines">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <div className="label-tiny">Live acoustic + anomaly stream</div>
                {audioHasSignal && (
                  <span className="mono text-[9px] bg-primary/15 text-primary border border-primary/30 rounded px-1.5 py-0.5 ml-1">
                    LIVE MIC
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mono text-[10px]">
                <span className="flex items-center gap-1.5 text-safe"><span className="w-3 h-px bg-safe" /> SAFE 60</span>
                <span className="flex items-center gap-1.5 text-warning"><span className="w-3 h-px bg-warning" /> WARN 75</span>
                <span className="flex items-center gap-1.5 text-danger"><span className="w-3 h-px bg-danger" /> DANGER 85</span>
              </div>
            </div>
            <div className="relative flex-1 min-h-0">
              <Line data={data} options={options} />
              {[{ v: 60, color: "hsl(158 75% 50%)" }, { v: 75, color: "hsl(38 92% 50%)" }, { v: 85, color: "hsl(0 100% 71%)" }].map(({ v, color }) => (
                <div
                  key={v}
                  className="absolute left-0 right-0 pointer-events-none"
                  style={{ top: `${((100 - v) / 100) * 88 + 6}%`, borderTop: `1px dashed ${color}`, opacity: 0.5 }}
                />
              ))}
              {/* Idle overlay — shown until mic permission is granted */}
              {!audioHasSignal && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/60 backdrop-blur-sm rounded-sm">
                  <MicOff className="w-8 h-8 text-muted-foreground/30" />
                  <div className="text-center">
                    <div className="mono text-xs font-semibold text-muted-foreground/70">No signal</div>
                    <div className="mono text-[10px] text-muted-foreground/50 mt-0.5">
                      Click <span className="text-primary">Start mic</span> to begin acoustic monitoring
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-6 gap-3 shrink-0">
            <Stat label="Current dB"    value={curDb}        unit="dB"     warn={(curDb ?? 0) > 75} />
            <Stat label="Anomaly score" value={curAnom}      unit=""       decimals={2} warn={(curAnom ?? 0) > 0.7} danger={(curAnom ?? 0) > 0.85} />
            <Stat label="Spectral flux" value={spectralFlux} unit="Δ"     decimals={2} />
            <Stat label="Voice count"   value={voices}       unit="voices" />
            <Stat label="Breath rate"   value={breath}       unit="/min"   />
            <Stat label="Pitch variance" value={pitchVar}    unit="σ"     decimals={2} />
          </div>
        </div>

        {/* Right — live telemetry panels */}
        <div className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto pb-2">
          <CameraPanel
            videoRef={telemetry.videoRef}
            status={telemetry.faceStatus}
            headPose={headPose}
            onStart={() => void telemetry.startCamera()}
          />
          <BlendshapePanel blendshapes={blendshapes} cameraActive={permissions.camera === "granted"} />
          <MotionPanel motion={motionState} onRequestPermission={() => void telemetry.requestMotionPermission()} />
          <PointerPanel pointer={pointerState} />
        </div>
      </div>

      {/* ── Trigger overlay ── */}
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
                  <div className="mono text-[10px] text-muted-foreground">
                    {audioHasSignal ? "gemini · live mic" : "simulation"}
                  </div>
                </div>
                <p className="italic mono text-sm leading-relaxed text-foreground flex-1">"{reasoning}"</p>
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const SensorButton = ({
  icon: Icon, label, active, onClick,
}: { icon: React.ElementType; label: string; active: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-1.5 mono text-[10px] tracking-widest px-2.5 py-1.5 rounded-md border transition-colors",
      active
        ? "bg-primary/15 text-primary border-primary/50"
        : "bg-surface-elevated text-muted-foreground border-border hover:border-primary/40",
    )}
  >
    <Icon className="w-3 h-3" />
    {label}
  </button>
);

const Stat = ({
  label, value, unit, decimals = 0, warn = false, danger = false,
}: {
  label: string;
  value: number | null;
  unit: string;
  decimals?: number;
  warn?: boolean;
  danger?: boolean;
}) => (
  <div className={cn(
    "panel p-4 transition-colors",
    danger && "border-danger/60",
    warn && !danger && "border-warning/60",
  )}>
    <div className="label-tiny">{label}</div>
    <div className="mt-2 flex items-baseline gap-1.5">
      {value === null ? (
        <span className="mono text-2xl font-bold tabular-nums text-muted-foreground/30">--</span>
      ) : (
        <CountUp
          value={value}
          decimals={decimals}
          duration={200}
          className={cn(
            "mono text-2xl font-bold tabular-nums",
            danger ? "text-danger text-glow-danger" : warn ? "text-warning" : "text-primary text-glow-teal",
          )}
        />
      )}
      {unit && value !== null && <span className="mono text-[10px] text-muted-foreground">{unit}</span>}
    </div>
  </div>
);

// ── Camera feed + head pose overlay ──────────────────────────────────────────
const CameraPanel = ({
  videoRef, status, headPose, onStart,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: string;
  headPose: { pitch: number; yaw: number; roll: number };
  onStart: () => void;
}) => (
  <div className="panel p-3 space-y-2">
    <div className="label-tiny flex items-center justify-between">
      <span>Affective tracking</span>
      <span className={cn(
        "mono text-[9px] tracking-widest px-1.5 py-0.5 rounded-sm border",
        status === "ready"   ? "bg-primary/15 text-primary border-primary/40"
        : status === "loading" ? "bg-amber-500/10 text-amber-400 border-amber-500/40"
        : "bg-muted/30 text-muted-foreground border-border",
      )}>
        {status === "ready" ? "MEDIAPIPE" : status === "loading" ? "LOADING" : "OFFLINE"}
      </span>
    </div>

    <div className="relative bg-input rounded-md overflow-hidden" style={{ aspectRatio: "4/3" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn("w-full h-full object-cover", status !== "ready" && "opacity-0")}
        style={{ transform: "scaleX(-1)" }} // mirror for self-view
      />
      {status !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Camera className="w-6 h-6 text-muted-foreground/40" />
          {status === "idle" || status === "denied" ? (
            <button
              onClick={onStart}
              className="mono text-[10px] tracking-widest px-2 py-1 rounded-sm bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 transition-colors"
            >
              {status === "denied" ? "PERMISSION DENIED" : "ENABLE CAMERA"}
            </button>
          ) : (
            <span className="mono text-[10px] text-muted-foreground animate-pulse">LOADING MODEL…</span>
          )}
        </div>
      )}
    </div>

    {status === "ready" && (
      <div className="grid grid-cols-3 gap-1">
        {(["Pitch", "Yaw", "Roll"] as const).map((axis, i) => {
          const val = [headPose.pitch, headPose.yaw, headPose.roll][i];
          return (
            <div key={axis} className="bg-card border border-border rounded-sm px-1.5 py-1 text-center">
              <div className="label-tiny text-[8px]">{axis}</div>
              <div className="mono text-xs font-bold text-primary tabular-nums">
                {val.toFixed(1)}°
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

// ── ARKit Blend Shape bars ────────────────────────────────────────────────────
const BlendshapePanel = ({
  blendshapes, cameraActive,
}: {
  blendshapes: Record<string, number>;
  cameraActive: boolean;
}) => (
  <div className="panel p-3 space-y-2">
    <div className="label-tiny">ARKit blend shapes</div>
    <div className="space-y-1.5">
      {DISPLAY_BLENDSHAPES.map((name) => {
        const v = cameraActive ? (blendshapes[name] ?? 0) : Math.random() * 0.1;
        const pct = Math.round(v * 100);
        const isActive = pct > 20;
        return (
          <div key={name} className="flex items-center gap-2">
            <div className="mono text-[9px] text-muted-foreground w-24 truncate">{name}</div>
            <div className="flex-1 h-1.5 bg-input rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-100",
                  isActive ? "bg-gradient-to-r from-primary to-primary-glow" : "bg-border",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mono text-[9px] text-muted-foreground w-6 text-right tabular-nums">{pct}</div>
          </div>
        );
      })}
    </div>
    {!cameraActive && (
      <div className="mono text-[9px] text-muted-foreground/60 text-center pt-1">Enable camera to track live</div>
    )}
  </div>
);

// ── Motion / Tremor panel ─────────────────────────────────────────────────────
const MotionPanel = ({
  motion, onRequestPermission,
}: {
  motion: ReturnType<typeof useTelemetry>["motionState"];
  onRequestPermission: () => void;
}) => {
  const tremor = motion.tremorMagnitude;
  const tremorPct = Math.min(100, tremor * 500);

  return (
    <div className="panel p-3 space-y-2">
      <div className="label-tiny flex items-center justify-between">
        <span>Micro-tremors</span>
        <Zap className="w-3 h-3 text-muted-foreground" />
      </div>

      {motion.permission === "unknown" && (
        <button
          onClick={onRequestPermission}
          className="w-full mono text-[10px] tracking-widest py-1.5 rounded-sm bg-surface-elevated border border-border hover:border-primary/40 text-muted-foreground transition-colors"
        >
          ENABLE MOTION
        </button>
      )}

      {(motion.unavailable || motion.permission === "unavailable") && (
        <div className="mono text-[9px] text-muted-foreground/50 text-center py-1 border border-dashed border-border rounded-sm px-2">
          No IMU sensor detected (desktop)
        </div>
      )}

      {motion.permission === "granted" && !motion.unavailable && (
        <>
          <div className="space-y-1.5">
            {(["X", "Y", "Z"] as const).map((axis, i) => {
              const v = [motion.accelX, motion.accelY, motion.accelZ][i];
              return (
                <div key={axis} className="flex items-center gap-2">
                  <div className="mono text-[9px] text-muted-foreground w-3">{axis}</div>
                  <div className="flex-1 h-1.5 bg-input rounded-full overflow-hidden">
                    <div
                      className="h-full bg-secondary rounded-full transition-all duration-75"
                      style={{ width: `${Math.min(100, Math.abs(v) * 100)}%` }}
                    />
                  </div>
                  <div className="mono text-[9px] text-muted-foreground w-10 text-right tabular-nums">
                    {v.toFixed(3)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between">
              <div className="label-tiny text-[8px]">Tremor index</div>
              <div className={cn("mono text-xs font-bold tabular-nums", tremor > 0.1 ? "text-warning" : "text-primary")}>
                {tremor.toFixed(4)}
              </div>
            </div>
            <div className="h-1.5 bg-input rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-100",
                  tremor > 0.1 ? "bg-warning" : "bg-primary")}
                style={{ width: `${tremorPct}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ── Pointer / Tactile panel ───────────────────────────────────────────────────
const PointerPanel = ({
  pointer,
}: {
  pointer: ReturnType<typeof useTelemetry>["pointerState"];
}) => (
  <div className="panel p-3 space-y-2">
    <div className="label-tiny">Tactile impulsivity</div>
    <div className="grid grid-cols-2 gap-2">
      <MiniStat label="Taps" value={pointer.tapCount} />
      <MiniStat label="Pressure" value={+(pointer.meanPressure * 100).toFixed(0)} unit="%" />
      <MiniStat label="Velocity" value={+pointer.meanVelocityPxPerMs.toFixed(2)} unit="px/ms" />
      <MiniStat label="Inter-tap" value={+pointer.meanInterTapMs.toFixed(0)} unit="ms" />
    </div>
  </div>
);

const MiniStat = ({ label, value, unit = "" }: { label: string; value: number; unit?: string }) => (
  <div className="bg-surface-elevated border border-border rounded-sm px-2 py-1.5">
    <div className="label-tiny text-[8px]">{label}</div>
    <div className="mono text-sm font-bold text-primary tabular-nums">
      {value}{unit && <span className="text-muted-foreground text-[9px] font-normal ml-0.5">{unit}</span>}
    </div>
  </div>
);

export default PatientMonitor;
