import { useState } from "react";
import { Terminal, X, Minimize2, Maximize2 } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { useEmberData } from "@/context/EmberClinicalContext";

export const TelemetryDrawer = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [filter, setFilter] = useState<"all" | "audio" | "llm" | "db">("all");
  const { lastViewedPatientId } = useEmberData();

  const journals = useQuery(api.journals.listByPatient, lastViewedPatientId ? { patientId: lastViewedPatientId, limit: 20 } : "skip") ?? [];
  const deviceEvents = useQuery(api.deviceEvents.listByPatient, lastViewedPatientId ? { patientId: lastViewedPatientId, limit: 20 } : "skip") ?? [];

  // Combine and sort logs chronologically
  const logs = [...journals.map(j => ({ type: "llm" as const, time: j.createdAt, content: `Journal Entry: ${j.content}`, source: "journals" })),
                ...deviceEvents.map(d => ({ type: "db" as const, time: d.createdAt, content: `Device Event: ${d.interventionTranscript || "No transcript"} [Stabilized: ${d.stabilizedFlag}]`, source: "deviceEvents" }))]
    .sort((a, b) => b.time - a.time);

  const filteredLogs = logs.filter(l => filter === "all" || l.type === filter);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-[#16181A] border border-border text-muted-foreground p-3 rounded-full shadow-lg hover:border-primary/50 hover:text-primary transition-colors flex items-center justify-center z-50 group"
        title="Open Developer Telemetry Drawer"
      >
        <Terminal className="w-5 h-5" />
        <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 ease-in-out whitespace-nowrap opacity-0 group-hover:opacity-100 group-hover:ml-2 mono text-xs">
          Debug Stream
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 bg-[#0c0d0f] border-t border-primary/20 z-50 flex flex-col transition-all duration-300 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]",
        isExpanded ? "h-[60vh]" : "h-72"
      )}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-primary/10 bg-[#16181A]">
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-primary" />
          <span className="mono text-xs font-semibold text-primary tracking-widest uppercase">Ember Telemetry Stream</span>
          <div className="flex bg-[#1B1D20] rounded px-1 gap-1">
            {["all", "audio", "llm", "db"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f as any)}
                className={cn(
                  "px-2 py-1 rounded text-[10px] uppercase font-bold mono transition-colors",
                  filter === f ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-input"
                )}
              >
                {f}
              </button>
            ))}
          </div>
          {lastViewedPatientId && (
            <span className="mono text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20">
              Filtering PATIENT: {lastViewedPatientId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setIsExpanded(!isExpanded)} className="p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated rounded transition-colors">
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button onClick={() => setIsOpen(false)} className="p-1 text-muted-foreground hover:text-foreground hover:bg-surface-elevated rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5 focus:outline-none bg-[#0c0d0f]">
        {filteredLogs.length === 0 ? (
          <div className="mono text-[11px] text-[#4a5568]">No telemetry observed for {lastViewedPatientId || "any patient"}.</div>
        ) : (
          filteredLogs.map((log, i) => (
            <div key={i} className="mono text-[11px] leading-relaxed flex items-start gap-3 hover:bg-primary/5 px-2 py-1 rounded transition-colors">
              <span className="text-[#4a5568] shrink-0 min-w-[70px]">{new Date(log.time).toISOString().split('T')[1].slice(0, 8)}</span>
              <span className={cn("shrink-0 min-w-[60px] max-w-[60px] truncate uppercase font-bold tracking-widest", 
                log.type === "db" ? "text-amber-500" :
                log.type === "llm" ? "text-primary" :
                "text-[#9BA4B5]"
              )}>[{log.type}]</span>
              <span className="text-[#a0aec0] whitespace-pre-wrap">{log.content}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
