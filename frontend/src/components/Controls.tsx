import { useRef } from "react";
import type { SampleSummary, ModelInfo } from "../api";
import { PanelHeader } from "./PanelHeader";
import { HELP } from "../helpContent";

interface Props {
  samples: SampleSummary[];
  model: ModelInfo | null;
  activeSampleId: string | null;
  busy: boolean;
  onPickSample: (id: string) => void;
  onUpload: (file: File) => void;
  onHealthOmicsDemo: () => void;
}

// Left rail: one-click built-in scenarios + CSV/TSV cohort upload + a model
// readout that states plainly what the accuracy figure does and does not mean.
export function Controls({
  samples,
  model,
  activeSampleId,
  busy,
  onPickSample,
  onUpload,
  onHealthOmicsDemo,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="flex flex-col gap-5">
      <div className="card">
        <PanelHeader
          title="Sample profiles"
          subtitle="Click one to analyse it. Each is a fixed composition, identical every run."
          help={HELP.samples}
          helpTitle="Built-in profiles"
        />
        <div className="grid gap-2">
          {samples.map((s) => {
            const active = s.id === activeSampleId;
            return (
              <button
                key={s.id}
                disabled={busy}
                aria-current={active ? "true" : undefined}
                onClick={() => onPickSample(s.id)}
                className={`rounded-xl border p-3 text-left transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active
                    ? "border-accent bg-accent/15 shadow-glow"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
                }`}
              >
                <span className="block font-semibold text-white">{s.name}</span>
                <span className="mt-0.5 block text-xs leading-snug text-white/55">
                  {s.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card">
        <PanelHeader
          title="Upload a cohort"
          subtitle="CSV or TSV: rows are taxa, columns are samples."
          help={HELP.upload}
          helpTitle="File format"
        />
        <p className="text-xs leading-snug text-white/50">
          Every column is analysed separately. Stands in for a HealthOmics
          abundance table from S3.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        <button
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="mt-3 w-full rounded-xl border border-accent/50 bg-accent/15 px-4 py-2.5 font-semibold text-white transition hover:bg-accent/25 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Choose file
        </button>
      </div>

      <div className="card">
        <PanelHeader
          title="HealthOmics ingest"
          subtitle="Run the real S3 code path against an in-process mock."
          help={HELP.healthomicsDemo}
          helpTitle="HealthOmics demo"
        />
        <p className="text-xs leading-snug text-white/50">
          Reads a taxonomic abundance table from a mocked S3 bucket in
          ap-southeast-1. No credentials, no network, no real AWS resources.
        </p>
        <button
          disabled={busy}
          onClick={onHealthOmicsDemo}
          className="mt-3 w-full rounded-xl border border-amber-400/50 bg-amber-400/15 px-4 py-2.5 font-semibold text-amber-50 transition hover:bg-amber-400/25 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Run S3 ingest
        </button>
      </div>

      {model && (
        <div className="card">
          <PanelHeader
            title="Classifier"
            subtitle="What the model is, and how it was checked."
            help={HELP.classifier}
            helpTitle="Model and validation"
          />
          <div className="space-y-1 text-sm text-white/60">
            <div className="flex justify-between gap-2">
              <span>Model</span>
              <span className="font-mono text-white/80">
                {model.model_type === "logistic"
                  ? "Logistic reg."
                  : model.model_type}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Transform</span>
              <span className="font-mono uppercase text-white/80">
                {model.transform}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Synthetic hold-out</span>
              <span className="font-mono text-white/80">
                {(model.synthetic_holdout_accuracy * 100).toFixed(1)}%
              </span>
            </div>
          </div>
          {/* Stated inline, not just in a bubble: the number is a pipeline
              check and should never be read as biological validation. */}
          <p className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/45">
            Pipeline check on synthetic data, not biological validation. No
            sequenced scalp samples were used.
          </p>
        </div>
      )}
    </aside>
  );
}
