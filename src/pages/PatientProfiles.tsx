import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle,
  Clock,
  Cpu,
  Loader2,
  Plus,
  Rocket,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { PROFILES, EPISODES } from "@/lib/ember-mock";
import type {
  ClinicalIncidentReport,
  EpisodeEvent,
  Patient,
  Profile,
  RadarMetrics,
  RemediationProposal,
  ThresholdAdjustment,
} from "@/lib/ember-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEmberData } from "@/context/EmberClinicalContext";

const API_BASE = "http://localhost:8000";

async function fetchClinicalReports(patientId: string): Promise<ClinicalIncidentReport[]> {
  const res = await fetch(`${API_BASE}/api/patients/${patientId}/reports`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function requestRemediation(patientId: string): Promise<RemediationProposal> {
  const res = await fetch(`${API_BASE}/api/patients/${patientId}/remediate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    let detail = `API error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // ignore body parse error, fall back to status
    }
    throw new Error(detail);
  }
  return res.json();
}

const accentClass = (a: Patient["accent"]) =>
  a === "teal" ? "bg-primary/15 text-primary border-primary/40"
  : a === "violet" ? "bg-secondary/15 text-secondary border-secondary/40"
  : "bg-danger/15 text-danger border-danger/40";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const w = parts[0];
    return (w.length >= 2 ? w.slice(0, 2) : `${w[0]}?`).toUpperCase();
  }
  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";
  return `${first}${last}`.toUpperCase();
}

