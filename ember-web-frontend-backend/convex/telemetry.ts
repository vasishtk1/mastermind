import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const ingestBatch = mutation({
  args: {
    patientId: v.string(),
    windowStartMs: v.number(),
    windowEndMs: v.number(),
    face: v.any(),
    audio: v.any(),
    motion: v.any(),
    pointer: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("telemetryBatches", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const listByPatient = query({
  args: { patientId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { patientId, limit = 100 }) => {
    return await ctx.db
      .query("telemetryBatches")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(limit);
  },
});
