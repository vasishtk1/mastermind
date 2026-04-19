import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Ingest raw device event (matches FastAPI `DeviceEvent` + POST /api/events step 1). */
export const ingestDeviceEvent = mutation({
  args: {
    eventId: v.string(),
    patientId: v.string(),
    timestamp: v.number(),
    preInterventionMfccVariance: v.number(),
    interventionTranscript: v.string(),
    stabilizedFlag: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("deviceEvents", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/** Persist RAG clinical report (matches SQLite `clinical_reports`). */
export const ingestClinicalReport = mutation({
  args: {
    reportId: v.string(),
    eventId: v.optional(v.string()),
    patientId: v.string(),
    incidentTimestamp: v.number(),
    estimatedSeverityScore: v.number(),
    clinicalSummary: v.string(),
    recommendedFollowup: v.string(),
    keywords: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("clinicalReports", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/** Single call mirroring POST /api/events success path: device row + report row. */
export const ingestEventWithReport = mutation({
  args: {
    eventId: v.string(),
    patientId: v.string(),
    eventTimestamp: v.number(),
    preInterventionMfccVariance: v.number(),
    interventionTranscript: v.string(),
    stabilizedFlag: v.boolean(),
    reportId: v.string(),
    incidentTimestamp: v.number(),
    estimatedSeverityScore: v.number(),
    clinicalSummary: v.string(),
    recommendedFollowup: v.string(),
    keywords: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    await ctx.db.insert("deviceEvents", {
      eventId: args.eventId,
      patientId: args.patientId,
      timestamp: args.eventTimestamp,
      preInterventionMfccVariance: args.preInterventionMfccVariance,
      interventionTranscript: args.interventionTranscript,
      stabilizedFlag: args.stabilizedFlag,
      createdAt,
    });
    await ctx.db.insert("clinicalReports", {
      reportId: args.reportId,
      eventId: args.eventId,
      patientId: args.patientId,
      incidentTimestamp: args.incidentTimestamp,
      estimatedSeverityScore: args.estimatedSeverityScore,
      clinicalSummary: args.clinicalSummary,
      recommendedFollowup: args.recommendedFollowup,
      keywords: args.keywords,
      createdAt,
    });
    return { eventId: args.eventId, reportId: args.reportId };
  },
});

export const listClinicalReportsByPatient = query({
  args: { patientId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { patientId, limit = 50 }) => {
    return await ctx.db
      .query("clinicalReports")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(limit);
  },
});

export const listDeviceEventsByPatient = query({
  args: { patientId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { patientId, limit = 50 }) => {
    return await ctx.db
      .query("deviceEvents")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(limit);
  },
});

/** Recent device events across all patients (admin / debug). */
export const listRecentDeviceEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 50 }) => {
    return await ctx.db.query("deviceEvents").order("desc").take(limit);
  },
});
