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
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import type { EvalCaseResult, EvalSummary } from "@/lib/ember-types";

const API_BASE = "http://localhost:8000";

async function fetchLatestEvals(): Promise<EvalSummary> {
  const res = await fetch(`${API_BASE}/api/evals/latest`);
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
    ? "bg-amber-500/10 text-amber-400 border-amber-500/40"
    : "bg-danger/10 text-danger border-danger/40";

const toneIcon = (tone: "pass" | "warn" | "fail") =>
  tone === "pass" ? CheckCircle2 : tone === "warn" ? AlertTriangle : XCircle;

const formatDialect = (d: string) =>
  d
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

const ModelAudit = () => {
  const [data, setData] = useState<EvalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchLatestEvals());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
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
    <div className="h-screen flex flex-col">
      <header className="px-8 py-5 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Model rigor &amp; auditing
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Continuous evaluation of utility, safety, and demographic fairness across the Ember RAG pipeline.
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing || loading}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-semibold flex items-center gap-2 border transition-colors",
            "bg-surface-elevated border-border text-foreground hover:border-primary/60",
            (refreshing || loading) && "opacity-60 cursor-not-allowed",
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          {refreshing ? "Re-running harness…" : "Re-run eval harness"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        {loading && !data && <LoadingSkeleton />}

        {error && (
          <div className="panel p-4 flex items-start gap-3 border-danger/40">
            <AlertTriangle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-semibold text-danger">Failed to load eval summary</div>
              <div className="text-xs text-muted-foreground mt-1">{error}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Confirm the FastAPI server is running on <span className="mono">localhost:8000</span> and that{" "}
                <span className="mono">GEMINI_API_KEY</span> is set.
              </div>
            </div>
          </div>
        )}

        {data && <AuditDashboard data={data} refreshing={refreshing} />}
      </div>
    </div>
  );
};

