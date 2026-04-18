import { useMemo, useState } from "react";
import { Plus, X, Upload } from "lucide-react";
import { PATIENTS, PROFILES, EPISODES } from "@/lib/ember-mock";
import type { Patient, Profile, EpisodeEvent, RadarMetrics } from "@/lib/ember-types";
import { cn } from "@/lib/utils";

const accentClass = (a: Patient["accent"]) =>
  a === "teal" ? "bg-primary/15 text-primary border-primary/40"
  : a === "violet" ? "bg-secondary/15 text-secondary border-secondary/40"
  : "bg-danger/15 text-danger border-danger/40";

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const PatientProfiles = () => {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? PATIENTS.find((p) => p.id === openId) ?? null : null;

  return (
    <div className="h-screen flex flex-col">
      <header className="px-8 py-5 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Patient profiles</h1>
          <p className="text-xs text-muted-foreground mt-1">{PATIENTS.length} patients · {PROFILES.length} active neuroscience profiles</p>
        </div>
        <button className="bg-primary text-primary-foreground hover:bg-primary-glow rounded-md px-4 py-2 text-sm font-semibold flex items-center gap-2 glow-teal">
          <Plus className="w-4 h-4" /> Add patient
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-3">
        {PATIENTS.map((p) => {
          const profs = PROFILES.filter((pr) => pr.patient_id === p.id);
          const active = profs.filter((pr) => pr.active).length;
          return (
            <div key={p.id} className="panel p-4 flex items-center gap-5 hover:border-primary/40 transition-colors">
              <div className={cn("w-12 h-12 rounded-md grid place-items-center font-semibold border", accentClass(p.accent))}>
                {p.initials}
              </div>
              <div className="flex-1">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{p.condition}</div>
              </div>
              <div className="text-right">
                <div className="label-tiny">Active profiles</div>
                <div className="mono text-sm font-bold text-primary mt-0.5">{active} / {profs.length}</div>
              </div>
              <div className="text-right w-32">
                <div className="label-tiny">Last activity</div>
                <div className="mono text-xs text-foreground mt-0.5">{p.last_activity ? fmtTime(p.last_activity) : "—"}</div>
              </div>
              <button
                onClick={() => setOpenId(p.id)}
                className="bg-surface-elevated border border-border hover:border-primary/60 rounded-md px-4 py-2 text-sm transition-colors"
              >
                View
              </button>
            </div>
          );
        })}
      </div>

      {/* Drawer */}
      {open && <PatientDrawer patient={open} onClose={() => setOpenId(null)} />}
    </div>
  );
};

const PatientDrawer = ({ patient, onClose }: { patient: Patient; onClose: () => void }) => {
  const profs = useMemo(() => PROFILES.filter((p) => p.patient_id === patient.id), [patient.id]);
  const eps = useMemo(
    () => EPISODES.filter((e) => e.patient_id === patient.id).sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp)),
    [patient.id],
  );

  return (
    <>
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 animate-fade-in" onClick={onClose} />
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 bg-card border-l border-border overflow-y-auto animate-slide-up"
        style={{ width: 480, animation: "slide-up 0.35s cubic-bezier(0.2,0.8,0.2,1)" }}
      >
        <div className="p-6 border-b border-border flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className={cn("w-12 h-12 rounded-md grid place-items-center font-semibold border", accentClass(patient.accent))}>
              {patient.initials}
            </div>
            <div>
              <div className="text-base font-semibold">{patient.name}</div>
              <div className="text-xs text-muted-foreground mt-1">DOB {patient.dob} · {patient.condition}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Clinician: {patient.clinician}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-3">
          <div className="label-tiny">Neuroscience profiles</div>
          {profs.map((pr) => <ProfileRow key={pr.id} profile={pr} />)}
        </div>

        <div className="p-6 border-t border-border">
          <div className="label-tiny mb-3">Episode history</div>
          <EpisodeTimeline episodes={eps} />
        </div>
      </aside>
    </>
  );
};

const ProfileRow = ({ profile }: { profile: Profile }) => {
  const [active, setActive] = useState(profile.active);
  const r = profile.danger_radar;
  const bars: { k: keyof RadarMetrics; label: string }[] = [
    { k: "spectral_flux", label: "Flux" },
    { k: "mfcc_deviation", label: "MFCC" },
    { k: "pitch_escalation", label: "Pitch" },
    { k: "breath_rate", label: "Breath" },
    { k: "spectral_centroid", label: "Cent." },
    { k: "zcr_density", label: "ZCR" },
  ];
  return (
    <div className="bg-surface-elevated border border-border rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="mono text-sm font-bold text-primary">{profile.name}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{profile.trigger_category}</div>
        </div>
        <button
          onClick={() => setActive((a) => !a)}
          className={cn(
            "mono text-[10px] tracking-widest px-2 py-1 rounded-sm border transition-colors",
            active ? "bg-primary/15 text-primary border-primary/50" : "bg-muted/40 text-muted-foreground border-border",
          )}
        >
          {active ? "ACTIVE" : "INACTIVE"}
        </button>
      </div>
      <div className="space-y-1.5">
        {bars.map((b) => (
          <div key={b.k} className="flex items-center gap-2">
            <div className="mono text-[10px] text-muted-foreground w-12">{b.label}</div>
            <div className="flex-1 h-1.5 bg-input rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-primary to-secondary" style={{ width: `${r[b.k]}%` }} />
            </div>
          </div>
        ))}
      </div>
      <button className="w-full bg-card border border-border hover:border-primary/60 text-xs rounded-md py-1.5 flex items-center justify-center gap-2 transition-colors">
        <Upload className="w-3 h-3" /> Load in IDE
      </button>
    </div>
  );
};

const EpisodeTimeline = ({ episodes }: { episodes: EpisodeEvent[] }) => {
  const [hover, setHover] = useState<EpisodeEvent | null>(null);
  if (episodes.length === 0) return <div className="text-xs text-muted-foreground">No episodes recorded.</div>;
  const min = +new Date(episodes[0].timestamp);
  const max = +new Date(episodes[episodes.length - 1].timestamp);
  const span = Math.max(1, max - min);

  return (
    <div className="relative pt-2 pb-10">
      <div className="relative h-1 bg-border rounded-full">
        {episodes.map((e) => {
          const left = ((+new Date(e.timestamp) - min) / span) * 100;
          return (
            <button
              key={e.id}
              onMouseEnter={() => setHover(e)}
              onMouseLeave={() => setHover(null)}
              className="absolute -top-1.5 w-3 h-3 rounded-full bg-danger border border-card hover:scale-150 transition-transform"
              style={{ left: `${left}%`, transform: "translateX(-50%)" }}
              aria-label={`Episode ${e.id}`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-2 mono text-[10px] text-muted-foreground">
        <span>{fmtTime(episodes[0].timestamp)}</span>
        <span>{fmtTime(episodes[episodes.length - 1].timestamp)}</span>
      </div>
      {hover && (
        <div className="mt-3 panel p-3 border-danger/40">
          <div className="flex items-center justify-between mb-1">
            <div className="mono text-[10px] tracking-widest text-danger">EPISODE · gemma-4</div>
            <div className="mono text-[10px] text-muted-foreground">peak {hover.peak_db}dB · anom {hover.peak_anomaly}</div>
          </div>
          <p className="italic mono text-xs text-foreground leading-relaxed">"{hover.reasoning}"</p>
        </div>
      )}
    </div>
  );
};

export default PatientProfiles;
