import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Called from the iOS app (Convex Swift / HTTP client) or web — same table as benchmarks for comparison. */
export const add = mutation({
  args: {
    patientId: v.string(),
    content: v.string(),
    moodScore: v.optional(v.number()),
    source: v.union(v.literal("ios"), v.literal("web")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("journalEntries", {
      ...args,
      createdAt: Date.now(),
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
      .query("journalEntries")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(limit);
  },
});
