import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const record = mutation({
  args: {
    directiveId: v.string(),
    patientId: v.string(),
    incidentId: v.string(),
    directiveType: v.string(),
    instructions: v.string(),
    deployedAt: v.number(),
    status: v.string(),
    acknowledged: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("directives", args);
  },
});

export const listByPatient = query({
  args: { patientId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { patientId, limit = 50 }) => {
    return await ctx.db
      .query("directives")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(limit);
  },
});
