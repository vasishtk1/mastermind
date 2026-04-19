import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Upsert a dashboard incident (full IncidentReport JSON in `payload`). */
export const upsert = mutation({
  args: {
    incidentId: v.string(),
    patientId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("emberIncidents")
      .withIndex("by_incidentId", (q) => q.eq("incidentId", args.incidentId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        patientId: args.patientId,
        payload: args.payload,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("emberIncidents", { ...args, updatedAt: now });
  },
});

export const listByPatient = query({
  args: { patientId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { patientId, limit = 100 }) => {
    return await ctx.db
      .query("emberIncidents")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(limit);
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 200 }) => {
    return await ctx.db.query("emberIncidents").order("desc").take(limit);
  },
});
