// Shared types for Ember
export type Profile = {
  id: string;
  trigger_type: string;
  active: boolean;
  updated_at: string; // iso
  metrics?: {
    db_threshold: number;
    voice_overlap: number;
    freq_variance: number;
    safe_window: number;
  };
  description?: string;
};

export type TickEvent = { type: "tick"; db: number; voices: number; variance: number; t: number };
export type TriggerEvent = { type: "trigger"; message: string; t: number };
export type WSEvent = TickEvent | TriggerEvent;
