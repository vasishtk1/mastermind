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
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { IncidentReport, Patient } from "@/lib/ember-types";

const LAST_PROFILE_KEY = "ember-clinician-last-profile-patient";

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
  lastViewedPatientId: string | null;
  setLastViewedPatientId: (id: string | null) => void;
  touchPatientProfile: (patientId: string) => void;
};

const EmberClinicalContext = createContext<EmberClinicalContextValue | null>(null);

export function EmberClinicalProvider({ children }: { children: ReactNode }) {
  const convexEnabled = Boolean(import.meta.env.VITE_CONVEX_URL);
  const patientRows = useQuery(api.patients.list, convexEnabled ? {} : "skip");
  const incidentRows = useQuery(api.emberIncidents.listRecent, convexEnabled ? { limit: 200 } : "skip");
  const upsertPatient = useMutation(api.patients.upsert);

  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [lastViewedPatientId, setLastViewedPatientIdState] = useState<string | null>(() => readLastProfilePatientId());

  const patients = useMemo<Patient[]>(() => {
    if (!patientRows) return [];
    return patientRows.map((row) => ({
      id: row.patientId,
      name: row.name,
      initials: row.initials,
      dob: row.dob,
      condition: row.condition,
      clinician: row.clinician,
      accent: row.accent,
      last_activity: row.lastActivity,
    }));
  }, [patientRows]);

  useEffect(() => {
    if (!incidentRows) return;
    const mapped: IncidentReport[] = incidentRows
      .map((row) => row.payload)
      .filter((payload): payload is IncidentReport => isIncidentReportShape(payload));
    setIncidents(mapped);
  }, [incidentRows]);

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
    void upsertPatient({
      patientId: patient.id,
      name: patient.name,
      initials: patient.initials,
      dob: patient.dob,
      condition: patient.condition,
      clinician: patient.clinician,
      accent: patient.accent,
      lastActivity: patient.last_activity,
    });
  }, [upsertPatient]);

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

function isIncidentReportShape(x: unknown): x is IncidentReport {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.patient_id === "string" &&
    typeof o.patient_name === "string" &&
    typeof o.timestamp === "string"
  );
}

export function useEmberData(): EmberClinicalContextValue {
  const ctx = useContext(EmberClinicalContext);
  if (!ctx) {
    throw new Error("useEmberData must be used within EmberClinicalProvider");
  }
  return ctx;
}
