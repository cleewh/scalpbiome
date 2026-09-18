import { useEffect, useMemo, useRef, useState } from "react";
import { taxonColor, type AnalyzeResponse, type TaxonInfo } from "../api";
import { PanelHeader } from "./PanelHeader";
import { HELP } from "../helpContent";

interface Props {
  /** Composition the sliders start from, as {taxon: fraction}. */
  baseline: Record<string, number>;
  /** Label of the profile the baseline came from. */
  baselineName: string;
  taxa: TaxonInfo[];
  /** Called (debounced) whenever the edited composition changes. */
  onChange: (abundances: Record<string, number>, dirty: boolean) => void;
  /** Live result, used to mirror the verdict next to the controls. */
  result: AnalyzeResponse | null;
  busy: boolean;
}

// Taxa worth exposing as sliders: the ones that carry signal. Aggregated "Other"
// is excluded because dragging a bucket of unrelated taxa is not a meaningful
// experiment.
const SLIDER_TAXA = [
  "Cutibacterium",
  "S. epidermidis",
  "S. capitis",
  "M. restricta",
  "M. globosa",
];

const DEBOUNCE_MS = 140;

/**
 * Live "what-if" controls.
 *
 * Dragging a taxon rescales the others proportionally so the composition still
 * sums to 1. That is the honest way to do it: abundances are compositional, so
 * one taxon cannot rise without the rest giving up share. The panel says so
 * explicitly, because the alternative reading (that only the dragged taxon
 * changed) would be wrong.
 *
 * Requests are debounced and superseded via AbortController, so a fast drag does
 * not queue a burst of analyses or let a stale response overwrite a newer one.
 */
export function PerturbationPanel({
  baseline,
  baselineName,
  taxa,
  onChange,
  result,
  busy,
}: Props) {
  const [values, setValues] = useState<Record<string, number>>(baseline);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<number | null>(null);

  // Reset whenever the underlying profile changes (new sample picked/uploaded).
  useEffect(() => {
    setValues(baseline);
    setDirty(false);
  }, [baseline]);

  const meta = useMemo(
    () => Object.fromEntries(taxa.map((t) => [t.name, t])),
    [taxa]
  );

  function emit(next: Record<string, number>, isDirty: boolean) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      onChange(next, isDirty);
    }, DEBOUNCE_MS);
  }

  function setTaxon(taxon: string, pct: number) {
    const target = Math.max(0, Math.min(0.9, pct / 100));
    const current = values[taxon] ?? 0;
    const others = Object.keys(values).filter((k) => k !== taxon);
    const othersTotal = others.reduce((s, k) => s + (values[k] ?? 0), 0);

    const next: Record<string, number> = { [taxon]: target };
    const remaining = 1 - target;
    if (othersTotal <= 0) {
      // Degenerate baseline: spread the remainder evenly.
      others.forEach((k) => (next[k] = remaining / Math.max(1, others.length)));
    } else {
      // Hold the other taxa in their existing proportions.
      const scale = remaining / othersTotal;
      others.forEach((k) => (next[k] = (values[k] ?? 0) * scale));
    }

    setValues(next);
    const isDirty = Math.abs(target - (baseline[taxon] ?? current)) > 1e-6 || dirty;
    setDirty(isDirty);
    emit(next, true);
  }

  function reset() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setValues(baseline);
    setDirty(false);
    onChange(baseline, false);
  }

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const healthy = result?.label === "Healthy";

  return (
    <div className="card animate-rise">
      <PanelHeader
        title="What-if controls"
        subtitle="Drag a taxon and watch the verdict, ratios and drivers update live."
        help={HELP.perturbation}
        helpTitle="Live perturbation"
        right={
          <div className="flex shrink-0 items-center gap-2">
            {dirty && (
              <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                edited
              </span>
            )}
            <button
              type="button"
              onClick={reset}
              disabled={!dirty || busy}
              className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-white/70 transition hover:border-white/35 hover:text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Reset
            </button>
          </div>
        }
      />

      {/* Live verdict mirrored here so the presenter can watch it while dragging,
          without looking away from the controls. */}
      {result && (
        <div
          className={`mb-4 flex items-center justify-between rounded-xl border px-3 py-2 ${
            healthy
              ? "border-healthy/40 bg-healthy/10"
              : "border-dysbiotic/40 bg-dysbiotic/10"
          }`}
        >
          <span
            className={`text-lg font-extrabold ${
              healthy ? "text-healthy" : "text-dysbiotic"
            }`}
          >
            {result.label}
          </span>
          <span className="font-mono text-sm text-white/70">
            P(dys) {(result.prob_dysbiotic * 100).toFixed(1)}%
          </span>
        </div>
      )}

      <div className="space-y-3.5">
        {SLIDER_TAXA.map((taxon) => {
          const pct = (values[taxon] ?? 0) * 100;
          const refPct = (meta[taxon]?.reference ?? 0) * 100;
          const risk = (meta[taxon]?.risk_sign ?? 0) > 0;
          const color = taxonColor(taxon);
          return (
            <div key={taxon}>
              {/*
                Two rows rather than one. At the 300px rail width a single row of
                taxon name + risk badge + value + reference overflowed, and the
                reference figure was clipped off the right edge.
              */}
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor={`slider-${taxon}`}
                  className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-white"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: color }}
                    aria-hidden
                  />
                  <span className="truncate">{taxon}</span>
                </label>
                <span className="shrink-0 font-mono text-sm font-semibold text-white">
                  {pct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    color: risk ? "#fda4af" : "#5eead4",
                    background: risk
                      ? "rgba(251,113,133,0.16)"
                      : "rgba(45,212,191,0.16)",
                  }}
                >
                  {risk ? "risk" : "protective"}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-white/40">
                  ref {refPct.toFixed(1)}%
                </span>
              </div>
              <input
                id={`slider-${taxon}`}
                type="range"
                min={0}
                max={70}
                step={0.5}
                value={Number(pct.toFixed(1))}
                onChange={(e) => setTaxon(taxon, Number(e.target.value))}
                aria-label={`${taxon} relative abundance, currently ${pct.toFixed(1)} percent`}
                className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={{ accentColor: color }}
              />
            </div>
          );
        })}
      </div>

      <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/45">
        Starting from <span className="font-semibold">{baselineName}</span>.
        Abundances are compositional, so raising one taxon rescales the others
        proportionally to keep the total at 100%. The remaining taxa move too, by
        design.
      </p>
    </div>
  );
}
