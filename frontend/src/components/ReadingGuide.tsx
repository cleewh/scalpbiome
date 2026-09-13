import { useState } from "react";

interface Entry {
  part: string;
  what: string;
  how: string;
}

/**
 * A visible, always-available walkthrough of every part of the page.
 *
 * The help bubbles carry per-panel depth, but they require a hover or a click to
 * find. This panel puts the same explanations somewhere an audience can read
 * them while the presenter is talking, and gives the presenter a script.
 */
const ENTRIES: Entry[] = [
  {
    part: "Sample profiles",
    what: "Four fixed compositions you can load with one click.",
    how: "Start with Healthy scalp, then Dandruff to watch the ratios and drivers move together.",
  },
  {
    part: "Upload a cohort",
    what: "A CSV or TSV where rows are taxa and columns are samples.",
    how: "Every column becomes its own analysis, shown as a row of chips you can click through.",
  },
  {
    part: "HealthOmics ingest",
    what: "Runs the production S3 reader against an in-process mock.",
    how: "No credentials and no network. Shows the AWS integration is implemented, not sketched.",
  },
  {
    part: "What-if controls",
    what: "Sliders that re-run the whole analysis live.",
    how: "Raising one taxon rescales the others, because abundances always sum to 100%.",
  },
  {
    part: "Log-odds waterfall",
    what: "Each taxon's exact contribution, walking from the reference to this sample.",
    how: "The terms sum to the log-odds gap with no residual. Model arithmetic, not a SHAP estimate.",
  },
  {
    part: "Aitchison ordination",
    what: "The training cohort in log-ratio space, with this sample as a star.",
    how: "Distance here is Aitchison distance. PC1 runs healthy on the left to dysbiosis on the right.",
  },
  {
    part: "Recovery trajectory",
    what: "P(dysbiotic) as the community is shifted toward the healthy reference.",
    how: "A geodesic in Aitchison geometry. Simulated direction of travel, not longitudinal data.",
  },
  {
    part: "Classifier",
    what: "What the model is and how it was checked.",
    how: "The accuracy figure is a pipeline check on synthetic data. It is not validation against sequenced samples.",
  },
  {
    part: "Verdict",
    what: "The Healthy or Dysbiotic call, with the model's probability for it.",
    how: "Confidence measures distance from the decision boundary, not biological certainty.",
  },
  {
    part: "Community composition",
    what: "Each taxon's share of the whole community, with the dominant taxon in the centre.",
    how: "Bacteria and fungi share one composition, which assumes shotgun metagenomics rather than 16S.",
  },
  {
    part: "The three ratios",
    what: "Cuti:Staph, M. restricta:globosa, and S. epi:capitis, each against its healthy value.",
    how: "These carry the signal. Teal means the healthy side of the reference, rose means the other side.",
  },
  {
    part: "Shannon",
    what: "How evenly abundance is spread across taxa.",
    how: "Context only. A healthy scalp is dominated by one taxon, so low diversity is normal here.",
  },
  {
    part: "What is driving this call",
    what: "Each taxon's exact contribution to the verdict, strongest first.",
    how: "Bars sum to the log-odds gap between this sample and the healthy reference. Rose pushes dysbiotic, teal pulls healthy.",
  },
  {
    part: "Sample vs healthy reference",
    what: "This sample's shape overlaid on the healthy reference profile.",
    how: "Two nearly coincident shapes mean the sample tracks the reference across all nine taxa.",
  },
  {
    part: "What would help",
    what: "The largest gaps from the healthy reference, phrased as shifts.",
    how: "Only harmful gaps appear. Descriptive guidance about composition, not clinical advice.",
  },
  {
    part: "How this input was read",
    what: "An amber banner appearing only when assumptions were applied to your file.",
    how: "It names genus-level splits, unrecognised taxa, and a missing fungal axis.",
  },
];

export function ReadingGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="card !p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span>
          <span className="block text-sm font-bold text-white">
            How to read this page
          </span>
          <span className="mt-0.5 block text-xs text-white/50">
            What every panel shows, and what it deliberately does not claim
          </span>
        </span>
        <span
          className="shrink-0 text-lg leading-none text-white/50 transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
          aria-hidden
        >
          {"\u2304"}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/10 px-5 pb-5 pt-4">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {ENTRIES.map((e) => (
              <div key={e.part}>
                <dt className="text-[13px] font-bold text-white">{e.part}</dt>
                <dd className="mt-0.5 text-[13px] leading-snug text-white/70">
                  {e.what}
                </dd>
                <dd className="mt-1 text-[12px] leading-snug text-accent/80">
                  {e.how}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/40">
            Every panel also has a <span className="font-semibold">?</span>{" "}
            button with a fuller explanation, including the literature the
            reference values come from. Bubbles open on hover, on keyboard focus,
            or on click, and close with Escape.
          </p>
        </div>
      )}
    </div>
  );
}