function newPatientId(): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 10)}`;
  return `pat-${raw.slice(0, 12)}`;
}

type PatientFormField = "name" | "dob" | "condition" | "clinician";

function validatePatientForm(values: {
  name: string;
  dob: string;
  condition: string;
  clinician: string;
}): Partial<Record<PatientFormField, string>> {
  const errors: Partial<Record<PatientFormField, string>> = {};
  const name = values.name.trim();
  if (!name) errors.name = "Full name is required.";
  else if (name.length < 2) errors.name = "Enter at least two characters.";

  if (!values.dob) errors.dob = "Date of birth is required.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.dob)) errors.dob = "Choose a complete date.";

  if (!values.condition.trim()) errors.condition = "Primary condition or clinical focus is required.";
  if (!values.clinician.trim()) errors.clinician = "Attending clinician is required.";
  return errors;
}

const AddPatientDialog = ({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (patient: Patient) => void;
}) => {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [condition, setCondition] = useState("");
  const [clinician, setClinician] = useState("");
  const [accent, setAccent] = useState<Patient["accent"]>("teal");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PatientFormField, string>>>({});

  useEffect(() => {
    if (!open) return;
    setName("");
    setDob("");
    setCondition("");
    setClinician("");
    setAccent("teal");
    setFieldErrors({});
  }, [open]);

  const submit = () => {
    const errors = validatePatientForm({ name, dob, condition, clinician });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    onAdd({
      id: newPatientId(),
      name: name.trim(),
      initials: initialsFromName(name),
      dob,
      condition: condition.trim(),
      clinician: clinician.trim(),
      accent,
      last_activity: new Date().toISOString(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md z-[60]">
        <DialogHeader>
          <DialogTitle>Add patient</DialogTitle>
          <DialogDescription>
            Enter the core demographics used across Ember profiles and monitoring. Fields marked as required must be
            completed before the patient appears in this list.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="add-patient-name">
              Full name <span className="text-danger">*</span>
            </Label>
            <Input
              id="add-patient-name"
              autoComplete="name"
              placeholder="e.g. Jordan A. Lee"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }}
            />
            {fieldErrors.name && <p className="text-xs text-danger">{fieldErrors.name}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="add-patient-dob">
              Date of birth <span className="text-danger">*</span>
            </Label>
            <Input
              id="add-patient-dob"
              type="date"
              value={dob}
              onChange={(e) => {
                setDob(e.target.value);
                if (fieldErrors.dob) setFieldErrors((prev) => ({ ...prev, dob: undefined }));
              }}
            />
            {fieldErrors.dob && <p className="text-xs text-danger">{fieldErrors.dob}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="add-patient-condition">
              Primary condition / focus <span className="text-danger">*</span>
            </Label>
            <Input
              id="add-patient-condition"
              placeholder="e.g. PTSD · Auditory hypervigilance"
              value={condition}
              onChange={(e) => {
                setCondition(e.target.value);
                if (fieldErrors.condition) setFieldErrors((prev) => ({ ...prev, condition: undefined }));
              }}
            />
            {fieldErrors.condition && <p className="text-xs text-danger">{fieldErrors.condition}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="add-patient-clinician">
              Attending clinician <span className="text-danger">*</span>
            </Label>
            <Input
              id="add-patient-clinician"
              autoComplete="off"
              placeholder="e.g. Dr. N. Okafor"
              value={clinician}
              onChange={(e) => {
                setClinician(e.target.value);
                if (fieldErrors.clinician) setFieldErrors((prev) => ({ ...prev, clinician: undefined }));
              }}
            />
            {fieldErrors.clinician && <p className="text-xs text-danger">{fieldErrors.clinician}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="add-patient-accent">List accent</Label>
            <Select value={accent} onValueChange={(v) => setAccent(v as Patient["accent"])}>
              <SelectTrigger id="add-patient-accent">
                <SelectValue placeholder="Choose accent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="teal">Teal</SelectItem>
                <SelectItem value="violet">Violet</SelectItem>
                <SelectItem value="coral">Coral</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Used for avatar styling in this dashboard only.</p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit}>
            Add patient
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const PatientProfiles = () => {
  const { patients, addPatient, setLastViewedPatientId } = useEmberData();
  const [addPatientOpen, setAddPatientOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? patients.find((p) => p.id === openId) ?? null : null;
  const activeProfileCount = useMemo(
    () => PROFILES.filter((pr) => pr.active && patients.some((p) => p.id === pr.patient_id)).length,
    [patients],
  );

  return (
    <div className="h-screen flex flex-col">
      <header className="px-8 py-5 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Patient profiles</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {patients.length} patients · {activeProfileCount} active neuroscience profiles
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddPatientOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-primary-glow rounded-md px-4 py-2 text-sm font-semibold flex items-center gap-2 glow-teal"
        >
          <Plus className="w-4 h-4" /> Add patient
        </button>
      </header>

      <AddPatientDialog open={addPatientOpen} onOpenChange={setAddPatientOpen} onAdd={addPatient} />

      <div className="flex-1 overflow-y-auto p-8 space-y-3">
        {patients.map((p) => {
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
              <div className="flex items-center gap-2">
                <Link
                  to={`/patients/${p.id}/profile`}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-2 text-sm font-semibold transition-colors inline-flex items-center justify-center"
                >
                  Neuro workspace
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(p.id);
                    setLastViewedPatientId(p.id);
                  }}
                  className="bg-surface-elevated border border-border hover:border-primary/60 rounded-md px-4 py-2 text-sm transition-colors"
                >
                  Summary
                </button>
              </div>
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

  const [reports, setReports] = useState<ClinicalIncidentReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);

  const [proposal, setProposal] = useState<RemediationProposal | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [deployedProposalId, setDeployedProposalId] = useState<string | null>(null);

  useEffect(() => {
    setReportsLoading(true);
    setReportsError(null);
    setProposal(null);
    setProposalError(null);
    setDeployedProposalId(null);
    fetchClinicalReports(patient.id)
      .then(setReports)
      .catch((err) => setReportsError(err.message ?? "Failed to load reports"))
      .finally(() => setReportsLoading(false));
  }, [patient.id]);

  const triggerRemediation = useCallback(async () => {
    setProposalLoading(true);
    setProposalError(null);
    setDeployedProposalId(null);
    try {
      const next = await requestRemediation(patient.id);
      setProposal(next);
    } catch (err) {
      setProposalError(err instanceof Error ? err.message : "Failed to generate remediation");
    } finally {
      setProposalLoading(false);
    }
  }, [patient.id]);

  const canRemediate = reports.length > 0 && !reportsLoading;

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

        <div className="p-6 border-t border-border">
          <div className="flex items-center justify-between mb-3">
            <div className="label-tiny">Clinical incident reports</div>
            <button
              onClick={() => void triggerRemediation()}
              disabled={!canRemediate || proposalLoading}
              className={cn(
                "rounded-md px-3 py-1.5 text-[11px] font-semibold flex items-center gap-1.5 border transition-colors",
                canRemediate && !proposalLoading
                  ? "bg-primary text-primary-foreground border-primary hover:bg-primary-glow glow-teal"
                  : "bg-surface-elevated text-muted-foreground border-border cursor-not-allowed opacity-60",
              )}
              title={
                canRemediate
                  ? "Send the latest report to Gemini and propose new device thresholds"
                  : "At least one clinical report is required"
              }
            >
              {proposalLoading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Drafting…
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  Auto-Remediate Thresholds
                </>
              )}
            </button>
          </div>

          <RemediationPanel
            loading={proposalLoading}
            error={proposalError}
            proposal={proposal}
            deployed={proposal?.proposal_id === deployedProposalId}
            onDeploy={() => proposal && setDeployedProposalId(proposal.proposal_id)}
          />

          {reportsLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5 animate-pulse" />
              Loading reports from Ember backend…
            </div>
          )}
          {reportsError && (
            <div className="flex items-center gap-2 text-xs text-danger bg-danger/10 border border-danger/30 rounded-md px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {reportsError}
              <span className="text-muted-foreground ml-1">(Is the backend running on port 8000?)</span>
            </div>
          )}
          {!reportsLoading && !reportsError && reports.length === 0 && (
            <div className="text-xs text-muted-foreground">No clinical reports yet. Send a device event via POST /api/events.</div>
          )}
          {!reportsLoading && !reportsError && reports.length > 0 && (
            <div className="space-y-3">
              {reports.map((r, i) => (
                <ClinicalReportCard key={`${r.incident_timestamp}-${i}`} report={r} />
              ))}
            </div>
          )}
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

const ClinicalReportCard = ({ report }: { report: ClinicalIncidentReport }) => {
  const score = report.estimated_severity_score;
  const isHigh = score >= 7;
  const isMod = score >= 4 && score < 7;

  const severityClass = isHigh
    ? "bg-danger/10 text-danger border-danger/40"
    : isMod
    ? "bg-amber-500/10 text-amber-400 border-amber-500/40"
    : "bg-primary/10 text-primary border-primary/40";

  const severityLabel = isHigh ? "HIGH" : isMod ? "MODERATE" : "LOW";
  const SeverityIcon = isHigh ? AlertTriangle : CheckCircle;

  return (
    <div className="bg-surface-elevated border border-border rounded-md p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="mono text-[10px] text-muted-foreground">
          {new Date(report.incident_timestamp).toLocaleString()}
        </div>
        <div className={cn("flex items-center gap-1 mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm border", severityClass)}>
          <SeverityIcon className="w-3 h-3" />
          {severityLabel} · {score.toFixed(1)}
        </div>
      </div>
      <p className="text-xs text-foreground leading-relaxed">{report.clinical_summary}</p>
      <div className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">{report.recommended_followup}</div>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {report.keywords.map((kw) => (
          <span key={kw} className="mono text-[10px] bg-muted/40 text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {kw}
          </span>
        ))}
      </div>
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

const RemediationPanel = ({
  loading,
  error,
  proposal,
  deployed,
  onDeploy,
}: {
  loading: boolean;
  error: string | null;
  proposal: RemediationProposal | null;
  deployed: boolean;
  onDeploy: () => void;
}) => {
  if (loading) {
    return (
      <div className="bg-surface-elevated border border-border rounded-md p-4 mb-4 space-y-3 animate-pulse">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
          Gemini is reviewing the latest report and tuning device thresholds…
        </div>
        <div className="h-3 bg-muted/40 rounded w-3/4" />
        <div className="h-3 bg-muted/40 rounded w-2/3" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-12 bg-muted/30 rounded" />
          <div className="h-12 bg-muted/30 rounded" />
          <div className="h-12 bg-muted/30 rounded" />
          <div className="h-12 bg-muted/30 rounded" />
        </div>
        <div className="h-16 bg-muted/30 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-danger/10 border border-danger/40 rounded-md p-3 mb-4 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
        <div className="text-xs text-danger flex-1">
          <div className="font-semibold">Remediation pipeline error</div>
          <div className="text-muted-foreground mt-0.5">{error}</div>
        </div>
      </div>
    );
  }

  if (!proposal) return null;

  return (
    <div className="bg-surface-elevated border border-border rounded-md p-4 mb-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-primary" />
            <div className="text-sm font-semibold">Proposed device configuration</div>
          </div>
          <div className="mono text-[10px] text-muted-foreground mt-1">
            {proposal.proposal_id} · severity {proposal.severity_score.toFixed(1)} · confidence{" "}
            {(proposal.confidence * 100).toFixed(0)}%
          </div>
        </div>
        {deployed ? (
          <div className="mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm border bg-primary/15 text-primary border-primary/40 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> DEPLOYED
          </div>
        ) : (
          <div className="mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm border bg-amber-500/10 text-amber-400 border-amber-500/40">
            PENDING REVIEW
          </div>
        )}
      </div>

      <p className="text-xs text-foreground leading-relaxed">{proposal.summary}</p>

      <div>
        <div className="label-tiny mb-2">Threshold adjustments</div>
        <div className="grid grid-cols-1 gap-2">
          {proposal.threshold_adjustments.map((adj) => (
            <ThresholdAdjustmentRow key={adj.parameter} adjustment={adj} />
          ))}
        </div>
      </div>

      <div>
        <div className="label-tiny mb-2">New on-device system prompt</div>
        <pre className="mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap bg-card border border-border rounded-md p-3">
          {proposal.new_system_prompt}
        </pre>
      </div>

      {proposal.deployment_notes && (
        <div className="text-[11px] text-muted-foreground italic border-l-2 border-border pl-2">
          {proposal.deployment_notes}
        </div>
      )}

      <button
        onClick={onDeploy}
        disabled={deployed}
        className={cn(
          "w-full rounded-md py-2 text-xs font-semibold flex items-center justify-center gap-2 border transition-colors",
          deployed
            ? "bg-primary/10 text-primary border-primary/40 cursor-default"
            : "bg-primary text-primary-foreground border-primary hover:bg-primary-glow glow-teal",
        )}
      >
        {deployed ? (
          <>
            <CheckCircle className="w-3.5 h-3.5" /> Deployed to edge device
          </>
        ) : (
          <>
            <Rocket className="w-3.5 h-3.5" /> Approve &amp; deploy to edge device
          </>
        )}
      </button>
    </div>
  );
};

const ThresholdAdjustmentRow = ({ adjustment }: { adjustment: ThresholdAdjustment }) => {
  const isDecrease = adjustment.direction === "decrease";
  const isIncrease = adjustment.direction === "increase";
  const Arrow = isIncrease ? ArrowUpRight : isDecrease ? ArrowDownRight : ArrowUpRight;
  const tone = isDecrease
    ? "text-primary"
    : isIncrease
    ? "text-amber-400"
    : "text-muted-foreground";

  return (
    <div className="bg-card border border-border rounded-md px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="mono text-[11px] text-foreground truncate">{adjustment.parameter}</div>
        <div className={cn("flex items-center gap-1 mono text-[11px] font-semibold", tone)}>
          <span>{adjustment.current_value.toFixed(3)}</span>
          <Arrow className="w-3 h-3" />
          <span>{adjustment.proposed_value.toFixed(3)}</span>
          <span className="text-muted-foreground ml-1">({adjustment.delta >= 0 ? "+" : ""}{adjustment.delta.toFixed(3)})</span>
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{adjustment.rationale}</div>
    </div>
  );
};

export default PatientProfiles;
