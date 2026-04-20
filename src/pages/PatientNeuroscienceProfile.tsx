import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Brain, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PROFILES } from "@/lib/ember-mock";
import type { DirectiveActivityType, IncidentReport, Profile } from "@/lib/ember-types";
import { useEmberData } from "@/context/EmberClinicalContext";
import { AcousticSignalPanel } from "@/components/clinician/AcousticSignalPanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const GROUNDING: DirectiveActivityType[] = [
  "Breathing Exercise",
  "Journaling",
  "Grounding (5-4-3-2-1)",
  "Mindfulness Meditation",
  "Physical Movement",
  "Social Connection",
  "Custom",
];

function DeployDirectivePanel({ patientId }: { patientId: string }) {
  const [pitchVariance, setPitchVariance] = useState([140]);
  const [grounding, setGrounding] = useState<DirectiveActivityType>("Grounding (5-4-3-2-1)");
  const [customPrompt, setCustomPrompt] = useState(
    "Maintain calm prosody. If spectral flux exceeds local baseline by >35%, prompt grounding before escalating alarms.",
  );

  const deploy = () => {
    const payload = {
      patient_id: patientId,
      pitch_variance_threshold_hz: pitchVariance[0],
      required_grounding_technique: grounding,
      custom_system_prompt: customPrompt,
      staged_at: new Date().toISOString(),
      sync_channel: "ios_edge_60s",
    };
    console.info("[MasterMind] Directive staged for edge pull", payload);
    toast.success("Profile update staged for edge device", {
      description: "The iOS app will pick this up on its next 60-second sync loop.",
    });
  };

  return (
    <div className="rounded-lg border border-primary/25 bg-gradient-to-b from-primary/5 to-transparent p-5 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Deploy directive</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Mock payload for the MasterMind iOS sync loop — tune thresholds and on-device guidance before patients receive
          updates.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-xs font-medium">Pitch variance threshold (Hz)</Label>
          <span className="mono text-sm text-primary font-semibold tabular-nums">{pitchVariance[0]} Hz</span>
        </div>
        <Slider min={60} max={260} step={2} value={pitchVariance} onValueChange={setPitchVariance} className="py-1" />
        <p className="mono text-[10px] text-muted-foreground">Maps to on-device pitch ceiling before soft alert.</p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium">Required grounding technique</Label>
        <Select value={grounding} onValueChange={(v) => setGrounding(v as DirectiveActivityType)}>
          <SelectTrigger className="bg-background border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUNDING.map((g) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium">Custom system prompt</Label>
        <Textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          className="min-h-[120px] mono text-xs leading-relaxed bg-background"
          placeholder="Instructions merged into the on-device Cactus system prompt…"
        />
      </div>

      <Button
        type="button"
        onClick={deploy}
        className="w-full font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_hsl(var(--primary)/0.25)]"
      >
        Deploy to device
      </Button>
    </div>
  );
}

