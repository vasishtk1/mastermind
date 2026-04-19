import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Brain, Loader2, Sparkles, HeartPulse, Waves, Activity, TrendingUp, Wind, Crosshair, Zap, CheckCircle2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { PROFILES, FEATURE_EXPLAINERS } from "@/lib/ember-mock";
import type { DirectiveActivityType, IncidentReport, Profile, RadarMetrics } from "@/lib/ember-types";
import { useEmberData } from "@/context/EmberClinicalContext";
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

// Ember shared components
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ember/Card";
import { SectionHeader } from "@/components/ember/SectionHeader";
import { StatusBadge } from "@/components/ember/StatusBadge";
import { AcousticThresholdRadar } from "@/components/ember/AcousticThresholdRadar";
import { MetricCard } from "@/components/ember/MetricCard";

const GROUNDING: DirectiveActivityType[] = [
  "Breathing Exercise",
  "Journaling",
  "Grounding (5-4-3-2-1)",
  "Mindfulness Meditation",
  "Physical Movement",
  "Social Connection",
  "Custom",
];

const RADAR_KEYS: Array<keyof RadarMetrics> = [
  "spectral_flux",
  "mfcc_deviation",
  "pitch_escalation",
  "breath_rate",
  "spectral_centroid",
  "zcr_density",
];

const toArray = (r: RadarMetrics) => RADAR_KEYS.map((k) => r[k]);
const ICONS: Record<string, any> = { Waves, Activity, TrendingUp, Wind, Crosshair, Zap };

const STEPS = [
  { id: 1, label: "Benchmarking & Base Profile" },
  { id: 2, label: "Monitoring" },
  { id: 3, label: "Incident Trigger" },
  { id: 4, label: "Clinical Review & Insight" },
  { id: 5, label: "Directive & Deploy" },
];

