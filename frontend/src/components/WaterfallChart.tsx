import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyzeResponse } from "../api";
import { PanelHeader } from "./PanelHeader";
import { HELP } from "../helpContent";

/**
 * Exact log-odds waterfall from the healthy reference to this sample.
 *
 * Rendered as a floating bar per taxon: each bar starts where the previous one
 * ended, so the chart walks from the reference log-odds to the sample's. Because
 * the decomposition is exact and every taxon is included, the last bar lands
 * exactly on the sample's log-odds with no plug figure. The residual is shown so
 * that claim is checkable rather than asserted.
 */
export function WaterfallChart({ result }: { result: AnalyzeResponse }) {
  const w = result.waterfall;

  // Floating bars: [start, end] pairs. Recharts renders a two-element array
  // value as a bar spanning that range.
  let cursor = w.base_logit;
  const data = w.steps.map((s) => {
    const start = cursor;
    const end = s.cumulative_logit;
    cursor = end;
    return {
      taxon: s.taxon,
      range: [start, end] as [number, number],
      contribution: s.contribution,
      cumulative_prob: s.cumulative_prob,
      abundance: s.abundance,
      reference: s.reference,
      toward: s.direction === "toward_dysbiotic",
    };
  });

  const decisionCrossing = 0; // log-odds 0 == P(dysbiotic) 0.5

  return (
    <div className="card animate-rise">
      <PanelHeader
        title="Log-odds waterfall"
        subtitle="How each taxon moves the call from the healthy reference to this sample."
        help={HELP.waterfall}
        helpTitle="Exact decomposition"
        right={
          <span className="shrink-0 font-mono text-[11px] text-white/45">
            residual {w.residual.toExponential(1)}
          </span>
        }
      />

      <div className="mb-2 flex items-baseline justify-between text-xs">
        <span className="text-white/55">
          reference{" "}
          <span className="font-mono text-white/80">
            {w.base_logit.toFixed(2)}
          </span>{" "}
          ({(w.base_prob * 100).toFixed(1)}%)
        </span>
        <span className="text-white/55">
          sample{" "}
          <span
            className={`font-mono font-semibold ${
              result.label === "Healthy" ? "text-healthy" : "text-dysbiotic"
            }`}
          >
            {w.final_logit.toFixed(2)}
          </span>{" "}
          ({(w.final_prob * 100).toFixed(1)}%)
        </span>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 12, bottom: 4, left: 8 }}
          >
            <XAxis
              type="number"
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              stroke="rgba(255,255,255,0.15)"
              label={{
                value: "dysbiosis log-odds",
                position: "insideBottom",
                offset: -2,
                fill: "#64748b",
                fontSize: 10,
              }}
            />
            <YAxis
              type="category"
              dataKey="taxon"
              width={104}
              tick={{ fill: "#cbd5e1", fontSize: 10 }}
              stroke="rgba(255,255,255,0.15)"
            />
            {/* P(dysbiotic) = 0.5 lives at log-odds 0: the decision boundary. */}
            <ReferenceLine
              x={decisionCrossing}
              stroke="#e2e8f0"
              strokeDasharray="4 3"
              label={{
                value: "50%",
                position: "top",
                fill: "#e2e8f0",
                fontSize: 10,
              }}
            />
            <ReferenceLine x={w.base_logit} stroke="#2dd4bf" strokeOpacity={0.5} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
              contentStyle={{
                background: "#f8fafc",
                border: "1px solid #94a3b8",
                borderRadius: 12,
                color: "#0f172a",
                boxShadow: "0 16px 36px -12px rgba(0,0,0,0.7)",
              }}
              itemStyle={{ color: "#0f172a" }}
              labelStyle={{ color: "#0b1220", fontWeight: 700 }}
              formatter={(_v, _n, item) => {
                const p = item?.payload as (typeof data)[number] | undefined;
                if (!p) return ["", ""];
                return [
                  `${p.contribution >= 0 ? "+" : ""}${p.contribution.toFixed(2)} log-odds` +
                    `  ·  running P(dys) ${(p.cumulative_prob * 100).toFixed(1)}%` +
                    `  ·  ${(p.abundance * 100).toFixed(1)}% vs ref ${(p.reference * 100).toFixed(1)}%`,
                  "contribution",
                ];
              }}
            />
            <Bar dataKey="range" radius={3} isAnimationActive={false}>
              {data.map((d) => (
                <Cell
                  key={d.taxon}
                  fill={d.toward ? "#fb7185" : "#2dd4bf"}
                  fillOpacity={Math.abs(d.contribution) < 0.05 ? 0.3 : 0.95}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/45">
        Each bar starts where the previous one ended. Terms sum to the log-odds
        gap exactly, so the last bar lands on the sample&rsquo;s value with no
        plug figure. This is the model&rsquo;s own arithmetic, not a SHAP-style
        approximation.
      </p>
    </div>
  );
}