export default function PatientNeuroscienceProfile() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { patients, incidents, touchPatientProfile } = useEmberData();

  const patient = useMemo(() => patients.find((p) => p.id === patientId) ?? null, [patients, patientId]);
  const patientIncidents = useMemo(
    () => incidents.filter((i) => i.patient_id === patientId).sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp)),
    [incidents, patientId],
  );

  const incidentParam = searchParams.get("incident");
  const [observation, setObservation] = useState("");
  const [profileDrafting, setProfileDrafting] = useState(false);
  const [draftProfile, setDraftProfile] = useState<Profile | null>(null);

  const activeProfile = useMemo(() => {
    if (!patientId) return null;
    return PROFILES.find((p) => p.patient_id === patientId && p.active) ?? PROFILES.find((p) => p.patient_id === patientId) ?? null;
  }, [patientId]);

  const selectedIncident: IncidentReport | null = useMemo(() => {
    if (!patientIncidents.length) return null;
    if (incidentParam) {
      const hit = patientIncidents.find((i) => i.id === incidentParam);
      if (hit) return hit;
    }
    return patientIncidents.find((i) => i.status === "unreviewed") ?? patientIncidents[0];
  }, [patientIncidents, incidentParam]);

  useEffect(() => {
    if (patientId) touchPatientProfile(patientId);
  }, [patientId, touchPatientProfile]);

  const selectIncident = useCallback(
    (id: string) => {
      setSearchParams({ incident: id });
    },
    [setSearchParams],
  );

  const runProfileDraft = () => {
    if (!activeProfile) return;
    setProfileDrafting(true);
    setDraftProfile(null);
    setTimeout(() => {
      setDraftProfile({
        ...activeProfile,
        id: `prof-draft-${Date.now()}`,
        name: `DRAFT-${activeProfile.name.split("-").pop() ?? "GEN"}`,
        description: observation || activeProfile.description,
        active: false,
        updated_at: new Date().toISOString(),
      });
      setProfileDrafting(false);
      toast.message("Neuroscience profile draft ready", {
        description: "Review radar deltas on the right before deploying a directive.",
      });
    }, 1600);
  };

  const displayProfile = draftProfile ?? activeProfile;

  if (!patientId) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Missing patient.</p>
        <Link to="/patients" className="text-primary text-sm mt-2 inline-block">
          Back to roster
        </Link>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="p-8 max-w-md">
        <h1 className="text-lg font-semibold">Patient not found</h1>
        <p className="text-sm text-muted-foreground mt-2">This ID is not in the active roster.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/patients")}>
          Patient roster
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <header className="shrink-0 border-b border-border px-6 py-4 flex flex-wrap items-center gap-4 bg-card/30">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2" asChild>
          <Link to="/dashboard">
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
        </Button>
        <div className="h-6 w-px bg-border hidden sm:block" />
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "w-11 h-11 rounded-md grid place-items-center mono text-sm font-bold border shrink-0",
              patient.accent === "teal" && "bg-primary/15 text-primary border-primary/40",
              patient.accent === "violet" && "bg-secondary/15 text-secondary border-secondary/40",
              patient.accent === "coral" && "bg-primary-glow/15 text-primary border-primary-glow/40",
            )}
          >
            {patient.initials}
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight truncate">{patient.name}</h1>
            <p className="mono text-xs text-muted-foreground truncate">
              DOB {patient.dob} · {patient.condition}
            </p>
          </div>
        </div>
        <span className="ml-auto mono text-[10px] text-muted-foreground border border-border rounded px-2 py-1">
          {displayProfile?.name ?? "NO PROFILE"} · {displayProfile?.trigger_category ?? "—"}
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_1fr] gap-6 p-6 max-w-[1600px] mx-auto">
          {/* Left — history, RAG, observation */}
          <div className="space-y-6 min-w-0">
            <section className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Incident history</h2>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {patientIncidents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No device events for this patient yet.</p>
                ) : (
                  patientIncidents.map((inc) => (
                    <button
                      key={inc.id}
                      type="button"
                      onClick={() => selectIncident(inc.id)}
                      className={cn(
                        "w-full text-left rounded-md border px-3 py-2 transition-colors",
                        selectedIncident?.id === inc.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/40 bg-background/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="mono text-[10px] text-muted-foreground">{inc.trigger_type}</span>
                        <span className="mono text-[10px] text-primary">{inc.severity}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{inc.user_statement}</p>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                RAG clinical summary
              </h2>
              {selectedIncident?.clinical_synthesis ? (
                <div className="space-y-2 text-sm">
                  <p className="text-foreground leading-relaxed">{selectedIncident.clinical_synthesis.summary}</p>
                  <p className="mono text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-2">
                    Model {selectedIncident.clinical_synthesis.model} · score{" "}
                    {selectedIncident.clinical_synthesis.severity_score.toFixed(1)}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No RAG synthesis for this incident yet. Run synthesis from the incident review workflow or continue
                  with live signal review.
                </p>
              )}
            </section>

            <section className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Clinical observation → profile
              </h2>
              <Textarea
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                placeholder="Describe triggers, context, and observed acoustic stressors…"
                className="min-h-[100px] text-sm bg-background"
              />
              <Button
                type="button"
                onClick={runProfileDraft}
                disabled={profileDrafting || !activeProfile}
                className="w-full gap-2 bg-primary text-primary-foreground"
              >
                {profileDrafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                Generate neuroscience profile
              </Button>
              {draftProfile && (
                <p className="mono text-[10px] text-primary flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Draft {draftProfile.name} ready — compare danger polygon on the right.
                </p>
              )}
            </section>

            {patientId && <DeployDirectivePanel patientId={patientId} />}
          </div>

          {/* Right — radar + metrics */}
          <div className="min-w-0 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-base font-semibold">Neuroscience signal breakdown</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Six-axis safe vs danger envelope{draftProfile ? " (draft profile)" : ""}.
                </p>
              </div>
            </div>
            {displayProfile ? (
              <AcousticSignalPanel safeRadar={displayProfile.safe_radar} dangerRadar={displayProfile.danger_radar} />
            ) : (
              <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
                No neuroscience profile on file for this patient.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
