import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { AnalyzeResponse } from "../api";
import { PanelHeader } from "./PanelHeader";
import { HELP } from "../helpContent";

// Radar chart overlaying this sample against the healthy reference profile, so
// deviations across all taxa are visible in one shape.
export function ReferenceRadar({ result }: { result: AnalyzeResponse }) {
  // Plotted as a ratio to the healthy reference, not as raw percentages.
  //
  // Raw percentages do not work on a radar here: Cutibacterium sits near 50%
  // while six taxa sit below 5%, so a single axis dominates and the chart
  // collapses into one spike. Ratios put every taxon on the same footing, and
  // the reference becomes a circle at 1.0, so any departure from it is the
  // signal. This is a fold-change view, which is also how these comparisons are
  // normally reported.
  const CAP = 3; // keep one extreme taxon from flattening the rest
  const data = result.radar.map((r) => ({
    taxon: r.taxon,
    ratio:
      r.healthy > 0
        ? Number(Math.min(r.sample / r.healthy, CAP).toFixed(2))
        : 0,
    reference: 1,
    samplePct: Number((r.sample * 100).toFixed(1)),
    healthyPct: Number((r.healthy * 100).toFixed(1)),
  }));

  return (
    <div className="card animate-rise">
      <PanelHeader
        title="Sample vs healthy reference"
        subtitle="Each taxon as a fold change on the reference. The teal circle is 1.0, so bulges are excess and dents are depletion."
        help={HELP.radar}
        helpTitle="Reference comparison"
      />

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="70%">
            <PolarGrid stroke="rgba(255,255,255,0.12)" />
            <PolarAngleAxis
              dataKey="taxon"
              tick={{ fill: "#cbd5e1", fontSize: 10 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, CAP]}
              tick={{ fill: "#64748b", fontSize: 9 }}
              stroke="rgba(255,255,255,0.08)"
            />
            {/* The reference is a circle at 1.0, so departures are the signal. */}
            <Radar
              name="Healthy reference (=1)"
              dataKey="reference"
              stroke="#2dd4bf"
              strokeWidth={2}
              fill="#2dd4bf"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            <Radar
              name="This sample"
              dataKey="ratio"
              stroke="#818cf8"
              strokeWidth={2}
              fill="#818cf8"
              fillOpacity={0.35}
              isAnimationActive={false}
            />
            <Tooltip
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
                  `${p.ratio}x reference  (${p.samplePct}% vs ${p.healthyPct}%)`,
                  "fold change",
                ];
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs text-white/60">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden /> This
          sample
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-healthy" aria-hidden />{" "}
          Healthy reference = 1.0
        </span>
      </div>
      <p className="mt-2 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/45">
        Fold change rather than raw percentage: <em>Cutibacterium</em> sits near
        50% while several taxa sit below 5%, so plotting absolute abundance lets
        one axis dominate and hides everything else. Values are capped at 3x.
      </p>
    </div>
  );
}