const AuditDashboard = ({ data, refreshing }: { data: EvalSummary; refreshing: boolean }) => {
  const utilityTone = verdictTone(data.utility_verdict);
  const fairnessTone = verdictTone(data.fairness_verdict);

  return (
    <div className={cn("space-y-6 transition-opacity", refreshing && "opacity-60")}>
      <RunMetadataBar data={data} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ScoreCard
          label="System utility score"
          metric={`${(data.utility_precision_at_high * 100).toFixed(0)}%`}
          sublabel={`Precision @ HIGH severity · ${data.correctly_flagged_high}/${data.expected_high_count} correctly flagged`}
          tone={utilityTone}
          verdict={data.utility_verdict}
        />
        <ScoreCard
          label="Fairness coefficient"
          metric={data.fairness_coefficient_of_variation.toFixed(3)}
          sublabel={`Cross-dialect quality CV · target < 0.20`}
          tone={fairnessTone}
          verdict={data.fairness_verdict}
        />
        <ScoreCard
          label="Coverage"
          metric={`${data.completed_cases}/${data.dataset_size}`}
          sublabel={`${data.failed_cases} failure(s) · model ${data.model}`}
          tone={data.failed_cases === 0 ? "pass" : data.failed_cases <= 1 ? "warn" : "fail"}
          verdict={
            data.failed_cases === 0
              ? "PASS — All cases completed without pipeline error."
              : `WARNING — ${data.failed_cases} case(s) failed during execution.`
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
    <div className="panel px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
      <Meta icon={Database} label="Dataset" value={`${data.dataset_size} synthetic events`} />
      <Meta icon={Sparkles} label="Model" value={data.model} />
      <Meta icon={Activity} label="Generated" value={generated.toLocaleString()} />
      <Meta
        icon={ShieldCheck}
        label="Mean quality"
        value={`${data.overall_mean_quality.toFixed(2)} ± ${data.overall_std_dev.toFixed(2)}`}
      />
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
  return (
    <div className="panel p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="label-tiny">{label}</div>
        <div className={cn("flex items-center gap-1 mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm border", toneClass(tone))}>
          <Icon className="w-3 h-3" />
          {tone.toUpperCase()}
        </div>
      </div>
      <div className="mono text-4xl font-bold text-foreground tracking-tight">{metric}</div>
      <div className="text-xs text-muted-foreground">{sublabel}</div>
      <div className={cn("text-[11px] leading-relaxed border-t border-border pt-3 mt-1", "text-muted-foreground")}>{verdict}</div>
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
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold">Bias &amp; fairness matrix</div>
          <div className="text-xs text-muted-foreground mt-1 max-w-xl">
            Per-dialect mean clinical-summary quality with ±1σ error bars. The reference line marks the
            cross-dialect mean — equal-height bars indicate the model treats every dialect group equivalently.
          </div>
        </div>
        <div className={cn("mono text-[10px] tracking-widest px-2 py-0.5 rounded-sm border self-start", toneClass(verdictTone(data.fairness_verdict)))}>
          CV {cv.toFixed(3)}
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
                value: "Quality (keywords + sentences)",
                angle: -90,
                position: "insideLeft",
                fontSize: 10,
                fill: "hsl(var(--muted-foreground))",
              }}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
                fontSize: 11,
              }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number, name) => {
                if (name === "meanQuality") return [value.toFixed(2), "Mean quality"];
                return [value, name];
              }}
            />
            <ReferenceLine
              y={overallMean}
              stroke="hsl(var(--primary))"
              strokeDasharray="4 4"
              label={{ value: `μ ${overallMean.toFixed(2)}`, position: "right", fontSize: 10, fill: "hsl(var(--primary))" }}
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
              σ {d.std_dev.toFixed(2)} · n={d.sample_size}
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
        <div className="text-sm font-semibold">Utility — Precision @ HIGH</div>
        <div className="text-xs text-muted-foreground mt-1">
          Each row is a synthetic case the rubric expects to be flagged HIGH. A miss is a clinical-safety failure.
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Pill tone="pass" label={`${stats.flagged} flagged`} />
        <Pill tone={stats.missed === 0 ? "pass" : "fail"} label={`${stats.missed} missed`} />
        <Pill tone="warn" label={`${stats.total} expected`} />
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {highCases.map((c) => {
          const pass = c.is_high;
          return (
            <div
              key={c.patient_id}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2",
                pass ? "bg-surface-elevated border-border" : "bg-danger/10 border-danger/40",
              )}
            >
              <div className={cn("mono text-[10px] tracking-widest px-1.5 py-0.5 rounded-sm border", pass ? "bg-primary/15 text-primary border-primary/40" : "bg-danger/15 text-danger border-danger/40")}>
                {pass ? "PASS" : "MISS"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="mono text-xs text-foreground">{c.patient_id}</div>
                <div className="text-[11px] text-muted-foreground truncate">{formatDialect(c.dialect)}</div>
              </div>
              <div className="text-right">
                <div className="mono text-sm font-bold text-foreground">
                  {c.severity_score !== null ? c.severity_score.toFixed(1) : "—"}
                </div>
                <div className="mono text-[10px] text-muted-foreground">/ 10.0</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CaseTable = ({ cases }: { cases: EvalCaseResult[] }) => {
  return (
    <div className="panel p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Case-level audit log</div>
          <div className="text-xs text-muted-foreground mt-1">
            Full per-case rollup of the most recent harness run.
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left label-tiny border-b border-border">
              <th className="py-2 pr-4 font-normal">Patient</th>
              <th className="py-2 pr-4 font-normal">Dialect</th>
              <th className="py-2 pr-4 font-normal">Expected</th>
              <th className="py-2 pr-4 font-normal text-right">Score</th>
              <th className="py-2 pr-4 font-normal text-right">Quality</th>
              <th className="py-2 pr-4 font-normal">Verdict</th>
              <th className="py-2 pr-4 font-normal">Summary excerpt</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const pass = c.error ? false : c.correctly_flagged;
              return (
                <tr key={c.patient_id} className="border-b border-border/60 last:border-0 align-top">
                  <td className="py-2 pr-4 mono text-foreground">{c.patient_id}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{formatDialect(c.dialect)}</td>
                  <td className="py-2 pr-4 mono text-muted-foreground">{c.expected_high ? "HIGH" : "≤ MOD"}</td>
                  <td className="py-2 pr-4 mono text-foreground text-right">
                    {c.severity_score !== null ? c.severity_score.toFixed(1) : "—"}
                  </td>
                  <td className="py-2 pr-4 mono text-foreground text-right">
                    {c.quality !== null ? c.quality.toFixed(0) : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={cn(
                        "mono text-[10px] tracking-widest px-1.5 py-0.5 rounded-sm border",
                        pass ? "bg-primary/15 text-primary border-primary/40" : "bg-danger/15 text-danger border-danger/40",
                      )}
                    >
                      {c.error ? "ERROR" : pass ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground max-w-md">
                    {c.error ?? c.summary_excerpt ?? "—"}
                  </td>
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
    <div className="panel p-5 h-20 animate-pulse" />
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="panel p-5 h-44 animate-pulse" />
      ))}
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
      <div className="panel p-5 h-96 xl:col-span-3 animate-pulse" />
      <div className="panel p-5 h-96 xl:col-span-2 animate-pulse" />
    </div>
  </div>
);

export default ModelAudit;
