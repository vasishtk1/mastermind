import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Upsert a dashboard incident (full IncidentReport JSON in `payload`).
 *
 * `incidentId` is logically unique but the schema doesn't enforce it, and
 * concurrent writers (iOS + web pipeline + manual curl) have produced
 * duplicate rows in the past. We self-heal here: if more than one row
 * matches, we patch the newest and delete the rest so subsequent
 * `unique()`-style lookups (e.g. `directives:deploy`) don't blow up.
 */
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
      .collect();

    if (existing.length > 0) {
      const sorted = [...existing].sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      );
      const keeper = sorted[0];
      for (const dupe of sorted.slice(1)) {
        await ctx.db.delete(dupe._id);
      }
      await ctx.db.patch(keeper._id, {
        patientId: args.patientId,
        payload: args.payload,
        updatedAt: now,
      });
      return keeper._id;
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

/**
 * Delete every dashboard incident. Used to clear the triage feed between
 * demos without nuking patients, benchmarks, or directives.
 */
export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("emberIncidents").collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { ok: true, deleted: rows.length };
  },
});

/**
 * Collapse rows that share an `incidentId`. Keeps the newest copy
 * (highest `updatedAt`) and drops the rest. Returns a per-key audit so
 * we can spot which incidents had drift.
 */
export const dedupe = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("emberIncidents").collect();
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = groups.get(row.incidentId) ?? [];
      bucket.push(row);
      groups.set(row.incidentId, bucket);
    }

    const collisions: { incidentId: string; kept: string; deleted: number }[] =
      [];
    let totalDeleted = 0;

    for (const [incidentId, bucket] of groups.entries()) {
      if (bucket.length <= 1) continue;
      const sorted = [...bucket].sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      );
      const keeper = sorted[0];
      for (const dupe of sorted.slice(1)) {
        await ctx.db.delete(dupe._id);
        totalDeleted += 1;
      }
      collisions.push({
        incidentId,
        kept: keeper._id,
        deleted: sorted.length - 1,
      });
    }

    return { ok: true, totalDeleted, collisions };
  },
});
