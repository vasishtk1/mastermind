import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import type { EvalCaseResult, EvalSummary } from "@/lib/ember-types";
import { DeviceGroundingCard, DeviceGroundingCardHeader } from "@/components/audit/DeviceGroundingCard";

const API_BASE = "http://localhost:8000";

async function fetchLatestEvals(): Promise<EvalSummary | null> {
  const res = await fetch(`${API_BASE}/api/evals/latest`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function triggerEvalRun(): Promise<EvalSummary> {
  const res = await fetch(`${API_BASE}/api/evals/run`, { method: "POST" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Eval run failed: ${res.status} ${detail}`);
  }
  return res.json();
}

const verdictTone = (verdict: string): "pass" | "warn" | "fail" => {
  if (verdict.startsWith("PASS")) return "pass";
  if (verdict.startsWith("WARNING")) return "warn";
  return "fail";
};

const toneClass = (tone: "pass" | "warn" | "fail") =>
  tone === "pass"
    ? "bg-primary/10 text-primary border-primary/40"
    : tone === "warn"
    ? "bg-primary-glow/15 text-primary border-primary-glow/45"
    : "bg-danger/10 text-danger border-danger/40";

const passBadgeClass =
  "bg-safe/25 text-warning border-safe/55";

const toneIcon = (tone: "pass" | "warn" | "fail") =>
  tone === "pass" ? CheckCircle2 : tone === "warn" ? AlertTriangle : XCircle;

const formatDialect = (d: string) =>
  d
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

/** Severity display: crisis-level vs moderate (for scripted eval scores 0–10). */
function severityVisual(score: number | null, expectedHigh: boolean) {
  if (score === null) {
    return { className: "text-muted-foreground", badge: null as string | null };
  }
  if (score > 8.0 || (expectedHigh && score >= 7.0)) {
    return {
      className: "text-destructive font-bold tabular-nums",
      badge: "HIGH",
    };
  }
  if (score >= 4) {
    return { className: "text-primary font-semibold tabular-nums", badge: "MOD" };
  }
  return { className: "text-muted-foreground tabular-nums", badge: "LOW" };
}

const sectionHardware =
  "rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm";
const sectionLlm =
  "rounded-xl border border-border bg-card/70 p-6 space-y-6 shadow-sm";

/** RAG evaluation + device grounding — lives under MasterMind Research Lab. */
export function EvalAuditContent() {
  const [data, setData] = useState<EvalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noRunsYet, setNoRunsYet] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNoRunsYet(false);
    try {
      const result = await fetchLatestEvals();
      if (result === null) {
        setNoRunsYet(true);
      } else {
        setData(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    setNoRunsYet(false);
    try {
      setData(await triggerEvalRun());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-background">
      <header className="shrink-0 px-6 py-4 border-b border-border flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground">
            <ShieldCheck className="w-4 h-4 text-primary" />
            RAG evaluation &amp; safety checks
          </h2>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Two separate checks: <span className="text-foreground/90">hardware sanity</span> (field audio aggregates) vs{" "}
            <span className="text-foreground/90">LLM stress test</span> (scripted transcripts through Gemini).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing || loading}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-semibold flex items-center gap-2 border transition-colors shrink-0",
            "bg-surface-elevated border-border text-foreground hover:border-primary/60",
            (refreshing || loading) && "opacity-60 cursor-not-allowed",
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          {refreshing ? "Running harness…" : "Run / refresh stress test"}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-8">
        <ReviewerBrief />

        {import.meta.env.VITE_CONVEX_URL && (
          <section className={sectionHardware} aria-labelledby="hardware-sanity-heading">
            <h3 id="hardware-sanity-heading" className="text-base font-semibold text-foreground tracking-tight">
              Hardware sanity check (Convex)
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
              Averages from real pocket-device uploads. Confirms microphones are producing plausible numbers —{" "}
              <strong className="text-foreground/90">not</strong> an LLM grade.
            </p>
            <DeviceGroundingCardHeader />
            <DeviceGroundingCard />
          </section>
        )}

        {loading && !data && <LoadingSkeleton />}

        {!loading && noRunsYet && (
          <section className={sectionLlm}>
            <div className="flex flex-col items-center justify-center gap-4 text-center py-8">
              <ShieldCheck className="w-10 h-10 text-muted-foreground/40" />
              <div>
                <div className="text-sm font-semibold text-foreground">No LLM stress-test run yet</div>
                <div className="text-xs text-muted-foreground mt-1 max-w-md">
                  Press <span className="text-primary font-semibold">Run / refresh stress test</span> to send{" "}
                  <strong>10 scripted conversations</strong> through the RAG pipeline (~30–60s).
                </div>
              </div>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className={cn(
                  "rounded-md px-5 py-2.5 text-sm font-semibold flex items-center gap-2 border transition-colors",
                  "bg-primary text-primary-foreground border-primary hover:bg-primary-glow glow-teal",
                  refreshing && "opacity-60 cursor-not-allowed",
                )}
              >
                <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
                {refreshing ? "Running…" : "Run first evaluation"}
              </button>
            </div>
          </section>
        )}

        {error && (
          <div className="panel p-4 flex items-start gap-3 border-danger/40">
            <AlertTriangle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-danger">Could not reach the evaluation API</div>
              <div className="text-xs text-muted-foreground mt-1">{error}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Start the backend on <span className="mono">localhost:8000</span> and set{" "}
                <span className="mono">GEMINI_API_KEY</span> in <span className="mono">backend/.env</span>.
              </div>
            </div>
          </div>
        )}

        {data && (
          <section className={sectionLlm} aria-labelledby="llm-stress-heading">
            <h3 id="llm-stress-heading" className="text-base font-semibold text-foreground tracking-tight">
              LLM RAG stress test
            </h3>
            <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed">
              Scripted transcripts only. Gemini produces the same structured clinical reports as production; scores measure crisis
              detection, dialect fairness, and run health.
            </p>
            <AuditDashboard data={data} refreshing={refreshing} />
          </section>
        )}
      </div>
    </div>
  );
}

function ReviewerBrief() {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/[0.06] p-4 space-y-2">
      <p className="text-sm font-semibold text-foreground">What this tab proves (for reviewers)</p>
      <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside leading-relaxed">
        <li>
          <span className="text-foreground/90 font-medium">Hardware block</span> — Field audio feature bands (Convex).
        </li>
        <li>
          <span className="text-foreground/90 font-medium">LLM block</span> — Gemini RAG on fake transcripts + pass/fail scorecards.
        </li>
        <li>
          <span className="text-foreground/90 font-medium">Same lab</span> — Neuroscience profiles live on the sibling tab in{" "}
          <strong className="text-foreground">MasterMind Research Lab</strong>.
        </li>
      </ol>
    </div>
  );
}

const AuditDashboard = ({ data, refreshing }: { data: EvalSummary; refreshing: boolean }) => {
  const utilityTone = verdictTone(data.utility_verdict);
  const fairnessTone = verdictTone(data.fairness_verdict);
  const coverageTone = data.failed_cases === 0 ? "pass" : data.failed_cases <= 1 ? "warn" : "fail";
  const richnessTone = verdictTone(data.fairness_verdict);

  return (
    <div className={cn("space-y-6 transition-opacity", refreshing && "opacity-60")}>
      <RunMetadataBar data={data} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ScoreCard
          label="Summary richness"
          metric={`${data.overall_mean_quality.toFixed(2)} ± ${data.overall_std_dev.toFixed(2)}`}
          sublabel="Average depth of AI-written summaries across all dialects (internal richness proxy)."
          tone={richnessTone}
          verdict={`Typical summary depth is ${data.overall_mean_quality.toFixed(1)} on this proxy; use the fairness card for cross-dialect spread.`}
        />
        <ScoreCard
          label="Crisis detection"
          metric={`${(data.utility_precision_at_high * 100).toFixed(0)}%`}
          sublabel={`Scripted crises caught: ${data.correctly_flagged_high} / ${data.expected_high_count} expected high-severity.`}
          tone={utilityTone}
          verdict={data.utility_verdict}
        />
        <ScoreCard
          label="Fairness (dialect spread)"
          metric={data.fairness_coefficient_of_variation.toFixed(3)}
          sublabel="Lower is better — how much summary richness varies by speaking style (target under 0.20)."
          tone={fairnessTone}
          verdict={data.fairness_verdict}
        />
        <ScoreCard
          label="Stress test finished"
          metric={`${data.completed_cases}/${data.dataset_size}`}
          sublabel={`Parse/API failures: ${data.failed_cases} · ${data.model}`}
          tone={coverageTone}
          verdict={
            data.failed_cases === 0
              ? "PASS — Every scripted case returned a parsed report."
              : `WARNING — ${data.failed_cases} case(s) errored before scoring.`
          }
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <FairnessMatrixPanel data={data} />
        <UtilityBreakdownPanel data={data} />
      </div>

      <CaseTable cases={data.case_results} />
    </div>
  );
};

const RunMetadataBar = ({ data }: { data: EvalSummary }) => {
  const generated = new Date(data.generated_at);
  return (
    <div className="rounded-lg border border-border bg-card/60 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
      <Meta icon={Database} label="Test set" value={`${data.dataset_size} synthetic scripts`} />
      <Meta icon={Sparkles} label="LLM" value={data.model} />
      <Meta icon={Activity} label="Last run" value={generated.toLocaleString()} />
    </div>
  );
};

const Meta = ({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) => (
  <div className="flex items-center gap-2">
    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
    <span className="label-tiny">{label}</span>
    <span className="mono text-foreground">{value}</span>
  </div>
);

const ScoreCard = ({
  label,
  metric,
  sublabel,
  tone,
  verdict,
}: {
  label: string;
  metric: string;
  sublabel: string;
  tone: "pass" | "warn" | "fail";
  verdict: string;
}) => {
  const Icon = toneIcon(tone);
  const isPass = tone === "pass";
  return (
    <div
      className={cn(
        "rounded-xl border p-5 space-y-2 flex flex-col min-h-[180px]",
        isPass
          ? "border-safe/45 bg-safe/10 shadow-[0_0_0_1px_hsl(var(--safe)/0.18)]"
          : "border-border bg-card/80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-snug">{label}</div>
        <div
          className={cn(
            "flex items-center gap-1 mono text-[10px] tracking-widest px-2 py-0.5 rounded-md border shrink-0",
            isPass ? passBadgeClass : toneClass(tone),
          )}
        >
          <Icon className="w-3 h-3" />
          {tone.toUpperCase()}
        </div>
      </div>
      <div
        className={cn(
          "mono text-4xl font-bold tracking-tight flex-1 flex items-center",
          isPass ? "text-warning" : "text-foreground",
        )}
      >
        {metric}
      </div>
      <p className="text-sm text-muted-foreground leading-snug">{sublabel}</p>
      <p className="text-sm text-muted-foreground/90 border-t border-border/60 pt-2 mt-1 leading-relaxed">{verdict}</p>
    </div>
  );
};

type ChartDatum = {
  dialect: string;
  meanQuality: number;
  stdDev: number;
  sampleSize: number;
};

const FairnessMatrixPanel = ({ data }: { data: EvalSummary }) => {
  const chartData: ChartDatum[] = useMemo(
    () =>
      data.dialect_breakdown.map((d) => ({
        dialect: formatDialect(d.dialect),
        meanQuality: d.mean_quality,
        stdDev: d.std_dev,
        sampleSize: d.sample_size,
      })),
    [data.dialect_breakdown],
  );

  const overallMean = data.overall_mean_quality;
  const cv = data.fairness_coefficient_of_variation;

  return (
    <div className="panel p-5 xl:col-span-3 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Dialect fairness chart</div>
          <div className="text-xs text-muted-foreground mt-1 max-w-xl leading-relaxed">
            Bar height = summary richness by speaking-style group. Similar heights → more equitable detail.
          </div>
        </div>
        <div
          className={cn(
            "mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm border self-start shrink-0",
            toneClass(verdictTone(data.fairness_verdict)),
          )}
        >
          Spread (CV) {cv.toFixed(3)}
        </div>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 6" vertical={false} />
            <XAxis
              dataKey="dialect"
              stroke="hsl(var(--muted-foreground))"
              tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
              tickLine={false}
              axisLine={{ stroke: "hsl(var(--border))" }}
              interval={0}
              angle={-15}
              textAnchor="end"
              height={60}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
              tickLine={false}
              axisLine={{ stroke: "hsl(var(--border))" }}
              label={{
                value: "Summary richness score",
                angle: -90,
                position: "insideLeft",
                fontSize: 10,
                fill: "hsl(var(--muted-foreground))",
              }}
            />
            <RechartsTooltip
              cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 11,
              }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number, name) => {
                if (name === "meanQuality") return [value.toFixed(2), "Mean richness"];
                return [value, name];
              }}
            />
            <ReferenceLine
              y={overallMean}
              stroke="hsl(var(--primary))"
              strokeDasharray="4 4"
              label={{ value: `avg ${overallMean.toFixed(2)}`, position: "right", fontSize: 10, fill: "hsl(var(--primary))" }}
            />
            <Bar dataKey="meanQuality" radius={[4, 4, 0, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.dialect} fill="hsl(var(--primary) / 0.85)" />
              ))}
              <ErrorBar dataKey="stdDev" width={6} stroke="hsl(var(--muted-foreground))" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 pt-2">
        {data.dialect_breakdown.map((d) => (
          <div key={d.dialect} className="bg-surface-elevated border border-border rounded-md p-3">
            <div className="label-tiny truncate" title={formatDialect(d.dialect)}>
              {formatDialect(d.dialect)}
            </div>
            <div className="mono text-base font-bold text-foreground mt-1">{d.mean_quality.toFixed(2)}</div>
            <div className="mono text-[10px] text-muted-foreground">
              variability ±{d.std_dev.toFixed(2)} · n={d.sample_size}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const UtilityBreakdownPanel = ({ data }: { data: EvalSummary }) => {
  const highCases = data.case_results.filter((c) => c.expected_high);
  const stats = useMemo(() => {
    const flagged = highCases.filter((c) => c.is_high).length;
    const missed = highCases.length - flagged;
    return { flagged, missed, total: highCases.length };
  }, [highCases]);

  return (
    <div className="panel p-5 xl:col-span-2 space-y-4">
      <div>
        <div className="text-sm font-semibold">Crisis scripts — severity scores</div>
        <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Expected-high cases should land in the red zone (severity &gt; 8 or flagged high). Miss = safety failure for this demo.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Pill tone="pass" label={`${stats.flagged} caught`} />
        <Pill tone={stats.missed === 0 ? "pass" : "fail"} label={`${stats.missed} missed`} />
        <Pill tone="warn" label={`${stats.total} crisis scripts`} />
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {highCases.map((c) => {
          const pass = c.is_high;
          const vis = severityVisual(c.severity_score, true);
          return (
            <div
              key={c.patient_id}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2",
                pass ? "bg-surface-elevated border-border" : "bg-danger/10 border-danger/40",
              )}
            >
              <div
                className={cn(
                  "mono text-[10px] tracking-widest px-1.5 py-0.5 rounded-sm border",
                  pass ? "bg-primary/15 text-primary border-primary/40" : "bg-danger/15 text-danger border-danger/40",
                )}
              >
                {pass ? "OK" : "MISS"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="mono text-xs text-foreground">{c.patient_id}</div>
                <div className="text-[11px] text-muted-foreground truncate">{formatDialect(c.dialect)}</div>
              </div>
              <div className="text-right">
                <div className={cn("mono text-sm", vis.className)}>
                  {c.severity_score !== null ? c.severity_score.toFixed(1) : "—"}
                  {vis.badge && (
                    <span className="ml-1.5 text-[9px] uppercase text-muted-foreground font-normal">({vis.badge})</span>
                  )}
                </div>
                <div className="mono text-[10px] text-muted-foreground">/ 10</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function NoteCell({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 120 || text.includes("\n");

  return (
    <td className="py-2 pr-4 max-w-[min(28rem,40vw)] align-top">
      <button
        type="button"
        onClick={() => long && setOpen((o) => !o)}
        title={long ? (open ? "Click to collapse" : "Click to expand full note") : undefined}
        className={cn(
          "text-left w-full text-muted-foreground hover:text-foreground/90 transition-colors",
          !open && long && "line-clamp-2",
          long && "cursor-pointer",
        )}
      >
        {text}
      </button>
    </td>
  );
}

const CaseTable = ({ cases }: { cases: EvalCaseResult[] }) => {
  return (
    <div className="panel p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Full run log</div>
          <div className="text-xs text-muted-foreground mt-1">One row per scripted case. Notes clamp to two lines — click to expand.</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs table-fixed">
          <thead>
            <tr className="text-left label-tiny border-b border-border">
              <th className="py-2 pr-3 font-normal w-[7rem]">Case id</th>
              <th className="py-2 pr-3 font-normal w-[8rem]">Speaking style</th>
              <th className="py-2 pr-3 font-normal w-[5rem]">Expected</th>
              <th className="py-2 pr-3 font-normal text-right w-[7rem]">Severity</th>
              <th className="py-2 pr-3 font-normal text-right w-[5rem]">Richness</th>
              <th className="py-2 pr-3 font-normal w-[4.5rem]">Result</th>
              <th className="py-2 pr-2 font-normal min-w-0">Notes</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const pass = c.error ? false : c.correctly_flagged;
              const note = c.error ?? c.summary_excerpt ?? "—";
              const vis = severityVisual(c.severity_score, c.expected_high);
              return (
                <tr key={`${c.patient_id}-${c.dialect}`} className="border-b border-border/60 last:border-0 align-top">
                  <td className="py-2 pr-3 mono text-foreground truncate">{c.patient_id}</td>
                  <td className="py-2 pr-3 text-muted-foreground truncate">{formatDialect(c.dialect)}</td>
                  <td className="py-2 pr-3 mono text-muted-foreground">{c.expected_high ? "HIGH" : "≤ MOD"}</td>
                  <td className="py-2 pr-3 text-right">
                    <span className={cn("mono inline-flex flex-col items-end gap-0.5", vis.className)}>
                      <span>
                        {c.severity_score !== null ? c.severity_score.toFixed(1) : "—"}
                        {vis.badge && c.severity_score !== null && (
                          <span
                            className={cn(
                              "ml-1.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                              vis.badge === "HIGH" && "bg-destructive/15 text-destructive",
                              vis.badge === "MOD" && "bg-primary/15 text-primary",
                              vis.badge === "LOW" && "bg-muted text-muted-foreground",
                            )}
                          >
                            {vis.badge}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="py-2 pr-3 mono text-foreground text-right">
                    {c.quality !== null ? c.quality.toFixed(0) : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={cn(
                        "mono text-[10px] tracking-widest px-1.5 py-0.5 rounded-sm border",
                        pass ? "bg-primary/15 text-primary border-primary/40" : "bg-danger/15 text-danger border-danger/40",
                      )}
                    >
                      {c.error ? "ERROR" : pass ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <NoteCell text={note} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Pill = ({ tone, label }: { tone: "pass" | "warn" | "fail"; label: string }) => (
  <div className={cn("mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm border", toneClass(tone))}>
    {label}
  </div>
);

const LoadingSkeleton = () => (
  <div className="space-y-4">
    <div className="rounded-xl border border-border p-5 h-16 animate-pulse bg-card/50" />
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-border p-5 h-44 animate-pulse bg-card/50" />
      ))}
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
      <div className="panel p-5 h-96 xl:col-span-3 animate-pulse" />
      <div className="panel p-5 h-96 xl:col-span-2 animate-pulse" />
    </div>
  </div>
);
