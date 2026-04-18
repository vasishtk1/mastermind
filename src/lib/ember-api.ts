import type { Profile } from "./ember-types";

const API = "http://localhost:8000";

const MOCK_PROFILES: Profile[] = [
  {
    id: "p1",
    trigger_type: "Auditory overstimulation",
    active: true,
    updated_at: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    description: "Crowded cafeteria with overlapping voices and clattering trays.",
    metrics: { db_threshold: 78, voice_overlap: 3, freq_variance: 0.42, safe_window: 12 },
  },
  {
    id: "p2",
    trigger_type: "High-frequency alarm",
    active: false,
    updated_at: new Date(Date.now() - 1000 * 60 * 32).toISOString(),
    description: "Sudden smoke alarm or microwave beeping above 4kHz.",
    metrics: { db_threshold: 85, voice_overlap: 1, freq_variance: 0.71, safe_window: 6 },
  },
  {
    id: "p3",
    trigger_type: "Crowd murmur",
    active: false,
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    description: "Sustained low-frequency hum from a crowded waiting room.",
    metrics: { db_threshold: 68, voice_overlap: 5, freq_variance: 0.28, safe_window: 18 },
  },
  {
    id: "p4",
    trigger_type: "Mechanical vibration",
    active: false,
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    description: "HVAC compressor cycling near the patient room.",
    metrics: { db_threshold: 72, voice_overlap: 0, freq_variance: 0.55, safe_window: 22 },
  },
];

export async function fetchProfiles(): Promise<Profile[]> {
  try {
    const r = await fetch(`${API}/profiles`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) throw new Error();
    return await r.json();
  } catch {
    return MOCK_PROFILES;
  }
}

export async function generateBaseline(trigger_description: string): Promise<Profile> {
  try {
    const r = await fetch(`${API}/generate-baseline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger_description }),
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) throw new Error();
    return await r.json();
  } catch {
    // mock baseline
    await new Promise((r) => setTimeout(r, 1400));
    return {
      id: `p${Math.floor(Math.random() * 9999)}`,
      trigger_type: trigger_description.split(" ").slice(0, 4).join(" ") || "Custom trigger",
      active: false,
      updated_at: new Date().toISOString(),
      description: trigger_description,
      metrics: {
        db_threshold: 70 + Math.floor(Math.random() * 18),
        voice_overlap: 1 + Math.floor(Math.random() * 5),
        freq_variance: +(0.2 + Math.random() * 0.6).toFixed(2),
        safe_window: 5 + Math.floor(Math.random() * 20),
      },
    };
  }
}

export async function activateProfile(id: string): Promise<void> {
  try {
    await fetch(`${API}/activate/${id}`, { method: "PUT", signal: AbortSignal.timeout(1500) });
  } catch {
    /* mock no-op */
  }
}
