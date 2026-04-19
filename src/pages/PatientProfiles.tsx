import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { Patient } from "@/lib/ember-types";
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
  const [patientId, setPatientId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PatientFormField, string>>>({});

  useEffect(() => {
    if (!open) return;
    setName("");
    setDob("");
    setCondition("");
    setClinician("");
    setAccent("teal");
    setPatientId("");
    setFieldErrors({});
  }, [open]);

  const submit = () => {
    const errors = validatePatientForm({ name, dob, condition, clinician });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    onAdd({
      id: patientId.trim() || newPatientId(),
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
            <Label htmlFor="add-patient-id">
              Patient ID <span className="text-muted-foreground text-xs">(optional — leave blank to auto-generate)</span>
            </Label>
            <Input
              id="add-patient-id"
              autoComplete="off"
              placeholder="e.g. pat-test-1"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
            />
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
  const { patients, addPatient } = useEmberData();
  const [addPatientOpen, setAddPatientOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col">
      <header className="px-8 py-5 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Patient roster</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {patients.length} enrolled patients
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddPatientOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-primary-glow rounded-md px-4 py-2 text-sm font-semibold flex items-center gap-2 glow-teal transition-colors"
        >
          <Plus className="w-4 h-4" /> Add patient
        </button>
      </header>

      <AddPatientDialog open={addPatientOpen} onOpenChange={setAddPatientOpen} onAdd={addPatient} />

      <div className="flex-1 overflow-y-auto p-8 space-y-3">
        {patients.map((p) => {
          return (
            <div key={p.id} className="panel p-4 flex items-center gap-5 hover:border-primary/40 transition-colors">
              <div className={cn("w-12 h-12 rounded-md grid place-items-center font-semibold border", accentClass(p.accent))}>
                {p.initials}
              </div>
              <div className="flex-1">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{p.condition}</div>
              </div>
              <div className="text-right w-32">
                <div className="label-tiny">Last activity</div>
                <div className="mono text-xs text-foreground mt-0.5">{p.last_activity ? fmtTime(p.last_activity) : "—"}</div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/patients/${p.id}/profile`}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-semibold transition-colors inline-flex items-center justify-center shadow-sm"
                >
                  Enter workspace &rarr;
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PatientProfiles;
