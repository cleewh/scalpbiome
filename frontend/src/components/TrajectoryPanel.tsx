import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrajectoryResponse } from "../api";
import { PanelHeader } from "./PanelHeader";
import { HELP } from "../helpContent";

/**
 * P(dysbiotic) along a path from the current sample to the healthy reference.
 *
 * The path is a geodesic in Aitchison geometry (linear interpolation of CLR
 * coordinates), so every intermediate point is a valid composition and ratios
 * move smoothly rather than being blended arithmetically.
 */
export function TrajectoryPanel({
  trajectory,
}: {
  trajectory: TrajectoryResponse;
}) {
  const data = trajectory.path.map((p) => ({
    fraction: Math.round(p.fraction * 100),
    prob: Number((p.prob_dysbiotic * 100).toFixed(1)),
  }));

  const crossPct =
    trajectory.crosses_at === null ? null : Math.round(trajectory.crosses_at * 100);
  const crossPoint =
    crossPct === null ? null : data.find((d) => d.fraction === crossPct) ?? null;

  return (
    <div className="card animate-rise">
      <PanelHeader
        title="Recovery trajectory"
        subtitle="Probability of dysbiosis as the community is shifted toward the healthy reference."
        help={HELP.trajectory}
        helpTitle="Simulated trajectory"
        right={
          crossPct !== null ? (
            <span className="shrink-0 rounded-full bg-healthy/15 px-2.5 py-1 text-[11px] font-semibold text-healthy">
              crosses at {crossPct}%
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-white/45">
              no crossing
            </span>
          )
        }
      />

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 14, left: 0 }}
          >
            <defs>
              <linearGradient id="trajFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fb7185" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0.25} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="fraction"
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              stroke="rgba(255,255,255,0.15)"
              label={{
                value: "% of the way to the healthy reference",
                position: "insideBottom",
                offset: -6,
                fill: "#64748b",
                fontSize: 10,
              }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              stroke="rgba(255,255,255,0.15)"
              label={{
                value: "P(dysbiotic) %",
                angle: -90,
                position: "insideLeft",
                fill: "#64748b",
                fontSize: 10,
              }}
            />
            {/* The decision boundary. */}
            <ReferenceLine
              y={50}
              stroke="#e2e8f0"
              strokeDasharray="4 3"
              label={{
                value: "decision boundary",
                position: "insideTopRight",
                fill: "#e2e8f0",
                fontSize: 10,
              }}
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
              formatter={(v: number) => [`${v}%`, "P(dysbiotic)"]}
              labelFormatter={(l) => `${l}% toward healthy`}
            />
            <Area
              type="monotone"
              dataKey="prob"
              stroke="#fbbf24"
              strokeWidth={2.5}
              fill="url(#trajFill)"
              isAnimationActive={false}
            />
            {crossPoint && (
              <ReferenceDot
                x={crossPoint.fraction}
                y={crossPoint.prob}
                r={5}
                fill="#fbbf24"
                stroke="#ffffff"
                strokeWidth={2}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-1 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/45">
        The path is a geodesic in Aitchison geometry, so each step is a weighted
        geometric mean of the endpoints and stays a valid composition. This is a
        simulated direction of travel, <span className="font-semibold">not</span>{" "}
        longitudinal data, and it does not model any specific treatment.
      </p>
    </div>
  );
}
