import type { ReactNode } from "react";
import { formatRatio, type AnalyzeResponse } from "../api";
import { InfoBubble } from "./InfoBubble";
import { HELP } from "../helpContent";

interface Tile {
  label: string;
  value: string;
  /** Always-visible one-line explanation of what the number means. */
  meaning: string;
  /** Healthy-reference value, shown for comparison. */
  reference: string;
  help: ReactNode;
  /** Whether the sample sits on the healthy side of the reference. */
  favourable: boolean | null;
  /** Bubbles on the right-hand tiles align right so they stay on screen. */
  align: "left" | "right";
}

/**
 * Ratio and diversity tiles.
 *
 * The three ratios are the metrics that actually discriminate. Richness was
 * removed: over a fixed nine-taxon vector it barely moves between profiles, and
 * "richness" over nine modelled taxa is not comparable to richness from a real
 * survey that recovers 100+ genera. Shannon stays as descriptive context with an
 * explicit note that it is not a dysbiosis marker.
 */
export function MetricTiles({ result }: { result: AnalyzeResponse }) {
  const m = result.metrics;

  const tiles: Tile[] = [
    {
      label: "Cuti : Staph",
      value: formatRatio(m.cuti_staph),
      meaning: "Higher is healthier. The primary bacterial axis.",
      reference: "healthy ~2.3",
      help: HELP.cutiStaph,
      favourable: m.cuti_staph.value >= 2.0,
      align: "left",
    },
    {
      label: "M. restricta : globosa",
      value: formatRatio(m.restricta_globosa),
      meaning: "Lower is healthier. Carries the fungal signal.",
      reference: "healthy ~1.7",
      help: HELP.restrictaGlobosa,
      favourable: m.restricta_globosa.value <= 2.2,
      align: "left",
    },
    {
      label: "S. epi : capitis",
      value: formatRatio(m.epidermidis_capitis),
      meaning: "Higher is healthier. Protective vs risk species.",
      reference: "healthy ~0.75",
      help: HELP.epidermidisCapitis,
      favourable: m.epidermidis_capitis.value >= 0.55,
      align: "right",
    },
    {
      label: "Shannon",
      value: m.shannon.toFixed(2),
      meaning: `Context only, not a health signal. Evenness ${m.evenness.toFixed(2)}.`,
      reference: "healthy ~1.62",
      help: HELP.shannon,
      favourable: null, // deliberately unscored: see HELP.shannon
      align: "right",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="card animate-rise !p-4">
          <div className="flex items-start justify-between gap-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
              {t.label}
            </p>
            <InfoBubble title={t.label} align={t.align}>
              {t.help}
            </InfoBubble>
          </div>
          <p
            className={`mt-1 text-3xl font-extrabold ${
              t.favourable === null
                ? "text-white"
                : t.favourable
                  ? "text-healthy"
                  : "text-dysbiotic"
            }`}
          >
            {t.value}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-white/55">
            {t.reference}
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-white/45">
            {t.meaning}
          </p>
        </div>
      ))}
    </div>
  );
}
