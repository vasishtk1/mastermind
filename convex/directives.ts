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

/**
 * Clinician-driven directive deployment from the web dashboard.
 * Inserts a `directives` row AND patches the matching `emberIncidents`
 * payload so the IncidentReport reflects `deployed_directive` immediately
 * (no extra round-trip from the UI).
 */
export const deploy = mutation({
  args: {
    incidentId: v.string(),
    patientId: v.string(),
    directiveType: v.string(),
    instructions: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const directiveId = `dir-${args.incidentId}-${now}`;
    await ctx.db.insert("directives", {
      directiveId,
      patientId: args.patientId,
      incidentId: args.incidentId,
      directiveType: args.directiveType,
      instructions: args.instructions,
      deployedAt: now,
      status: "deployed",
      acknowledged: false,
    });

    // `incidentId` is logically unique but the schema doesn't enforce it
    // (concurrent upserts have produced duplicates in the wild). Patch
    // every match so the dashboard reflects the deployed directive no
    // matter which row the UI subscription is reading from.
    const incidents = await ctx.db
      .query("emberIncidents")
      .withIndex("by_incidentId", (q) => q.eq("incidentId", args.incidentId))
      .collect();

    for (const incident of incidents) {
      const payload = (incident.payload ?? {}) as Record<string, unknown>;
      const updated = {
        ...payload,
        status: "resolved",
        deployed_directive: {
          id: directiveId,
          incident_id: args.incidentId,
          directive_type: args.directiveType,
          instructions: args.instructions,
          deployed_at: new Date(now).toISOString(),
          acknowledged: false,
        },
      };
      await ctx.db.patch(incident._id, {
        payload: updated,
        directivePayload: {
          pitchVarianceTolerance: 0.25,
          intervention: args.directiveType,
          instructions: args.instructions,
        },
        updatedAt: now,
      });
    }
    return { directiveId, deployedAt: now, patchedIncidents: incidents.length };
  },
});

/**
 * Wipe every directive (optionally scoped to a single patient). Used to
 * clear cached "current grounding" and the on-device tunable metric strip
 * between demos without dropping patients, benchmarks, or incidents.
 */
export const clearAll = mutation({
  args: { patientId: v.optional(v.string()) },
  handler: async (ctx, { patientId }) => {
    const rows = patientId
      ? await ctx.db
          .query("directives")
          .withIndex("by_patient_time", (q) => q.eq("patientId", patientId))
          .collect()
      : await ctx.db.query("directives").collect();

    for (const row of rows) {
      await ctx.db.delete(row._id);
    }

    return { ok: true, deleted: rows.length, patientId: patientId ?? null };
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

/**
 * Patient-side acknowledgement (called from iOS once the user has read /
 * actioned the directive). Idempotent: subsequent calls are no-ops if the
 * directive is already acknowledged.
 */
export const acknowledge = mutation({
  args: {
    directiveId: v.string(),
    acknowledgedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("directives")
      .withIndex("by_directiveId", (q) => q.eq("directiveId", args.directiveId))
      .unique();
    if (!row) return { acknowledged: false, reason: "not_found" } as const;
    if (row.acknowledged === true) {
      return { acknowledged: true, alreadyAcknowledged: true } as const;
    }
    await ctx.db.patch(row._id, {
      acknowledged: true,
      status: "acknowledged",
    });
    // Also reflect acknowledgement on the IncidentReport mirror so the
    // clinician dashboard sees the patient confirmed the directive. Use
    // `collect()` instead of `unique()` because the schema doesn't enforce
    // a unique `incidentId` on `emberIncidents` and historical duplicates
    // would otherwise crash this mutation.
    const incidents = await ctx.db
      .query("emberIncidents")
      .withIndex("by_incidentId", (q) => q.eq("incidentId", row.incidentId))
      .collect();
    for (const incident of incidents) {
      const payload = (incident.payload ?? {}) as Record<string, unknown>;
      const dd = (payload.deployed_directive ?? null) as Record<string, unknown> | null;
      if (dd) {
        const updatedDirective = { ...dd, acknowledged: true };
        await ctx.db.patch(incident._id, {
          payload: { ...payload, deployed_directive: updatedDirective },
          updatedAt: args.acknowledgedAt ?? Date.now(),
        });
      }
    }
    return { acknowledged: true } as const;
  },
});
