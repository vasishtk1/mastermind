import { mutation } from "./_generated/server";

const TABLES = [
  "patients",
  "emberIncidents",
  "deviceEvents",
  "clinicalReports",
  "evalRuns",
  "telemetryBatches",
  "directives",
  "remediationProposals",
  "mastermindIncidents",
  "benchmarkRuns",
  "journalEntries",
] as const;

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    const deleted: Record<string, number> = {};

    for (const table of TABLES) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
      deleted[table] = rows.length;
    }

    return {
      ok: true,
      deleted,
      clearedAt: Date.now(),
    };
  },
});
