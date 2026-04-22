import { v } from "convex/values";
import { query } from "./_generated/server";

/** Full app snapshot for one patient (roster + pipeline + telemetry tail). */
export const fullSnapshotForPatient = query({
  args: { patientId: v.string() },
  handler: async (ctx, { patientId }) => {
    const patient = await ctx.db
      .query("patients")
      .withIndex("by_patientId", (q) => q.eq("patientId", patientId))
      .unique();

    const benchmarks = await ctx.db
      .query("benchmarkRuns")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(20);

    const journals = await ctx.db
      .query("journalEntries")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(20);

    const mastermindIncidents = await ctx.db
      .query("mastermindIncidents")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(20);

    const emberIncidents = await ctx.db
      .query("emberIncidents")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(30);

    const clinicalReports = await ctx.db
      .query("clinicalReports")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(30);

    const deviceEvents = await ctx.db
      .query("deviceEvents")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(30);

    const directives = await ctx.db
      .query("directives")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(20);

    const telemetryBatches = await ctx.db
      .query("telemetryBatches")
      .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(40);

    return {
      patient,
      benchmarks,
      journals,
      mastermindIncidents,
      emberIncidents,
      clinicalReports,
      deviceEvents,
      directives,
      telemetryBatches,
    };
  },
});
