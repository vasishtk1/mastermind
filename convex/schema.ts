import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { audioBiometricsValue, patientAccent } from "./audioValidators";

/** Clinician browser benchmark sessions + patient journal lines (iOS / web). Shared by web + iOS via Convex. */
export default defineSchema({
  /**
   * Authoritative patient roster (replaces localStorage-only extras + mirrors backend `patients`).
   */
  patients: defineTable({
    patientId: v.string(),
    name: v.string(),
    initials: v.string(),
    dob: v.string(),
    condition: v.string(),
    clinician: v.string(),
    accent: patientAccent,
    lastActivity: v.optional(v.string()),
    dialectGroup: v.optional(v.string()),
    baselineMfcc: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_patientId", ["patientId"]),

  /**
   * Dashboard / triage incidents (rich `IncidentReport` from EmberClinicalContext).
   * `emberIncidents.upsert` writes `payload`; optional typed fields are for other writers / future use.
   */
  emberIncidents: defineTable({
    incidentId: v.string(),
    patientId: v.string(),
    
    // Explicit clinical wizard data fields
    activeAlerts: v.optional(v.array(
      v.object({
        name: v.string(),
        severity: v.string(),
      })
    )),
    groundTruthContext: v.optional(v.string()),
    metricDeviations: v.optional(v.object({
      spectralFlux: v.number(),
      mfccDeviation: v.number(),
      pitchEscalation: v.number(),
      breathRate: v.number(),
      centroid: v.number(),
      zcrDensity: v.number(),
    })),
    clinicalObservation: v.optional(v.string()),
    directivePayload: v.optional(v.object({
      pitchVarianceTolerance: v.number(),
      intervention: v.string(),
      instructions: v.string(),
    })),

    // Legacy JSON dump
    payload: v.optional(v.any()),
    updatedAt: v.number(),
  })
    .index("by_patient_time", ["patientId", "updatedAt"])
    .index("by_incidentId", ["incidentId"]),

  /** Raw device engine payload (parity with SQLite `device_events`). */
  deviceEvents: defineTable({
    eventId: v.string(),
    patientId: v.string(),
    timestamp: v.number(),
    preInterventionMfccVariance: v.number(),
    interventionTranscript: v.string(),
    stabilizedFlag: v.boolean(),
    createdAt: v.number(),
  }).index("by_patient_time", ["patientId", "createdAt"]),

  /** RAG clinical report (parity with SQLite `clinical_reports`). */
  clinicalReports: defineTable({
    reportId: v.string(),
    eventId: v.optional(v.string()),
    patientId: v.string(),
    incidentTimestamp: v.number(),
    estimatedSeverityScore: v.number(),
    clinicalSummary: v.string(),
    recommendedFollowup: v.string(),
    keywords: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_patient_time", ["patientId", "createdAt"]),

  /** One eval harness run; `summary` holds full EvalSummary JSON (parity with `eval_runs.summary_json`). */
  evalRuns: defineTable({
    runId: v.string(),
    createdAt: v.number(),
    model: v.string(),
    utilityPrecisionAtHigh: v.number(),
    fairnessCv: v.number(),
    totalCases: v.number(),
    failedCases: v.number(),
    summary: v.any(),
  }).index("by_time", ["createdAt"]),

  /** 500 ms telemetry windows (parity with SQLite `telemetry_batches`). */
  telemetryBatches: defineTable({
    patientId: v.string(),
    windowStartMs: v.number(),
    windowEndMs: v.number(),
    face: v.any(),
    audio: v.any(),
    motion: v.any(),
    pointer: v.any(),
    createdAt: v.number(),
  }).index("by_patient_time", ["patientId", "createdAt"]),

  /** Clinician directives deployed to device (persisted; FastAPI path was stub-only). */
  directives: defineTable({
    directiveId: v.string(),
    patientId: v.string(),
    incidentId: v.string(),
    directiveType: v.string(),
    instructions: v.string(),
    deployedAt: v.number(),
    status: v.string(),
    acknowledged: v.optional(v.boolean()),
  })
    .index("by_patient_time", ["patientId", "deployedAt"])
    .index("by_directiveId", ["directiveId"]),

  /** Cached remediation proposals from the LLM pipeline (optional analytics / replay). */
  remediationProposals: defineTable({
    proposalId: v.string(),
    patientId: v.string(),
    createdAt: v.number(),
    payload: v.any(),
  }).index("by_patient_time", ["patientId", "createdAt"]),

  /**
   * iOS MasterMind “DoctorPayload” incidents — full biometrics.audio used for benchmarking vs clinician sessions.
   */
  mastermindIncidents: defineTable({
    patientId: v.string(),
    patientName: v.optional(v.string()),
    createdAt: v.number(),
    audio: audioBiometricsValue,
    /** Optional full iOS DoctorPayload mirror for rich dashboard rendering. */
    payload: v.optional(v.any()),
    /** Optional client build / schema version */
    payloadVersion: v.optional(v.string()),
  }).index("by_patient_time", ["patientId", "createdAt"]),

  benchmarkRuns: defineTable({
    patientId: v.string(),
    patientName: v.optional(v.string()),
    createdAt: v.number(),
    source: v.union(v.literal("clinician_web"), v.literal("ios")),
    metrics: v.object({
      rmsDb: v.optional(v.number()),
      anomalyScore: v.optional(v.number()),
      spectralFlux: v.optional(v.number()),
      zcr: v.optional(v.number()),
      f0Hz: v.optional(v.number()),
      spectralCentroid: v.optional(v.number()),
    }),
    /** When the browser maps live stats into MasterMind-shaped audio (optional). */
    mastermindAudioSnapshot: v.optional(audioBiometricsValue),
    sessionSeconds: v.number(),
    geminiReasoning: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_patient_time", ["patientId", "createdAt"]),

  journalEntries: defineTable({
    patientId: v.string(),
    createdAt: v.number(),
    content: v.string(),
    moodScore: v.optional(v.number()),
    source: v.union(v.literal("ios"), v.literal("web")),
  }).index("by_patient_time", ["patientId", "createdAt"]),
});
