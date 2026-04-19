import { useState } from "react";
import { Send, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { DirectiveActivityType, DeployedDirective, IncidentReport } from "@/lib/ember-types";

const ACTIVITY_TYPES: DirectiveActivityType[] = [
  "Breathing Exercise",
  "Journaling",
  "Grounding (5-4-3-2-1)",
  "Mindfulness Meditation",
  "Physical Movement",
  "Social Connection",
  "Custom",
];

const ACTIVITY_SUGGESTIONS: Partial<Record<DirectiveActivityType, string>> = {
  "Breathing Exercise":
    "Practice box breathing (4-4-4-4) for 5 minutes. Open Ember → Breathe → Box Protocol. Focus on the visual guide.",
  "Grounding (5-4-3-2-1)":
    "Pause and name: 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, 1 you can taste.",
  "Mindfulness Meditation":
    "Find a quiet spot for 10 minutes. Open Ember → Mindfulness → Body Scan. Lie down if possible.",
  Journaling:
    "Write freely for 10 minutes about what triggered today's episode. Focus on physical sensations, not analysis.",
  "Physical Movement":
    "Take a brisk 15-minute walk outside. Notice your surroundings — temperature, sounds, surfaces underfoot.",
  "Social Connection":
    "Reach out to one trusted person today. Even a brief text check-in is sufficient. Avoid discussing the trigger event.",
};

interface Props {
  incident: IncidentReport;
  onDeployed: (directive: DeployedDirective) => void;
}

export function InsightDeploymentForm({ incident, onDeployed }: Props) {
  const [activityType, setActivityType] = useState<DirectiveActivityType>("Breathing Exercise");
  const [instructions, setInstructions] = useState(
    ACTIVITY_SUGGESTIONS["Breathing Exercise"] ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [deployed, setDeployed] = useState(false);

  const handleActivityChange = (type: DirectiveActivityType) => {
    setActivityType(type);
    setInstructions(ACTIVITY_SUGGESTIONS[type] ?? "");
  };

  const handleDeploy = async () => {
    if (!instructions.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/patients/${incident.patient_id}/directives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: incident.id,
          directive_type: activityType,
          instructions: instructions.trim(),
        }),
      });

      if (!res.ok) throw new Error("Server error");

      const data = await res.json();
      const directive: DeployedDirective = {
        id: data.id,
        incident_id: incident.id,
        directive_type: activityType,
        instructions: instructions.trim(),
        deployed_at: data.deployed_at ?? new Date().toISOString(),
        acknowledged: false,
      };

      setDeployed(true);
      onDeployed(directive);
      toast.success("Directive deployed to device.", {
        description: `${activityType} — ${incident.patient_name}`,
      });
    } catch {
      toast.error("Deployment failed.", {
        description: "Check that the backend is running and try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (deployed) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded border border-green-700/40 bg-green-900/10">
        <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
        <div>
          <p className="text-sm font-medium text-green-300">Directive deployed to device</p>
          <p className="mono text-[11px] text-muted-foreground mt-0.5">
            {activityType} — awaiting patient acknowledgement
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="mono text-[10px] tracking-widest text-muted-foreground uppercase">
        Deploy Insight to Device
      </p>

      {/* Activity type selector */}
      <div className="flex gap-2 flex-wrap">
        {ACTIVITY_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => handleActivityChange(type)}
            className={`px-3 py-1 rounded text-xs mono border transition-all ${
              activityType === type
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:border-muted hover:text-foreground"
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Clinician note textarea */}
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={3}
        placeholder="Write detailed instructions for the patient…"
        className="w-full rounded border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary/60"
      />

      <div className="flex justify-end">
        <button
          onClick={handleDeploy}
          disabled={loading || !instructions.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "linear-gradient(135deg, #E27533 0%, #D6975A 100%)",
            color: "hsl(220 8% 12%)",
            boxShadow: loading ? "none" : "0 0 14px rgba(226,117,51,0.35)",
          }}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {loading ? "Deploying…" : "Deploy to Device"}
        </button>
      </div>
    </div>
  );
}
