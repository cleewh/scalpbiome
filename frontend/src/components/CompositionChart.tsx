import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { AnalyzeResponse } from "../api";
import { taxonColor } from "../api";
import { PanelHeader } from "./PanelHeader";
import { HELP } from "../helpContent";

// Donut chart of the sample's community composition. A donut reads cleanly on a
// projector and the centre hole carries the dominant-taxon callout.
export function CompositionChart({ result }: { result: AnalyzeResponse }) {
  const data = result.composition
    .map((c) => ({
      name: c.taxon,
      value: Number((c.abundance * 100).toFixed(1)),
      full: c.full_name,
      kind: c.kind,
    }))
    .filter((d) => d.value > 0);

  const dominant = result.metrics.dominant_taxon;
  const dominantPct = Math.round(
    (result.composition.find((c) => c.taxon === dominant)?.abundance ?? 0) * 100
  );
  const fungalPct = Math.round(result.metrics.fungal_fraction * 100);

  return (
    <div className="card animate-rise">
      <PanelHeader
        title="Community composition"
        subtitle="Share of the community held by each taxon. Centre shows the most abundant."
        help={HELP.composition}
        helpTitle="Composition"
        right={
          <span className="shrink-0 text-xs text-white/45">
            {fungalPct}% fungal
          </span>
        }
      />

      <div className="relative h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={105}
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.name} fill={taxonColor(d.name)} />
              ))}
            </Pie>
            {/* Light tooltip with explicit item/label colours. Recharts falls
                back to black item text when an entry has no colour, which would
                be invisible on a dark surface. */}
            <Tooltip
              formatter={(value: number, _n, item) => {
                const p = item?.payload as { full?: string; kind?: string };
                const suffix = p?.kind === "fungus" ? " (fungus)" : "";
                return [`${value}%`, `${p?.full ?? ""}${suffix}`];
              }}
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
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-10">
          <span className="text-xs uppercase tracking-widest text-white/40">
            Dominant
          </span>
          <span
            className="text-center text-base font-bold leading-tight"
            style={{ color: taxonColor(dominant) }}
          >
            {dominant}
          </span>
          <span className="text-sm text-white/50">{dominantPct}%</span>
        </div>
      </div>
    </div>
  );
}
