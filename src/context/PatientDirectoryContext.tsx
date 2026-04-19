import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PATIENTS } from "@/lib/ember-mock";
import type { Patient } from "@/lib/ember-types";

const STORAGE_KEY = "ember-dashboard-extra-patients";

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
    // quota or private mode — in-memory extras still work for the session
  }
}

type PatientDirectoryContextValue = {
  patients: Patient[];
  addPatient: (patient: Patient) => void;
};

const PatientDirectoryContext = createContext<PatientDirectoryContextValue | null>(null);

export function PatientDirectoryProvider({ children }: { children: ReactNode }) {
  const [extraPatients, setExtraPatients] = useState<Patient[]>(() => readExtraPatients());

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

  const value = useMemo(
    () => ({
      patients,
      addPatient,
    }),
    [patients, addPatient],
  );

  return (
    <PatientDirectoryContext.Provider value={value}>{children}</PatientDirectoryContext.Provider>
  );
}

export function usePatientDirectory(): PatientDirectoryContextValue {
  const ctx = useContext(PatientDirectoryContext);
  if (!ctx) {
    throw new Error("usePatientDirectory must be used within PatientDirectoryProvider");
  }
  return ctx;
}
