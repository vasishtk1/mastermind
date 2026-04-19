import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { MasterMindAudioBiometrics } from "@/lib/mastermind-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Database, Loader2, BookOpen, Activity, Smartphone } from "lucide-react";
import { toast } from "sonner";

type Metrics = {
  rmsDb: number;
  anomalyScore: number;
  spectralFlux: number;
  zcr: number;
  f0Hz: number;
  spectralCentroid: number;
};

interface Props {
  patientId: string;
  patientName: string;
  sessionSeconds: number;
  metrics: Metrics;
  /** Mapped to MasterMind `biometrics.audio` for storage next to web metrics. */
  mastermindAudioSnapshot: MasterMindAudioBiometrics | null;
  geminiSnippet: string | null;
  audioActive: boolean;
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

/** Sample payload shape matching iOS MasterMind logs (for demos). */
const DEMO_MASTERMIND_AUDIO: MasterMindAudioBiometrics = {
  breath_rate: 24.667882930338926,
  duration_sec: 2.4323125,
  fundamental_frequency_hz: 71.74887892376681,
  jitter_approx: 0.24597986301412178,
  mfcc_1_to_13: [
    44.213420867919922, 14.56935977935791, -0.53625249862670898, 4.7270903587341309, -2.5480709075927734,
    1.8722254037857056, -2.7961125373840332, -1.4808679819107056, 0.98796731233596802, -0.28310644626617432,
    -0.6984362006187439, 0.60453122854232788, 0.2555270791053772,
  ],
  mfcc_deviation: 4.1184055882077057,
  pitch_escalation: 0,
  rms: 0.11008107662200928,
  sample_rate_hz: 16000,
  shimmer_approx: 0.22939178642165162,
  spectral_centroid: 1286.3388671875,
  spectral_flux: 0.087297298014163971,
  spectral_rolloff: 2564.445068359375,
  zcr_density: 0.102554219,
};

export function BenchmarkConvexPanel({
  patientId,
  patientName,
  sessionSeconds,
  metrics,
  mastermindAudioSnapshot,
  geminiSnippet,
  audioActive,
}: Props) {
  const snapshot = useQuery(api.compare.fullSnapshotForPatient, { patientId });
  const recordBenchmark = useMutation(api.benchmarks.record);
  const addJournal = useMutation(api.journals.add);
  const ingestIncident = useMutation(api.mastermindIncidents.ingest);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    try {
      await recordBenchmark({
        patientId,
        patientName,
        metrics: {
          rmsDb: metrics.rmsDb,
          anomalyScore: metrics.anomalyScore,
          spectralFlux: metrics.spectralFlux,
          zcr: metrics.zcr,
          f0Hz: metrics.f0Hz,
          spectralCentroid: metrics.spectralCentroid,
        },
        sessionSeconds,
        geminiReasoning: geminiSnippet ?? undefined,
        notes: undefined,
        mastermindAudioSnapshot: mastermindAudioSnapshot ?? undefined,
      });
      toast.success("Benchmark saved to Convex", { description: patientName });
    } catch (e) {
      toast.error("Could not save benchmark", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  const onDemoJournal = async () => {
    try {
      await addJournal({
        patientId,
        content:
          "Felt overwhelmed after work. Used the breathing exercise from the app — helped a little. Still tense.",
        moodScore: 4,
        source: "ios",
      });
      toast.success("Sample journal line added (iOS source)", { description: "For demo comparison" });
    } catch (e) {
      toast.error("Could not add journal", { description: e instanceof Error ? e.message : "" });
    }
  };

  const onDemoMasterMind = async () => {
    try {
      await ingestIncident({
        patientId,
        patientName,
        biometrics: { audio: DEMO_MASTERMIND_AUDIO },
        payloadVersion: "DoctorPayload-demo",
      });
      toast.success("Sample MasterMind incident stored", { description: "Matches iOS log shape" });
    } catch (e) {
      toast.error("Could not ingest incident", { description: e instanceof Error ? e.message : "" });
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Database className="w-4 h-4 text-primary" />
          Convex — clinician · iOS audio · journals
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void onDemoMasterMind()} className="text-xs">
            <Smartphone className="w-3.5 h-3.5 mr-1" />
            Demo iOS payload
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void onDemoJournal()}
            className="text-xs"
          >
            <BookOpen className="w-3.5 h-3.5 mr-1" />
            Demo journal
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void onSave()}
            disabled={saving || !audioActive}
            className="text-xs bg-primary text-primary-foreground"
            title={!audioActive ? "Start the mic to capture a benchmark snapshot" : undefined}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5 mr-1" />}
            Save benchmark
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:divide-x divide-border max-h-[320px]">
        <div className="p-4 overflow-y-auto min-h-[120px]">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Clinician (web)</p>
          {!snapshot ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : snapshot.benchmarks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No saved benchmarks yet for this patient.</p>
          ) : (
            <ul className="space-y-2">
              {snapshot.benchmarks.map((b) => (
                <li key={b._id} className="text-xs rounded border border-border/80 p-2 bg-background/50">
                  <div className="flex justify-between gap-2 text-muted-foreground mono text-[10px]">
                    <span>{fmtTime(b.createdAt)}</span>
                    <span>{b.source}</span>
                  </div>
                  <div className="mt-1 text-foreground">
                    Anomaly {(b.metrics.anomalyScore ?? 0).toFixed(2)} · RMS {Math.round(b.metrics.rmsDb ?? -60)} dB ·{" "}
                    {Math.floor(b.sessionSeconds / 60)}m
                  </div>
                  {b.mastermindAudioSnapshot && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      MFCC Δ {b.mastermindAudioSnapshot.mfcc_deviation.toFixed(2)} · flux{" "}
                      {b.mastermindAudioSnapshot.spectral_flux.toFixed(3)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 overflow-y-auto min-h-[120px]">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">iOS MasterMind (biometrics.audio)</p>
          {!snapshot ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : !snapshot.mastermindIncidents || snapshot.mastermindIncidents.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No device incidents yet. The app calls <code className="text-[10px]">mastermindIncidents.ingest</code> with{" "}
              <code className="text-[10px]">biometrics.audio</code> (DoctorPayload).
            </p>
          ) : (
            <ul className="space-y-2">
              {snapshot.mastermindIncidents.map((row) => (
                <li key={row._id} className="text-xs rounded border border-primary/25 p-2 bg-primary/5">
                  <div className="flex justify-between gap-2 text-muted-foreground mono text-[10px]">
                    <span>{fmtTime(row.createdAt)}</span>
                    <span>{row.payloadVersion ?? "ios"}</span>
                  </div>
                  <div className="mt-1 text-foreground space-y-0.5">
                    <div>
                      flux {row.audio.spectral_flux.toFixed(4)} · MFCC dev {row.audio.mfcc_deviation.toFixed(2)} · ZCR{" "}
                      {row.audio.zcr_density.toFixed(4)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      F0 {row.audio.fundamental_frequency_hz.toFixed(1)} Hz · rms {row.audio.rms.toFixed(3)} ·{" "}
                      {row.audio.duration_sec.toFixed(2)}s
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 overflow-y-auto min-h-[120px]">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Patient journals</p>
          {!snapshot ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : snapshot.journals.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No journal entries yet. <code className="text-[10px]">journals.add</code> from iOS.
            </p>
          ) : (
            <ul className="space-y-2">
              {snapshot.journals.map((j) => (
                <li key={j._id} className={cn("text-xs rounded border border-border/80 p-2 bg-background/50")}>
                  <div className="flex justify-between gap-2 text-muted-foreground mono text-[10px]">
                    <span>{fmtTime(j.createdAt)}</span>
                    <span>{j.source}</span>
                  </div>
                  <p className="mt-1 text-foreground leading-snug">{j.content}</p>
                  {j.moodScore != null && (
                    <p className="text-[10px] text-muted-foreground mt-1">Mood {j.moodScore}/10</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="px-4 py-2 text-[10px] text-muted-foreground border-t border-border bg-muted/10 leading-relaxed space-y-1">
        <span className="block">
          <strong className="text-foreground/90">Roster / pipeline:</strong>{" "}
          {snapshot ? (
            snapshot.patient ? (
              <>
                patient row <span className="text-primary">✓</span> · clinical reports {snapshot.clinicalReports.length} ·
                device events {snapshot.deviceEvents.length} · directives {snapshot.directives.length} · telemetry batches{" "}
                {snapshot.telemetryBatches.length} · ember incidents {snapshot.emberIncidents.length}
              </>
            ) : (
              <>no <code className="text-[10px]">patients</code> row for this id — upsert via CLI or app, or pick another patient.</>
            )
          ) : (
            "Loading…"
          )}
        </span>
        <span className="block">
          Save benchmark stores web metrics plus an optional MasterMind-shaped audio snapshot for side-by-side comparison
          with iOS <code className="text-[10px]">DoctorPayload</code> rows (middle column).
        </span>
      </p>
    </div>
  );
}
