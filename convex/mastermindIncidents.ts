import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audioBiometricsValue } from "./audioValidators";

/** iOS MasterMind: store one incident row (DoctorPayload biometrics.audio). */
export const ingest = mutation({
  args: {
    patientId: v.string(),
    patientName: v.optional(v.string()),
    biometrics: v.object({
      audio: audioBiometricsValue,
    }),
    payloadVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const mfcc = args.biometrics.audio.mfcc_1_to_13;
    if (mfcc.length !== 13) {
      throw new Error(`mfcc_1_to_13 must have length 13, got ${mfcc.length}`);
    }
    return await ctx.db.insert("mastermindIncidents", {
      patientId: args.patientId,
      patientName: args.patientName,
      createdAt: Date.now(),
      audio: args.biometrics.audio,
      payloadVersion: args.payloadVersion,
    });
  },
});

export const listByPatient = query({
  args: { patientId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { patientId, limit = 30 }) => {
    return await ctx.db
      .query("mastermindIncidents")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(limit);
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 100 }) => {
    return await ctx.db.query("mastermindIncidents").order("desc").take(limit);
  },
});
