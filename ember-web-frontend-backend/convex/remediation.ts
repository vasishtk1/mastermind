import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const saveProposal = mutation({
  args: {
    proposalId: v.string(),
    patientId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("remediationProposals", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const latestForPatient = query({
  args: { patientId: v.string() },
  handler: async (ctx, { patientId }) => {
    return await ctx.db
      .query("remediationProposals")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .first();
  },
});
