import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audioBiometricsValue } from "./audioValidators";

const metricsValidator = v.object({
  rmsDb: v.optional(v.number()),
  anomalyScore: v.optional(v.number()),
  spectralFlux: v.optional(v.number()),
  zcr: v.optional(v.number()),
  f0Hz: v.optional(v.number()),
  spectralCentroid: v.optional(v.number()),
});

export const record = mutation({
  args: {
    patientId: v.string(),
    patientName: v.optional(v.string()),
    metrics: metricsValidator,
    sessionSeconds: v.number(),
    geminiReasoning: v.optional(v.string()),
    notes: v.optional(v.string()),
    /** Optional browser→MasterMind-shaped audio for apples-to-apples vs iOS incidents. */
    mastermindAudioSnapshot: v.optional(audioBiometricsValue),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("benchmarkRuns", {
      ...args,
      createdAt: Date.now(),
      source: "clinician_web",
    });
  },
});

export const listByPatient = query({
  args: {
    patientId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { patientId, limit = 25 }) => {
    return await ctx.db
      .query("benchmarkRuns")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(limit);
  },
});
