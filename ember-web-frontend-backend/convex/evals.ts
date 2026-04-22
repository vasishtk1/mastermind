import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const saveRun = mutation({
  args: {
    runId: v.string(),
    model: v.string(),
    utilityPrecisionAtHigh: v.number(),
    fairnessCv: v.number(),
    totalCases: v.number(),
    failedCases: v.number(),
    summary: v.any(),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    return await ctx.db.insert("evalRuns", { ...args, createdAt });
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("evalRuns")
      .withIndex("by_time", (q) => q.gte("createdAt", 0))
      .order("desc")
      .first();
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 10 }) => {
    return await ctx.db
      .query("evalRuns")
      .withIndex("by_time", (q) => q.gte("createdAt", 0))
      .order("desc")
      .take(limit);
  },
});
