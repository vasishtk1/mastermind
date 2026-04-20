import { v } from "convex/values";
import {
  mutation,
  internalMutation,
  internalAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { audioBiometricsValue } from "./audioValidators";

/**
 * Single atomic write triggered by the iOS Ember/MasterMind app for every
 * voice or video journal entry.
 *
 * Performs ALL of the following in one round-trip so the dashboard never
 * sees a partially-ingested incident:
 *  1. Upsert the patient row (so unknown patients self-register).
 *  2. Append the raw biometrics envelope into `mastermindIncidents`.
 *  3. Materialise an `IncidentReport`-shaped row in `emberIncidents` so the
 *     clinician's TriageDashboard renders it in real-time.
 *  4. Append the journal note into `journalEntries`.
 *  5. Schedule the Gemini Flash clinical synthesis as a Convex action.
 *
 * The mutation is intentionally permissive on optional fields so older iOS
 * builds keep working as we evolve the schema.
 */
export const journal = mutation({
  args: {
    patientId: v.string(),
    patientName: v.optional(v.string()),
    journalKind: v.union(v.literal("video"), v.literal("voice")),
    noteText: v.optional(v.string()),
    createdAtIso: v.optional(v.string()),
    audio: audioBiometricsValue,
    facial: v.object({
      facial_stress_score: v.number(),
      brow_furrow_score: v.number(),
      jaw_tightness_score: v.number(),
    }),
    gemma: v.object({
      grounding_action: v.string(),
      model_response: v.string(),
      success: v.boolean(),
      total_time_ms: v.number(),
      raw_json: v.optional(v.string()),
    }),
    context: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const createdAt = args.createdAtIso ? Date.parse(args.createdAtIso) : now;
    const safeCreatedAt = Number.isFinite(createdAt) ? createdAt : now;

    // Parse the structured JSON Gemma 4 emits on-device so we can surface its
    // `description` field as the user_statement when the user didn't type a
    // note. Fail-soft: if parsing fails we just fall through to the empty
    // string and the dashboard renders "(no note provided)".
    const gemmaJSON = parseGemmaJSON(args.gemma.model_response);
    const gemmaDescription =
      typeof gemmaJSON?.description === "string" ? gemmaJSON.description.trim() : "";

    const patientName =
      args.patientName?.trim() && args.patientName.trim().length > 0
        ? args.patientName.trim()
        : `Patient ${args.patientId}`;
    const initials = initialsFor(patientName);

    // 1. Upsert patient
    const existingPatient = await ctx.db
      .query("patients")
      .withIndex("by_patientId", (q) => q.eq("patientId", args.patientId))
      .unique();
    if (existingPatient) {
      await ctx.db.patch(existingPatient._id, {
        lastActivity: new Date(safeCreatedAt).toISOString(),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("patients", {
        patientId: args.patientId,
        name: patientName,
        initials,
        dob: "1970-01-01",
        condition: "Journal monitoring",
        clinician: "Dr. T",
        accent: "teal",
        lastActivity: new Date(safeCreatedAt).toISOString(),
        updatedAt: now,
      });
    }

    // 2. Mastermind raw biometrics envelope
    await ctx.db.insert("mastermindIncidents", {
      patientId: args.patientId,
      patientName,
      createdAt: safeCreatedAt,
      audio: args.audio,
      payload: {
        journal_kind: args.journalKind,
        text: args.noteText ?? "",
        biometrics: { audio: args.audio, facial: args.facial },
        model: {
          gemma_action: args.gemma.grounding_action,
          gemma_model_response: args.gemma.model_response,
          gemma_parsed: gemmaJSON ?? null,
          gemma_success: args.gemma.success,
          gemma_total_time_ms: args.gemma.total_time_ms,
          gemma_raw_response_json: args.gemma.raw_json,
        },
        facial_data: args.facial,
        context: args.context ?? {},
      },
      payloadVersion: "ios-direct-1.0",
    });

    // 3. Dashboard incident (IncidentReport shape)
    const incidentId = `inc-${args.patientId}-${safeCreatedAt}`;
    const severity = severityFromMetrics(args.facial.facial_stress_score, args.audio.spectral_flux, args.audio.pitch_escalation);
    // Passive on-device VAD entries (the always-on tripwire on the iOS
    // home screen) are labeled separately from intentional journal
    // check-ins so the clinician can immediately tell which signal was
    // self-reported and which was caught autonomously by the device.
    const passiveCtx = (args.context ?? {}) as { source?: unknown };
    const isPassiveMonitor =
      typeof passiveCtx.source === "string" &&
      passiveCtx.source === "passive_monitor";
    // Prefer the user's typed note; fall back to Gemma's structured
    // description (so the dashboard never shows "(no note provided)" when the
    // on-device JSON parse succeeded); finally fall back to the grounding
    // action text or the literal placeholder. Passive monitor entries get
    // a distinct default statement so the triage feed reads correctly.
    const userStatement =
      args.noteText?.trim() ||
      gemmaDescription ||
      args.gemma.grounding_action?.trim() ||
      (isPassiveMonitor
        ? "Cactus VAD detected elevated acoustic activity on the patient's device."
        : "(no note provided)");

    const incidentPayload = {
      id: incidentId,
      patient_id: args.patientId,
      patient_name: patientName,
      patient_initials: initials,
      patient_accent: "teal" as const,
      timestamp: new Date(safeCreatedAt).toISOString(),
      trigger_type: isPassiveMonitor
        ? "Cactus VAD"
        : args.journalKind === "voice"
          ? "Voice journal check-in"
          : "Video journal check-in",
      acoustic_variance: clamp01(args.audio.spectral_flux * 8),
      peak_db: Math.round(20 * Math.log10(Math.max(args.audio.rms, 1e-6))),
      user_statement: userStatement,
      arkit_stress_index: clamp01(args.facial.facial_stress_score),
      arkit_dominant_expression: dominantExpression(args.facial),
      on_device_action: args.gemma.grounding_action,
      stabilized: args.gemma.success,
      severity,
      status: "unreviewed" as const,
      // Surface the parsed Gemma JSON so the dashboard can render the strict
      // metric envelope alongside the friendlier description.
      gemma_summary: gemmaJSON ?? null,
      gemma_model_response: args.gemma.model_response,
      // these get filled in by the Gemini action
      clinical_synthesis: undefined,
      deployed_directive: undefined,
    };
    const incidentRowId = await ctx.db.insert("emberIncidents", {
      incidentId,
      patientId: args.patientId,
      payload: incidentPayload,
      updatedAt: now,
      metricDeviations: {
        spectralFlux: args.audio.spectral_flux,
        mfccDeviation: args.audio.mfcc_deviation,
        pitchEscalation: args.audio.pitch_escalation,
        breathRate: args.audio.breath_rate,
        centroid: args.audio.spectral_centroid,
        zcrDensity: args.audio.zcr_density,
      },
    });

    // 4. Journal entry mirror
    await ctx.db.insert("journalEntries", {
      patientId: args.patientId,
      content: JSON.stringify({
        kind: args.journalKind,
        note: args.noteText ?? "",
        gemma_action: args.gemma.grounding_action,
        gemma_description: gemmaDescription,
        gemma_summary: gemmaJSON ?? null,
        gemma_success: args.gemma.success,
        incident_id: incidentId,
      }),
      moodScore: Math.max(0, Math.min(10, Math.round((1 - args.facial.facial_stress_score) * 10))),
      source: "ios" as const,
      createdAt: safeCreatedAt,
    });

    // 5. Schedule Gemini Flash analysis (non-blocking)
    await ctx.scheduler.runAfter(0, internal.iosIngest.runGemini, {
      incidentRowId,
      incidentId,
      patientId: args.patientId,
      patientName,
      journalKind: args.journalKind,
      noteText: args.noteText ?? "",
      audio: args.audio,
      facial: args.facial,
      gemmaAction: args.gemma.grounding_action,
      gemmaSuccess: args.gemma.success,
      timestampIso: new Date(safeCreatedAt).toISOString(),
    });

    return { incidentId, incidentRowId, severity };
  },
});

/**
 * Persists clinical_synthesis back onto the IncidentReport payload after
 * Gemini Flash returns. Run as an internal mutation so only the action can
 * call it.
 */
export const saveAnalysis = internalMutation({
  args: {
    incidentRowId: v.id("emberIncidents"),
    synthesis: v.object({
      generated_at: v.string(),
      model: v.string(),
      summary: v.string(),
      dsm_mapping: v.string(),
      risk_assessment: v.string(),
      recommended_followup: v.string(),
      keywords: v.array(v.string()),
      severity_score: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.incidentRowId);
    if (!row) return;
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const updatedPayload = {
      ...payload,
      clinical_synthesis: args.synthesis,
      status: payload.status === "resolved" ? "resolved" : "in_review",
    };
    await ctx.db.patch(args.incidentRowId, {
      payload: updatedPayload,
      clinicalObservation: args.synthesis.summary,
      updatedAt: Date.now(),
    });
  },
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Gemini Flash clinical synthesis                                          */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Calls Gemini Flash to convert raw biometrics + journal note into a
 * compliance-ready clinical synthesis. Falls back to a deterministic
 * rule-based synthesis if no GEMINI_API_KEY is configured or the call fails,
 * so the dashboard always gets *something*.
 */
export const runGemini = internalAction({
  args: {
    incidentRowId: v.id("emberIncidents"),
    incidentId: v.string(),
    patientId: v.string(),
    patientName: v.string(),
    journalKind: v.union(v.literal("video"), v.literal("voice")),
    noteText: v.string(),
    audio: audioBiometricsValue,
    facial: v.object({
      facial_stress_score: v.number(),
      brow_furrow_score: v.number(),
      jaw_tightness_score: v.number(),
    }),
    gemmaAction: v.string(),
    gemmaSuccess: v.boolean(),
    timestampIso: v.string(),
  },
  handler: async (ctx, args) => {
    const synthesis =
      (await tryGeminiFlash(args)) ?? deterministicSynthesis(args);
    await ctx.runMutation(internal.iosIngest.saveAnalysis, {
      incidentRowId: args.incidentRowId,
      synthesis,
    });
  },
});

type GeminiArgs = {
  patientName: string;
  patientId: string;
  journalKind: "video" | "voice";
  noteText: string;
  audio: {
    spectral_flux: number;
    mfcc_deviation: number;
    pitch_escalation: number;
    breath_rate: number;
    spectral_centroid: number;
    spectral_rolloff: number;
    zcr_density: number;
    rms: number;
    fundamental_frequency_hz: number;
    jitter_approx: number;
    shimmer_approx: number;
    duration_sec: number;
    sample_rate_hz: number;
    mfcc_1_to_13: number[];
  };
  facial: {
    facial_stress_score: number;
    brow_furrow_score: number;
    jaw_tightness_score: number;
  };
  gemmaAction: string;
  gemmaSuccess: boolean;
  timestampIso: string;
};

type Synthesis = {
  generated_at: string;
  model: string;
  summary: string;
  dsm_mapping: string;
  risk_assessment: string;
  recommended_followup: string;
  keywords: string[];
  severity_score: number;
};

async function tryGeminiFlash(args: GeminiArgs): Promise<Synthesis | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes("your-gemini-api-key")) {
    return null;
  }
  const prompt = `You are a clinical psychiatrist's assistant generating a JSON clinical synthesis for an at-home journaling check-in performed by patient ${args.patientName} (${args.patientId}).
The patient just submitted a ${args.journalKind} journal entry. Their typed note was:
"""${args.noteText || "(no note)"}"""

The on-device on-device Gemma model produced this grounding directive:
"""${args.gemmaAction}"""

Audio biometrics extracted on-device (16kHz, ${args.audio.duration_sec.toFixed(1)}s):
- spectral_flux=${args.audio.spectral_flux.toFixed(4)}
- mfcc_deviation=${args.audio.mfcc_deviation.toFixed(3)}
- pitch_escalation=${args.audio.pitch_escalation.toFixed(3)}
- breath_rate=${args.audio.breath_rate.toFixed(1)} breaths/min
- spectral_centroid=${args.audio.spectral_centroid.toFixed(0)} Hz
- spectral_rolloff=${args.audio.spectral_rolloff.toFixed(0)} Hz
- zcr_density=${args.audio.zcr_density.toFixed(3)}
- rms=${args.audio.rms.toFixed(4)}
- fundamental_frequency=${args.audio.fundamental_frequency_hz.toFixed(0)} Hz
- jitter=${args.audio.jitter_approx.toFixed(3)} shimmer=${args.audio.shimmer_approx.toFixed(3)}

Facial biometrics from ARKit / Vision pipeline:
- composite_stress=${args.facial.facial_stress_score.toFixed(3)}
- brow_furrow=${args.facial.brow_furrow_score.toFixed(3)}
- jaw_tightness=${args.facial.jaw_tightness_score.toFixed(3)}

Respond with ONLY a JSON object with these exact keys (no markdown):
{
  "summary": "<2-3 sentence clinical summary>",
  "dsm_mapping": "<one-line DSM-5 framing>",
  "risk_assessment": "<short risk paragraph mentioning urgency>",
  "recommended_followup": "<single concrete clinician action for next visit>",
  "keywords": ["<3-6 lowercase keywords>"],
  "severity_score": <0-10 number>
}`;

  try {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
      encodeURIComponent(apiKey);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.4,
          maxOutputTokens: 800,
        },
      }),
    });
    if (!res.ok) {
      console.warn(
        "[iosIngest.runGemini] Gemini Flash HTTP error",
        res.status,
        await res.text(),
      );
      return null;
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;
    const parsed = JSON.parse(text) as Partial<Synthesis> & {
      severity_score?: number;
    };
    return {
      generated_at: new Date().toISOString(),
      model: "gemini-2.0-flash",
      summary: parsed.summary ?? "(no summary)",
      dsm_mapping: parsed.dsm_mapping ?? "—",
      risk_assessment: parsed.risk_assessment ?? "—",
      recommended_followup: parsed.recommended_followup ?? "—",
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map((s) => String(s).toLowerCase()).slice(0, 6)
        : [],
      severity_score:
        typeof parsed.severity_score === "number"
          ? Math.max(0, Math.min(10, parsed.severity_score))
          : compositeScore(args) * 10,
    };
  } catch (err) {
    console.warn("[iosIngest.runGemini] Gemini Flash failed", err);
    return null;
  }
}

