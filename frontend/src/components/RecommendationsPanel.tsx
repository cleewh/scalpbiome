import type { AnalyzeResponse } from "../api";
import { PanelHeader } from "./PanelHeader";
import { HELP } from "../helpContent";

// "What would help" — concrete community shifts toward the healthy reference.
export function RecommendationsPanel({ result }: { result: AnalyzeResponse }) {
  return (
    <div className="card animate-rise">
      <PanelHeader
        title="What would help"
        subtitle="The largest harmful gaps from the healthy reference, phrased as shifts that would close them."
        help={HELP.recommendations}
        helpTitle="Suggested shifts"
      />

      {result.recommendations.length === 0 ? (
        <p className="text-sm leading-snug text-white/65">
          Nothing to flag. Every taxon either tracks the healthy reference or
          deviates in a direction that is not harmful, so no corrective shift is
          suggested.
        </p>
      ) : (
        <ul className="space-y-3">
          {result.recommendations.map((r) => {
            const increase = r.action === "increase";
            const color = increase ? "#2dd4bf" : "#fb7185";
            return (
              <li
                key={r.taxon}
                className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  style={{ color, background: `${color}26` }}
                  aria-hidden
                >
                  {increase ? "\u2191" : "\u2193"}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {increase ? "Increase" : "Reduce"} {r.taxon}
                  </p>
                  <p className="text-sm leading-snug text-white/65">{r.message}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/40">
        Descriptive guidance about community composition relative to a healthy
        reference. Not clinical advice, and it says nothing about which treatment
        would achieve the shift.
      </p>
    </div>
  );
}
