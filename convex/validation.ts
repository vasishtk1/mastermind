import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Aggregate MasterMind device incidents for model / calibration validation UI.
 * Complements the FastAPI eval harness (synthetic) with real-device distributions.
 */
export const deviceGroundingStats = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 200 }) => {
    const rows = await ctx.db.query("mastermindIncidents").order("desc").take(limit);
    if (rows.length === 0) {
      return {
        count: 0,
        patients: [] as string[],
        avgSpectralFlux: null as number | null,
        avgMfccDeviation: null as number | null,
        avgZcrDensity: null as number | null,
        avgSpectralCentroid: null as number | null,
        avgFundamentalHz: null as number | null,
        avgRms: null as number | null,
      };
    }

    const patients = [...new Set(rows.map((r) => r.patientId))];
    let sf = 0,
      mfcc = 0,
      zcr = 0,
      sc = 0,
      f0 = 0,
      rms = 0;
    for (const r of rows) {
      const a = r.audio;
      sf += a.spectral_flux;
      mfcc += a.mfcc_deviation;
      zcr += a.zcr_density;
      sc += a.spectral_centroid;
      f0 += a.fundamental_frequency_hz;
      rms += a.rms;
    }
    const n = rows.length;
    return {
      count: n,
      patients,
      avgSpectralFlux: sf / n,
      avgMfccDeviation: mfcc / n,
      avgZcrDensity: zcr / n,
      avgSpectralCentroid: sc / n,
      avgFundamentalHz: f0 / n,
      avgRms: rms / n,
    };
  },
});