function deterministicSynthesis(args: GeminiArgs): Synthesis {
  const score = compositeScore(args);
  const tier = score >= 0.75 ? "critical" : score >= 0.55 ? "high" : score >= 0.3 ? "moderate" : "low";
  const tone =
    args.facial.facial_stress_score > 0.6 || args.audio.pitch_escalation > 0.5
      ? "elevated affective stress"
      : "stable affect with mild dysregulation";
  return {
    generated_at: new Date().toISOString(),
    model: "rule-based-fallback",
    summary: `${args.patientName} submitted a ${args.journalKind} journal showing ${tone}. Composite distress index ${(score * 10).toFixed(1)}/10. On-device Gemma ${args.gemmaSuccess ? "succeeded" : "failed"} with grounding directive: ${args.gemmaAction.slice(0, 160)}.`,
    dsm_mapping:
      score >= 0.55
        ? "Concordant with adjustment-disorder spectrum / acute stress reaction (criteria B1-B3)"
        : "Sub-threshold for DSM-5 acute stress disorder; continue prospective monitoring",
    risk_assessment:
      score >= 0.75
        ? "Acute clinical urgency. Consider same-day welfare check or telehealth touchpoint."
        : score >= 0.55
        ? "Elevated risk window. Schedule a check-in within 48 hours."
        : "Low immediate risk. Patient self-managed via journaling; review at next routine visit.",
    recommended_followup:
      tier === "critical"
        ? "Initiate clinician-deployed grounding directive immediately and call patient."
        : tier === "high"
        ? "Deploy a paced-breathing directive and review biometric trend tomorrow."
        : tier === "moderate"
        ? "Continue passive monitoring. No directive needed unless follow-on entries escalate."
        : "Acknowledge patient's check-in and reinforce daily journaling habit.",
    keywords: [
      args.journalKind,
      tier,
      "biometrics",
      args.facial.facial_stress_score > 0.5 ? "facial-stress" : "facial-stable",
      args.audio.pitch_escalation > 0.4 ? "vocal-escalation" : "vocal-steady",
    ],
    severity_score: Math.round(score * 100) / 10,
  };
}

