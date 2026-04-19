import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { PATIENTS } from "@/lib/ember-mock";
import { MOCK_AUDIT_METRICS, type AuditMetricSnapshot } from "@/lib/ember-clinical-mock";
import { MOCK_INCIDENTS } from "@/lib/incident-mock";
import type { IncidentReport, Patient } from "@/lib/ember-types";

const STORAGE_KEY = "ember-dashboard-extra-patients";
const LAST_PROFILE_KEY = "ember-clinician-last-profile-patient";

function isPatientShape(x: unknown): x is Patient {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.initials === "string" &&
    typeof o.dob === "string" &&
    typeof o.condition === "string" &&
    typeof o.clinician === "string" &&
    (o.accent === "teal" || o.accent === "violet" || o.accent === "coral")
  );
}

function readExtraPatients(): Patient[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPatientShape);
  } catch {
    return [];
  }
}

function writeExtraPatients(patients: Patient[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
  } catch {
    // ignore
  }
}

function readLastProfilePatientId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_PROFILE_KEY);
  } catch {
    return null;
  }
}

function writeLastProfilePatientId(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_PROFILE_KEY, id);
  } catch {
    // ignore
  }
}

export type EmberClinicalContextValue = {
  patients: Patient[];
  addPatient: (patient: Patient) => void;
  incidents: IncidentReport[];
  setIncidents: Dispatch<SetStateAction<IncidentReport[]>>;
  updateIncident: (incident: IncidentReport) => void;
  auditMetrics: AuditMetricSnapshot[];
  lastViewedPatientId: string | null;
  setLastViewedPatientId: (id: string | null) => void;
  touchPatientProfile: (patientId: string) => void;
};

const EmberClinicalContext = createContext<EmberClinicalContextValue | null>(null);

export function EmberClinicalProvider({ children }: { children: ReactNode }) {
  const [extraPatients, setExtraPatients] = useState<Patient[]>(() => readExtraPatients());
  const [incidents, setIncidents] = useState<IncidentReport[]>(() => [...MOCK_INCIDENTS]);
  const [lastViewedPatientId, setLastViewedPatientIdState] = useState<string | null>(() => readLastProfilePatientId());

  const patients = useMemo(() => {
    const seen = new Set(PATIENTS.map((p) => p.id));
    const merged = [...PATIENTS];
    for (const p of extraPatients) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
    }
    return merged;
  }, [extraPatients]);

  useEffect(() => {
    if (!lastViewedPatientId) return;
    if (!patients.some((p) => p.id === lastViewedPatientId)) {
      setLastViewedPatientIdState(null);
      try {
        window.localStorage.removeItem(LAST_PROFILE_KEY);
      } catch {
        // ignore
      }
    }
  }, [patients, lastViewedPatientId]);

  const addPatient = useCallback((patient: Patient) => {
    setExtraPatients((prev) => {
      if (PATIENTS.some((p) => p.id === patient.id) || prev.some((p) => p.id === patient.id)) {
        return prev;
      }
      const next = [...prev, patient];
      writeExtraPatients(next);
      return next;
    });
  }, []);

  const setLastViewedPatientId = useCallback((id: string | null) => {
    setLastViewedPatientIdState(id);
    if (id) writeLastProfilePatientId(id);
  }, []);

  const touchPatientProfile = useCallback(
    (patientId: string) => {
      if (patients.some((p) => p.id === patientId)) {
        setLastViewedPatientId(patientId);
      }
    },
    [patients, setLastViewedPatientId],
  );

  const updateIncident = useCallback((incident: IncidentReport) => {
    setIncidents((prev) => prev.map((i) => (i.id === incident.id ? incident : i)));
  }, []);

  const value = useMemo(
    () => ({
      patients,
      addPatient,
      incidents,
      setIncidents,
      updateIncident,
      auditMetrics: MOCK_AUDIT_METRICS,
      lastViewedPatientId,
      setLastViewedPatientId,
      touchPatientProfile,
    }),
    [
      patients,
      addPatient,
      incidents,
      updateIncident,
      lastViewedPatientId,
      setLastViewedPatientId,
      touchPatientProfile,
    ],
  );

  return <EmberClinicalContext.Provider value={value}>{children}</EmberClinicalContext.Provider>;
}

export function useEmberData(): EmberClinicalContextValue {
  const ctx = useContext(EmberClinicalContext);
  if (!ctx) {
    throw new Error("useEmberData must be used within EmberClinicalProvider");
  }
  return ctx;
}