export default function PatientDashboard() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { patients, incidents, touchPatientProfile, setLastViewedPatientId } = useEmberData();

  const patient = useMemo(() => patients.find((p) => p.id === patientId) ?? null, [patients, patientId]);
  const patientIncidents = useMemo(
    () => incidents.filter((i) => i.patient_id === patientId).sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp)),
    [incidents, patientId],
  );

  const incidentParam = searchParams.get("incident");
  const [activeStep, setActiveStep] = useState<number>(1);
  
  // Explicitly specific clinical note pre-filled text
  const [observation, setObservation] = useState(
    "Observed sudden 58% spike in MFCC Deviation and Spectral Flux, aligning with patient self-report of 'startle response'. The patient's auditory system appears highly sensitive to sudden, sharp transient noises. Suggest increasing pitch tolerance temporarily while expanding grounding options to mitigate immediate freeze impulses."
  );
  
  const [profileDrafting, setProfileDrafting] = useState(false);
  const [draftProfile, setDraftProfile] = useState<Profile | null>(null);

  // Deploy state
  const [pitchVariance, setPitchVariance] = useState([140]);
  const [grounding, setGrounding] = useState<DirectiveActivityType>("Grounding (5-4-3-2-1)");
  const [instructions, setInstructions] = useState("Guide patient through 5 physical senses to interrupt freeze response. Keep tone slow, measured, and highly directive.");
  const [deploying, setDeploying] = useState(false);

  const activeProfile = useMemo(() => {
    if (!patientId) return null;
    const found = PROFILES.find((p) => p.patient_id === patientId && p.active) ?? PROFILES.find((p) => p.patient_id === patientId);
    if (found) return found;

    // Automatically spawn a starting baseline profile for new patients
    return {
      id: `prof-auto-${patientId}`,
      patient_id: patientId,
      name: "Baseline Envelope",
      trigger_category: "Custom",
      description: "System generated baseline boundaries.",
      metrics: {
        spectral_flux_threshold: 0.8,
        mfcc_anomaly_score: 0.8,
        spectral_centroid: 4000,
        zcr_baseline: 0.5,
        breath_rate_ceiling: 25,
        pitch_variance_max: 200,
        anomaly_sensitivity: 0.5,
      },
      safe_radar: { spectral_flux: 28, mfcc_deviation: 22, pitch_escalation: 30, breath_rate: 35, spectral_centroid: 40, zcr_density: 25 },
      danger_radar: { spectral_flux: 86, mfcc_deviation: 80, pitch_escalation: 74, breath_rate: 78, spectral_centroid: 70, zcr_density: 82 },
      active: true,
      updated_at: new Date().toISOString(),
    } as Profile;
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
    if (patientId) {
      touchPatientProfile(patientId);
      setLastViewedPatientId(patientId);
    }
  }, [patientId, touchPatientProfile, setLastViewedPatientId]);

  const jumpToBenchmarking = () => {
    if (patientId) {
      setLastViewedPatientId(patientId);
      navigate("/benchmarking");
    }
  };

  const runProfileDraft = () => {
    if (!activeProfile) return;
    setProfileDrafting(true);
    setTimeout(() => {
      setDraftProfile({
        ...activeProfile,
        safe_radar: {
          spectral_flux: Math.min(100, activeProfile.safe_radar.spectral_flux + 15),
          mfcc_deviation: Math.min(100, activeProfile.safe_radar.mfcc_deviation + 12),
          pitch_escalation: Math.min(100, activeProfile.safe_radar.pitch_escalation + 8),
          breath_rate: activeProfile.safe_radar.breath_rate,
          spectral_centroid: activeProfile.safe_radar.spectral_centroid,
          zcr_density: Math.min(100, activeProfile.safe_radar.zcr_density + 10),
        },
        id: `prof-draft-${Date.now()}`,
        name: `DRAFT-${activeProfile.name.split("-").pop() ?? "GEN"}`,
        description: observation || activeProfile.description,
        active: false,
        updated_at: new Date().toISOString(),
      });
      setProfileDrafting(false);
      toast.success("Profile Updated", {
        description: "New baseline merged. Ready for deployment.",
      });
      setActiveStep(5);
    }, 1200);
  };

  const runDeploy = () => {
    setDeploying(true);
    setTimeout(() => {
      setDeploying(false);
      toast.success("Directive Deployed Successfully", {
        description: `Edge device received pitch tolerance +140 Hz and Grounding (5-4-3-2-1) instruction.`,
      });
      setActiveStep(2); // Loop back to monitoring
    }, 1500);
  };

  const displayProfile = draftProfile ?? activeProfile;

  if (!patientId || !patient) {
    return (
      <div className="p-8 max-w-md">
        <h1 className="text-lg font-semibold">Patient not found</h1>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/patients")}>
          Patient roster
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/30">
        <div className="flex items-center gap-4 min-w-0">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2" asChild>
            <Link to="/patients">
              <ArrowLeft className="w-4 h-4" />
              Roster
            </Link>
          </Button>
          <div className="h-6 w-px bg-border hidden sm:block" />
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={cn(
                "w-11 h-11 rounded-md grid place-items-center mono text-sm font-bold border shrink-0",
                patient.accent === "teal" && "bg-primary/15 text-primary border-primary/40",
                patient.accent === "violet" && "bg-secondary/15 text-secondary border-secondary/40",
                patient.accent === "coral" && "bg-amber-500/10 text-amber-400 border-amber-500/35",
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
        </div>
      </header>

      {/* HORIZONTAL STEPPER */}
      <div className="shrink-0 bg-surface-elevated border-b border-border py-6 px-6 overflow-x-auto shadow-sm">
        <div className="flex items-center justify-center max-w-[1200px] mx-auto min-w-[700px]">
          {STEPS.map((step, idx) => (
            <div key={step.id} className="flex items-center relative z-10 flex-col flex-1">
              {idx !== 0 && (
                <div 
                  className={cn(
                    "absolute top-4 left-0 -ml-[50%] w-full h-[2px] -z-10 transition-colors duration-500",
                    activeStep >= step.id ? "bg-primary" : "bg-border"
                  )} 
                />
              )}
              <button
                onClick={() => setActiveStep(step.id)}
                className={cn(
                  "w-8 h-8 rounded-full border-2 grid place-items-center text-xs font-bold transition-all duration-300 relative z-10",
                  activeStep === step.id ? "border-primary text-primary bg-[#25282C] scale-110 shadow-[0_0_15px_rgba(226,117,51,0.3)]" :
                  activeStep > step.id ? "border-primary bg-primary text-primary-foreground" :
                  "border-border bg-[#25282C] text-muted-foreground hover:border-muted-foreground"
                )}
              >
                {activeStep > step.id ? <CheckCircle2 className="w-4 h-4" /> : step.id}
              </button>
              <div className={cn(
                "mt-3 text-[11px] font-bold tracking-[0.15em] uppercase transition-colors whitespace-nowrap",
                activeStep === step.id ? "text-foreground" :
                activeStep > step.id ? "text-primary/80" : "text-muted-foreground"
              )}>
                {step.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-background/50">
        <div className="p-8 max-w-[1100px] mx-auto pb-24">
          
          {/* STEP 1: BENCHMARKING */}
          {activeStep === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Step 1: Benchmarking & Base Profile</h2>
                <p className="text-sm text-muted-foreground mt-1">Review the established neutral baseline envelope for this patient before monitoring.</p>
              </div>

              <div className="flex items-center justify-between p-5 rounded-lg border border-border bg-card/50 shadow-sm">
                <div className="space-y-1">
                  <div className="font-semibold text-lg">{patient.name}</div>
                  <div className="text-sm text-muted-foreground">{patient.condition}</div>
                </div>
                <Button onClick={jumpToBenchmarking} className="gap-2">
                  <HeartPulse className="w-4 h-4" /> Run Benchmarking
                </Button>
              </div>


              
              <div className="flex justify-end pt-6">
                <Button size="lg" onClick={() => setActiveStep(2)} className="gap-2 px-10 shadow-md">
                  Activate Monitoring <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: MONITORING */}
          {activeStep === 2 && (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500 text-center py-20 max-w-2xl mx-auto">
              <div className="inline-flex items-center justify-center w-28 h-28 rounded-full bg-primary/10 mb-6 shadow-[0_0_50px_rgba(226,117,51,0.15)]">
                <Activity className="w-12 h-12 text-primary animate-pulse" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight">Monitoring Active</h2>
              <p className="text-lg text-muted-foreground mt-4 leading-relaxed">The on-device edge application is streaming local inferences for <strong>{patient.name}</strong>.<br/>Currently stabilized with no anomalies detected.</p>
              
              <div className="pt-12">
                <Button size="lg" onClick={() => setActiveStep(3)} variant="outline" className="border-primary/40 text-primary hover:bg-primary/10 hover:border-primary px-8 h-12 text-sm font-semibold tracking-wide">
                  Simulate Incident Trigger <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: INCIDENT TRIGGER */}
          {activeStep === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8 duration-500">
               <div className="border-b border-border/60 pb-6">
                <h2 className="text-2xl font-bold tracking-tight">Step 3: Incident Trigger Review</h2>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-3xl">An anomaly breached the baseline threshold. Compare the orange danger polygon against the baseline metrics below, and contextualize it alongside the patient's ground truth journal entry.</p>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-8 items-start">
                {/* Left Side Info */}
                <div className="space-y-6">
                  {/* Incident Selector */}
                  <Card className="shadow-sm">
                    <CardHeader className="pb-3 border-b border-border/50 bg-card/30">
                      <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">Active Alerts</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3">
                      <div className="space-y-1.5">
                        {patientIncidents.map((inc) => (
                          <button
                            key={inc.id}
                            type="button"
                            onClick={() => setSearchParams({ incident: inc.id })}
                            className={cn(
                              "w-full text-left rounded-md border px-4 py-3 transition-colors flex items-center justify-between",
                              selectedIncident?.id === inc.id
                                ? "border-primary bg-primary/10 shadow-[inset_4px_0_0_hsl(var(--primary))]"
                                : "border-transparent hover:border-border/80 hover:bg-card/50",
                            )}
                          >
                            <span className={cn("text-[13px] font-semibold", selectedIncident?.id === inc.id ? "text-foreground" : "text-muted-foreground")}>{inc.trigger_type}</span>
                            <StatusBadge severity={inc.severity} />
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Ground Truth Label */}
                  <Card className="border-danger/40 bg-gradient-to-br from-danger/10 to-transparent shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-danger/20 bg-danger/5">
                      <SectionHeader className="text-danger flex items-center gap-2 m-0 text-xs font-bold tracking-wider">
                        <Sparkles className="w-3.5 h-3.5" /> Ground Truth Label Context
                      </SectionHeader>
                    </div>
                    <CardContent className="p-5">
                      <div className="text-sm">
                        {selectedIncident?.user_statement ? (
                          <div className="">
                            <p className="text-foreground italic leading-relaxed font-serif text-[16px] text-justify">
                              "{selectedIncident.user_statement}"
                            </p>
                          </div>
                        ) : (
                          <p className="text-[13px] text-muted-foreground">
                            No journal entry provided for this event.
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Right Side Graphics */}
                <div className="space-y-6">
                  {displayProfile && (
                    <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {FEATURE_EXPLAINERS.map((f, idx) => {
                        const Icon = ICONS[f.icon];
                        const safeValue = toArray(displayProfile.safe_radar)[idx];
                        const dangerValue = toArray(displayProfile.danger_radar)[idx];
                        
                        let customName = f.name;
                        if (f.name === "Spectral Flux") customName = "Environmental Spike (Spectral Flux)";
                        if (f.name === "MFCC Deviation") customName = "Vocal Stress (MFCC Deviation)";
                        if (f.name === "Spectral Centroid") customName = "Vocal Brightness (Centroid)";
                        if (f.name === "ZCR Density") customName = "Vocal Breathiness (ZCR Density)";
                        
                        return (
                          <MetricCard
                            key={f.key}
                            icon={Icon}
                            name={customName}
                            description={f.desc}
                            safeValue={safeValue}
                            dangerValue={dangerValue}
                          />
                        );
                      })}
                    </div>
                    </>
                  )}
                </div>
              </div>

               <div className="flex justify-end pt-8 border-t border-border/40 mt-8">
                <Button size="lg" onClick={() => setActiveStep(4)} className="gap-2 px-10 shadow-md">
                  Proceed to Clinical Review <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: CLINICAL REVIEW */}
          {activeStep === 4 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-8 duration-500 max-w-3xl mx-auto">
              <div className="text-center pb-6">
                <h2 className="text-3xl font-bold tracking-tight">Step 4: Clinical Review & Insight</h2>
                <p className="text-base text-muted-foreground mt-3 max-w-2xl mx-auto">Cross-reference the ground truth journal with the recorded radar deviation and write instructions for the base profile update.</p>
              </div>

              <Card className="shadow-lg border-primary/20 overflow-hidden">
                <div className="px-6 py-4 border-b border-border/50 bg-card/60 flex items-center justify-between">
                  <SectionHeader className="m-0">Clinician Note & Synthesis Context</SectionHeader>
                  <span className="mono text-[10px] bg-primary/10 text-primary px-2 py-1 rounded-sm border border-primary/20">PATIENT: {patient.name.toUpperCase()}</span>
                </div>
                <CardContent className="p-8 space-y-8 bg-card/20">
                  <Textarea
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    placeholder="Describe triggers, context, and observed acoustic stressors…"
                    className="min-h-[240px] text-[15px] leading-relaxed bg-background font-serif shadow-inner border-border p-6 rounded-lg resize-y focus-visible:ring-primary/40"
                  />
                  <div className="pt-2">
                    <Button
                      size="lg"
                      type="button"
                      onClick={runProfileDraft}
                      disabled={profileDrafting || !activeProfile}
                      className="w-full h-14 text-base font-bold tracking-wide gap-3 bg-primary text-primary-foreground shadow-[0_0_20px_rgba(226,117,51,0.2)] hover:shadow-[0_0_30px_rgba(226,117,51,0.4)] transition-shadow"
                    >
                      {profileDrafting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Brain className="w-5 h-5" />}
                      Update Base Profile & Proceed
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* STEP 5: DEPLOY DIRECTIVE */}
          {activeStep === 5 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-500 max-w-2xl mx-auto">
               <div className="text-center pb-4">
                <h2 className="text-3xl font-bold tracking-tight">Step 5: Directive & Deploy</h2>
                <p className="text-base text-muted-foreground mt-3 leading-relaxed">Set final intervention rules based on the clinical note and beam the hyper-parameters securely to the iOS application.</p>
              </div>

              <Card className="bg-gradient-to-b from-primary/5 to-background border-primary/30 shadow-[0_0_40px_rgba(226,117,51,0.1)] overflow-hidden">
                <CardHeader className="pb-6 border-b border-primary/10 bg-card/60">
                  <CardTitle className="text-primary font-bold text-xl">Deployable Edge Payload</CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-10">
                  <div className="space-y-5 bg-card/50 p-6 rounded-lg border border-border/50">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-base font-semibold">Pitch Variance Tolerance Limitation</Label>
                      <span className="mono text-lg text-primary font-bold tabular-nums bg-primary/15 px-4 py-1.5 rounded-md border border-primary/30">{pitchVariance[0]} Hz</span>
                    </div>
                    <Slider min={60} max={260} step={2} value={pitchVariance} onValueChange={setPitchVariance} className="py-2" />
                    <p className="text-[12px] text-muted-foreground uppercase tracking-widest font-semibold flex items-center gap-1.5">
                      <Wind className="w-3.5 h-3.5" /> Sets the maximum allowed vocal pitch spike before triggering an alert.
                    </p>
                  </div>

                  <div className="space-y-4 bg-card/50 p-6 rounded-lg border border-border/50">
                    <Label className="text-base font-semibold">Required Intervention</Label>
                    <Select value={grounding} onValueChange={(v) => setGrounding(v as DirectiveActivityType)}>
                      <SelectTrigger className="bg-background border-border h-14 shadow-sm font-semibold text-[15px] focus:ring-primary/40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GROUNDING.map((g) => (
                          <SelectItem key={g} value={g} className="font-medium py-3 cursor-pointer">
                            {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="pt-3 space-y-3">
                      <Label className="text-sm font-semibold text-muted-foreground">Instructions</Label>
                      <Textarea 
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        className="min-h-[100px] text-[14px] bg-background border-border/60 focus-visible:ring-primary/30 leading-relaxed resize-y shadow-inner"
                        placeholder="Specific system instructions for the edge agent..."
                      />
                    </div>
                  </div>

                  <div className="pt-6">
                    <Button
                      size="lg"
                      type="button"
                      onClick={runDeploy}
                      disabled={deploying}
                      className="w-full text-lg font-bold tracking-wide bg-primary text-primary-foreground hover:bg-primary-glow shadow-[0_0_30px_rgba(226,117,51,0.3)] h-16 transition-all"
                    >
                      {deploying ? <Loader2 className="w-6 h-6 animate-spin" /> : "Deploy Directive To Edge Device"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
