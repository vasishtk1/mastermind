import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const accent = v.union(
  v.literal("teal"),
  v.literal("violet"),
  v.literal("coral"),
);

export const upsert = mutation({
  args: {
    patientId: v.string(),
    name: v.string(),
    initials: v.string(),
    dob: v.string(),
    condition: v.string(),
    clinician: v.string(),
    accent,
    lastActivity: v.optional(v.string()),
    dialectGroup: v.optional(v.string()),
    baselineMfcc: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("patients")
      .withIndex("by_patientId", (q) => q.eq("patientId", args.patientId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("patients", { ...args, updatedAt: now });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("patients").collect();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const getByPatientId = query({
  args: { patientId: v.string() },
  handler: async (ctx, { patientId }) => {
    return await ctx.db
      .query("patients")
      .withIndex("by_patientId", (q) => q.eq("patientId", patientId))
      .unique();
  },
});
