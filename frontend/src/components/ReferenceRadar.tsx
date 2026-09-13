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
  const data = result.radar.map((r) => ({
    taxon: r.taxon,
    Sample: Number((r.sample * 100).toFixed(1)),
    Healthy: Number((r.healthy * 100).toFixed(1)),
  }));

  return (
    <div className="card animate-rise">
      <PanelHeader
        title="Sample vs healthy reference"
        subtitle="Two nearly identical shapes mean this sample tracks the healthy profile."
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
              tick={{ fill: "#64748b", fontSize: 10 }}
              stroke="rgba(255,255,255,0.08)"
            />
            <Radar
              name="Healthy reference"
              dataKey="Healthy"
              stroke="#2dd4bf"
              fill="#2dd4bf"
              fillOpacity={0.25}
            />
            <Radar
              name="This sample"
              dataKey="Sample"
              stroke="#818cf8"
              fill="#818cf8"
              fillOpacity={0.35}
            />
            <Tooltip
              formatter={(value: number) => `${value}%`}
              contentStyle={{
                background: "#f8fafc",
                border: "1px solid #94a3b8",
                borderRadius: 12,
                color: "#0f172a",
                boxShadow: "0 16px 36px -12px rgba(0,0,0,0.7)",
              }}
              itemStyle={{ color: "#0f172a" }}
              labelStyle={{ color: "#0b1220", fontWeight: 700 }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex justify-center gap-6 text-xs text-white/60">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden /> This
          sample
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-healthy" aria-hidden />{" "}
          Healthy reference
        </span>
      </div>
    </div>
  );
}
