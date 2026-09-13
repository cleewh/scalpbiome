import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeAbundancesSignal,
  analyzeSample,
  getHealthOmicsDemo,
  getOrdination,
  getSamples,
  getTrajectory,
  uploadCohort,
  type AnalyzeResponse,
  type HealthOmicsSource,
  type ModelInfo,
  type OrdinationResponse,
  type SampleSummary,
  type TaxonInfo,
  type TrajectoryResponse,
} from "./api";
import { Controls } from "./components/Controls";
import { VerdictCard } from "./components/VerdictCard";
import { CompositionChart } from "./components/CompositionChart";
import { DriversPanel } from "./components/DriversPanel";
import { MetricTiles } from "./components/MetricTiles";
import { RecommendationsPanel } from "./components/RecommendationsPanel";
import { ReferenceRadar } from "./components/ReferenceRadar";
import { ReadingGuide } from "./components/ReadingGuide";
import { WaterfallChart } from "./components/WaterfallChart";
import { OrdinationChart } from "./components/OrdinationChart";
import { TreatmentPlanPanel } from "./components/TreatmentPlanPanel";
import { PerturbationPanel } from "./components/PerturbationPanel";
import { InfoBubble } from "./components/InfoBubble";
import { HELP } from "./helpContent";

export default function App() {
  const [samples, setSamples] = useState<SampleSummary[]>([]);
  const [taxa, setTaxa] = useState<TaxonInfo[]>([]);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [assayNote, setAssayNote] = useState<string>("");
  const [ordination, setOrdination] = useState<OrdinationResponse | null>(null);

  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [trajectory, setTrajectory] = useState<TrajectoryResponse | null>(null);
  const [activeSampleId, setActiveSampleId] = useState<string | null>(null);

  // Composition the sliders start from, and whether the user has edited it.
  const [baseline, setBaseline] = useState<Record<string, number>>({});
  const [baselineName, setBaselineName] = useState("Healthy scalp");
  const [edited, setEdited] = useState(false);

  const [cohort, setCohort] = useState<AnalyzeResponse[]>([]);
  const [cohortIdx, setCohortIdx] = useState(0);

  // Provenance banner shown after the HealthOmics ingest demo.
  const [omicsSource, setOmicsSource] = useState<HealthOmicsSource | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Supersede in-flight requests so a fast slider drag cannot let a stale
  // response overwrite a newer one.
  const analyzeAbort = useRef<AbortController | null>(null);
  const trajectoryAbort = useRef<AbortController | null>(null);

  const compositionOf = (r: AnalyzeResponse): Record<string, number> =>
    Object.fromEntries(r.composition.map((c) => [c.taxon, c.abundance]));

  const loadTrajectory = useCallback(
    async (body: { sample_id?: string; abundances?: Record<string, number> }) => {
      trajectoryAbort.current?.abort();
      const ctrl = new AbortController();
      trajectoryAbort.current = ctrl;
      try {
        setTrajectory(await getTrajectory(body, ctrl.signal));
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") setTrajectory(null);
      }
    },
    []
  );

  // First load: metadata + ordination, then seed with the Healthy scalp sample
  // already analyzed so the demo opens on a meaningful visual.
  useEffect(() => {
    (async () => {
      try {
        const [meta, ord] = await Promise.all([getSamples(), getOrdination()]);
        setSamples(meta.samples);
        setTaxa(meta.taxa);
        setModel(meta.model);
        setAssayNote(meta.assay_note);
        setOrdination(ord);

        const seed = await analyzeSample("healthy");
        setResult(seed);
        setActiveSampleId("healthy");
        setBaseline(compositionOf(seed));
        setBaselineName(seed.sample_name);
        await loadTrajectory({ sample_id: "healthy" });
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Could not reach the ScalpBiome API. Is the backend running on :8000?"
        );
      }
    })();
  }, [loadTrajectory]);

  async function pickSample(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await analyzeSample(id);
      setResult(res);
      setActiveSampleId(id);
      setCohort([]);
      setOmicsSource(null);
      setBaseline(compositionOf(res));
      setBaselineName(res.sample_name);
      setEdited(false);
      await loadTrajectory({ sample_id: id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const res = await uploadCohort(file);
      setCohort(res.analyses);
      setCohortIdx(0);
      setOmicsSource(null);
      const first = res.analyses[0];
      setResult(first);
      setActiveSampleId(null);
      setBaseline(compositionOf(first));
      setBaselineName(first.sample_name);
      setEdited(false);
      await loadTrajectory({ abundances: compositionOf(first) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  /** Run the HealthOmics S3 ingest path and show the resulting analysis. */
  async function runHealthOmicsDemo() {
    setBusy(true);
    setError(null);
    try {
      const res = await getHealthOmicsDemo();
      setResult(res.analysis);
      setOmicsSource(res.source);
      setActiveSampleId(null);
      setCohort([]);
      setBaseline(compositionOf(res.analysis));
      setBaselineName(res.analysis.sample_name);
      setEdited(false);
      await loadTrajectory({ abundances: compositionOf(res.analysis) });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "HealthOmics ingest demo failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function showCohortMember(i: number) {
    const a = cohort[i];
    setCohortIdx(i);
    setResult(a);
    setBaseline(compositionOf(a));
    setBaselineName(a.sample_name);
    setEdited(false);
    await loadTrajectory({ abundances: compositionOf(a) });
  }

  /** Slider callback: re-analyze the edited composition. */
  const handlePerturb = useCallback(
    async (abundances: Record<string, number>, dirty: boolean) => {
      setEdited(dirty);
      analyzeAbort.current?.abort();
      const ctrl = new AbortController();
      analyzeAbort.current = ctrl;
      try {
        const res = await analyzeAbundancesSignal(
          abundances,
          dirty ? "Adjusted composition" : undefined,
          ctrl.signal
        );
        setResult(res);
        setError(null);
        if (dirty) await loadTrajectory({ abundances });
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          setError(e instanceof Error ? e.message : "Analysis failed.");
        }
      }
    },
    [loadTrajectory]
  );

  return (
    <div className="min-h-full px-6 py-8 lg:px-10">
      <header className="mx-auto mb-6 flex max-w-7xl flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-4xl font-extrabold tracking-tight text-white">
            <span
              className="inline-block h-8 w-8 rounded-lg bg-gradient-to-br from-healthy to-accent shadow-glow"
              aria-hidden
            />
            ScalpBiome
          </h1>
          <p className="mt-1 flex items-center gap-2 text-white/55">
            Scalp &amp; skin microbiome health analyzer
            <InfoBubble title="Modelled taxa" align="left">
              {HELP.taxa}
            </InfoBubble>
          </p>
        </div>
        <div className="text-right text-xs text-white/45">
          <p>CLR + logistic regression, trained on synthetic profiles</p>
          <p>HealthOmics-ready input layer &middot; ap-southeast-1</p>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mx-auto mb-6 max-w-7xl rounded-xl border border-dysbiotic/40 bg-dysbiotic/10 px-4 py-3 text-dysbiotic-soft"
        >
          {error}
        </div>
      )}

      <div className="mx-auto mb-6 max-w-7xl">
        <ReadingGuide />
      </div>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Controls
            samples={samples}
            model={model}
            activeSampleId={activeSampleId}
            busy={busy}
            onPickSample={pickSample}
            onUpload={handleUpload}
            onHealthOmicsDemo={runHealthOmicsDemo}
          />
          {Object.keys(baseline).length > 0 && taxa.length > 0 && (
            <PerturbationPanel
              baseline={baseline}
              baselineName={baselineName}
              taxa={taxa}
              onChange={handlePerturb}
              result={result}
              busy={busy}
            />
          )}
        </div>

        <main className="flex flex-col gap-6">
          {cohort.length > 0 && (
            <div className="card !p-4">
              <div className="flex items-center gap-2">
                <h3 className="card-title">
                  Uploaded cohort &middot; {cohort.length} samples
                </h3>
                <InfoBubble title="Cohort switcher" align="left">
                  {HELP.cohort}
                </InfoBubble>
              </div>
              <p className="mt-1 text-xs leading-snug text-white/55">
                One chip per column in your file. Click to view that sample's
                analysis. Teal dot = healthy, rose = dysbiotic.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {cohort.map((a, i) => {
                  const active = i === cohortIdx;
                  const dys = a.label === "Dysbiotic";
                  return (
                    <button
                      key={`${a.sample_name}-${i}`}
                      onClick={() => showCohortMember(i)}
                      aria-current={active ? "true" : undefined}
                      className={`rounded-full border px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        active
                          ? "border-accent bg-accent/20 text-white"
                          : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/25"
                      }`}
                    >
                      <span
                        className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: dys ? "#fb7185" : "#2dd4bf" }}
                        aria-hidden
                      />
                      {a.sample_name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {omicsSource && (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-400/[0.07] p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-amber-200">
                  Ingested from HealthOmics output
                </h3>
                <InfoBubble title="HealthOmics demo" align="left">
                  {HELP.healthomicsDemo}
                </InfoBubble>
              </div>
              <p className="mt-1.5 break-all font-mono text-[12px] text-amber-100/85">
                {omicsSource.s3_uri}
              </p>
              <p className="mt-1 text-[12px] text-amber-100/60">
                {omicsSource.region} &middot; {omicsSource.bytes} bytes &middot;{" "}
                {omicsSource.raw_taxa} taxa in the source table
              </p>
              <p className="mt-2 text-[11px] leading-snug text-amber-100/50">
                {omicsSource.note}
              </p>
            </div>
          )}

          {result ? (
            <>
              {edited && (
                <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-2.5 text-[13px] text-amber-100/90">
                  Showing an <span className="font-semibold">adjusted</span>{" "}
                  composition derived from {baselineName}. Use Reset in the
                  what-if panel to return to the original profile.
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-amber-200">
                      How this input was read
                    </h3>
                    <InfoBubble title="Data-quality notes" align="left">
                      {HELP.warnings}
                    </InfoBubble>
                  </div>
                  <p className="mt-1 text-xs text-amber-100/60">
                    Assumptions applied to your file. Not errors, but they affect
                    how much the call can be trusted.
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {result.warnings.map((w) => (
                      <li
                        key={w}
                        className="text-[13px] leading-snug text-amber-50/90"
                      >
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <VerdictCard result={result} />
                <CompositionChart result={result} />
              </div>

              <MetricTiles result={result} />

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <WaterfallChart result={result} />
                {ordination && (
                  <OrdinationChart
                    ordination={ordination}
                    result={result}
                    trajectory={trajectory}
                  />
                )}
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <DriversPanel result={result} />
                <ReferenceRadar result={result} />
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <RecommendationsPanel result={result} />
                {trajectory && (
                  <TreatmentPlanPanel result={result} trajectory={trajectory} />
                )}
              </div>
            </>
          ) : (
            <div className="card flex h-64 items-center justify-center text-white/40">
              {error ? "Backend unavailable." : "Loading analysis\u2026"}
            </div>
          )}
        </main>
      </div>

      <footer className="mx-auto mt-10 max-w-7xl space-y-1 text-center text-xs text-white/35">
        <p>{assayNote}</p>
        <p>
          Built for the SCELSE &times; AWS microbiome seminar &middot; runs fully
          offline, no API keys required.
        </p>
      </footer>
    </div>
  );
}
