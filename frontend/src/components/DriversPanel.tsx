import type { AnalyzeResponse } from "../api";
import { taxonColor } from "../api";
import { PanelHeader } from "./PanelHeader";
import { HELP } from "../helpContent";

// Top microbes pushing the classification, each with a signed contribution bar
// and a plain-language explanation the presenter can read aloud verbatim.
export function DriversPanel({ result }: { result: AnalyzeResponse }) {
  const maxAbs = Math.max(
    ...result.drivers.map((d) => Math.abs(d.contribution)),
    1e-6
  );

  return (
    <div className="card animate-rise">
      <PanelHeader
        title="What is driving this call"
        subtitle="Each taxon's exact contribution to the verdict, strongest first."
        help={HELP.drivers}
        helpTitle="Drivers"
      />

      <ul className="space-y-4">
        {result.drivers.map((d) => {
          const towardDys = d.direction === "toward_dysbiotic";
          const near = d.vs_reference === "near";
          const color = near ? "#94a3b8" : towardDys ? "#fb7185" : "#2dd4bf";
          const widthPct = (Math.abs(d.contribution) / maxAbs) * 100;
          const pillText = near
            ? "at reference"
            : towardDys
              ? "\u2191 toward dysbiotic"
              : "\u2193 toward healthy";
          return (
            <li key={d.taxon}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold text-white">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: taxonColor(d.taxon) }}
                    aria-hidden
                  />
                  {d.taxon}
                </span>
                <span
                  className="pill shrink-0 text-xs"
                  style={{ color, background: `${color}26` }}
                >
                  {pillText}
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${widthPct}%`, background: color }}
                />
              </div>
              <p className="mt-1.5 text-sm leading-snug text-white/65">
                {d.explanation}
              </p>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/40">
        Bars sum to the log-odds gap between this sample and the healthy
        reference. Aggregated &ldquo;Other&rdquo; is excluded, since a mixture of
        unrelated taxa is not an interpretable driver.
      </p>
    </div>
  );
}
