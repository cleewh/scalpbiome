import { Area, AreaChart, ReferenceLine, ResponsiveContainer } from "recharts";
import {
  taxonColor,
  type AnalyzeResponse,
  type TrajectoryResponse,
} from "../api";
import { PanelHeader } from "./PanelHeader";
import { HELP } from "../helpContent";

interface Props {
  result: AnalyzeResponse;
  trajectory: TrajectoryResponse;
}

/**
 * Treatment plan: the trajectory expressed as concrete per-taxon targets.
 *
 * This replaced a P(dysbiotic)-versus-path-position chart. That chart was
 * rigorous but asked a viewer to hold two abstractions at once — a synthetic
 * path parameter on one axis and a model probability on the other — before it
 * told them anything actionable.
 *
 * Same underlying computation, reframed around the question people actually
 * have: what has to change, and how far is far enough. The probability curve
 * survives as a sparkline so the quantitative view is still available without
 * dominating the panel.
 *
 * Which taxa appear is taken from the backend's recommendations, so this panel
 * and "What would help" can never disagree about what needs to move.
 */
export function TreatmentPlanPanel({ result, trajectory }: Props) {
  const start = trajectory.path[0];
  const crossing = trajectory.path.find((p) => p.prob_dysbiotic < 0.5) ?? null;
  const alreadyHealthy = result.label === "Healthy";

  // Percentage of the full correction needed to clear the threshold.
  const effortPct =
    crossing && !alreadyHealthy ? Math.round(crossing.fraction * 100) : 0;

  const rows = result.recommendations.map((r) => ({
    taxon: r.taxon,
    action: r.action,
    now: r.current,
    // Target that just clears the threshold, read off the trajectory.
    enough: crossing?.composition[r.taxon] ?? r.target,
    reference: r.target,
  }));

  // Shared scale so bar lengths are comparable between taxa.
  const scaleMax = Math.max(
    ...rows.flatMap((r) => [r.now, r.enough, r.reference]),
    0.1
  );
  const pct = (v: number) => `${(v / scaleMax) * 100}%`;

  const spark = trajectory.path.map((p) => ({
    x: p.fraction * 100,
    y: p.prob_dysbiotic * 100,
  }));

  return (
    <div className="card animate-rise">
      <PanelHeader
        title="Treatment plan"
        subtitle="What has to change, and how far is far enough to leave dysbiosis."
        help={HELP.treatmentPlan}
        helpTitle="Treatment plan"
      />

      {alreadyHealthy || rows.length === 0 ? (
        <p className="text-sm leading-snug text-white/65">
          No corrective plan needed. This community already sits on the healthy
          side of the threshold, and every taxon either tracks the reference or
          deviates in a direction that is not harmful.
        </p>
      ) : (
        <>
          {/* The headline: how much correction is actually required. */}
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <span className="pill bg-dysbiotic/15 text-dysbiotic">
              now &middot; Dysbiotic {(result.prob_dysbiotic * 100).toFixed(0)}%
            </span>
            <span className="text-white/40" aria-hidden>
              &rarr;
            </span>
            <span className="pill bg-healthy/15 text-healthy">
              target &middot; Healthy
            </span>
            <span className="ml-auto text-xs text-white/60">
              needs{" "}
              <span className="text-base font-bold text-white">
                {effortPct}%
              </span>{" "}
              of the full correction
            </span>
          </div>

          {/* Per-taxon plan. */}
          <ul className="space-y-4">
            {rows.map((r) => {
              const increase = r.action === "increase";
              const colour = taxonColor(r.taxon);
              return (
                <li key={r.taxon}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold text-white">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: colour }}
                        aria-hidden
                      />
                      {r.taxon}
                    </span>
                    <span
                      className="pill shrink-0 text-[11px]"
                      style={{
                        color: increase ? "#5eead4" : "#fda4af",
                        background: increase
                          ? "rgba(45,212,191,0.16)"
                          : "rgba(251,113,133,0.16)",
                      }}
                    >
                      {increase ? "\u2191 increase" : "\u2193 reduce"}
                    </span>
                  </div>

                  {/* Two bars: where it is, and where it needs to get to. */}
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-[11px] text-white/45">
                        now
                      </span>
                      <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: pct(r.now), background: `${colour}66` }}
                        />
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] text-white/70">
                        {(r.now * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-[11px] font-semibold text-white/70">
                        target
                      </span>
                      <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: pct(r.enough), background: colour }}
                        />
                        {/* Where the textbook healthy reference sits. */}
                        <span
                          className="absolute inset-y-0 w-0.5 bg-white/70"
                          style={{ left: pct(r.reference) }}
                          aria-hidden
                        />
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] font-semibold text-white">
                        {(r.enough * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] text-white/40">
                    healthy reference {(r.reference * 100).toFixed(1)}%
                    <span className="ml-1 text-white/30">
                      (white marker)
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>

          {/* The quantitative view, demoted to a sparkline. */}
          <div className="mt-5 border-t border-white/10 pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Risk as the plan is applied
              </span>
              <span className="font-mono text-[11px] text-white/50">
                {(start.prob_dysbiotic * 100).toFixed(0)}% &rarr;{" "}
                {(
                  trajectory.path[trajectory.path.length - 1].prob_dysbiotic * 100
                ).toFixed(0)}
                %
              </span>
            </div>
            <div className="mt-1 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={spark}
                  margin={{ top: 4, right: 2, bottom: 0, left: 2 }}
                >
                  <defs>
                    <linearGradient id="planSpark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#fb7185" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0.2} />
                    </linearGradient>
                  </defs>
                  {/* The decision threshold. */}
                  <ReferenceLine
                    y={50}
                    stroke="#e2e8f0"
                    strokeDasharray="3 3"
                    strokeOpacity={0.7}
                  />
                  <ReferenceLine
                    x={effortPct}
                    stroke="#fbbf24"
                    strokeDasharray="3 3"
                  />
                  <Area
                    type="monotone"
                    dataKey="y"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    fill="url(#planSpark)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] leading-snug text-white/40">
              Dysbiosis risk falling as the plan is applied. Grey dashed line is
              the 50% threshold; amber marks where the plan crosses it.
            </p>
          </div>
        </>
      )}

      <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/40">
        Composition targets, not a clinical protocol. Nothing here specifies a
        treatment, and the {effortPct || 0}% figure is a property of this model
        rather than a clinical milestone.
      </p>
    </div>
  );
}
