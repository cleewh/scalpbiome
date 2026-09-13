import {
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type {
  AnalyzeResponse,
  OrdinationResponse,
  TrajectoryResponse,
} from "../api";
import { PanelHeader } from "./PanelHeader";
import { HELP } from "../helpContent";

interface Props {
  ordination: OrdinationResponse;
  result: AnalyzeResponse;
  trajectory?: TrajectoryResponse | null;
}

/**
 * Aitchison ordination: the synthetic training cohort in log-ratio space, with
 * the current sample placed on top.
 *
 * Euclidean distance here is Aitchison distance, because the axes are principal
 * components of the CLR-transformed data. That is the reason for using CLR rather
 * than raw proportions, and it is why this plot is comparable to the ordinations
 * this audience produces themselves.
 */
export function OrdinationChart({ ordination, result, trajectory }: Props) {
  const healthy = ordination.points.filter((p) => p.label === "Healthy");
  const dysbiotic = ordination.points.filter((p) => p.label === "Dysbiotic");
  const pc1 = Math.round(ordination.explained_variance[0] * 100);
  const pc2 = Math.round(ordination.explained_variance[1] * 100);

  const sample = [{ ...result.ordination, name: result.sample_name }];
  const reference = [{ ...ordination.reference, name: "Healthy reference" }];
  const path = trajectory?.path.map((p) => ({ x: p.x, y: p.y })) ?? [];

  return (
    <div className="card animate-rise">
      <PanelHeader
        title="Aitchison ordination"
        subtitle={`Training cohort in log-ratio space. PC1 ${pc1}% · PC2 ${pc2}% of variance.`}
        help={HELP.ordination}
        helpTitle="Compositional ordination"
      />

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 4 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" />
            <XAxis
              type="number"
              dataKey="x"
              name="PC1"
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              stroke="rgba(255,255,255,0.15)"
              label={{
                value: `PC1 (${pc1}%) — healthy left, dysbiosis right`,
                position: "insideBottom",
                offset: -8,
                fill: "#64748b",
                fontSize: 10,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="PC2"
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              stroke="rgba(255,255,255,0.15)"
              label={{
                value: `PC2 (${pc2}%)`,
                angle: -90,
                position: "insideLeft",
                fill: "#64748b",
                fontSize: 10,
              }}
            />
            <ZAxis range={[36, 36]} />
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
              formatter={(v: number) => v.toFixed(2)}
            />
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }}
            />

            <Scatter
              name="Healthy (training)"
              data={healthy}
              fill="#2dd4bf"
              fillOpacity={0.34}
              isAnimationActive={false}
            />
            <Scatter
              name="Dysbiotic (training)"
              data={dysbiotic}
              fill="#fb7185"
              fillOpacity={0.34}
              isAnimationActive={false}
            />

            {/* Trajectory drawn beneath the markers so it reads as a path. */}
            {path.length > 0 && (
              <Line
                name="Trajectory"
                type="linear"
                data={path}
                dataKey="y"
                stroke="#fbbf24"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                isAnimationActive={false}
                legendType="plainline"
              />
            )}

            <Scatter
              name="Healthy reference"
              data={reference}
              fill="#e2e8f0"
              shape="cross"
              isAnimationActive={false}
            />
            <Scatter
              name="This sample"
              data={sample}
              fill={result.label === "Healthy" ? "#5eead4" : "#fda4af"}
              stroke="#ffffff"
              strokeWidth={2}
              shape="star"
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-1 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/45">
        Distance in this plot is Aitchison distance, the standard metric for
        compositional data. Two axes capture {pc1 + pc2}% of total variance, so
        points that look close may still differ on the components not shown.
      </p>
    </div>
  );
}