function compositeScore(args: GeminiArgs) {
  const facial = clamp01(args.facial.facial_stress_score);
  const flux = clamp01(args.audio.spectral_flux * 8);
  const pitch = clamp01(args.audio.pitch_escalation);
  const breath = clamp01(Math.abs(args.audio.breath_rate - 14) / 30);
  return facial * 0.45 + flux * 0.2 + pitch * 0.2 + breath * 0.15;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function initialsFor(name: string) {
  const parts = name
    .replace(/[^a-zA-Z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "PT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Best-effort parser for the strict-JSON envelope emitted by Gemma 4 on-device.
 * The CactusManager prompt asks the model to emit ONLY raw JSON, but if it
 * accidentally wraps it in code fences or adds prose, we still want to extract
 * the inner object. Returns null on any failure.
 */
function parseGemmaJSON(modelResponse: string | undefined | null): Record<string, unknown> | null {
  if (!modelResponse) return null;
  const trimmed = modelResponse.trim();
  if (!trimmed) return null;

  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(trimmed.slice(start, end + 1));
  }
  return null;
}

function severityFromMetrics(
  facialStress: number,
  spectralFlux: number,
  pitchEscalation: number,
): "low" | "moderate" | "high" | "critical" {
  const composite = facialStress * 0.5 + clamp01(spectralFlux * 8) * 0.25 + clamp01(pitchEscalation) * 0.25;
  if (composite >= 0.75) return "critical";
  if (composite >= 0.55) return "high";
  if (composite >= 0.3) return "moderate";
  return "low";
}

function dominantExpression(facial: {
  facial_stress_score: number;
  brow_furrow_score: number;
  jaw_tightness_score: number;
}) {
  const map: Array<[string, number]> = [
    ["browInnerUp", facial.brow_furrow_score],
    ["jawClench", facial.jaw_tightness_score],
    ["composite", facial.facial_stress_score],
  ];
  map.sort((a, b) => b[1] - a[1]);
  const [a, b] = [map[0], map[1]];
  return `${a[0]} + ${b[0]}`;
}
