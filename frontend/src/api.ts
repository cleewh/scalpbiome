// Typed client for the ScalpBiome FastAPI backend.
// During dev, Vite proxies /api -> http://127.0.0.1:8000 (see vite.config.ts).

export interface TaxonInfo {
  name: string;
  full_name: string;
  kind: string;
  role: string;
  reference: number;
  risk_sign: number;
}

export interface SampleSummary {
  id: string;
  name: string;
  description: string;
  abundances: Record<string, number>;
}

export interface ModelInfo {
  model_type: string;
  transform: string;
  synthetic_holdout_accuracy: number;
  validation_note: string;
  global_importance: Record<string, number>;
}

export interface SamplesResponse {
  taxa: TaxonInfo[];
  samples: SampleSummary[];
  model: ModelInfo;
  assay_note: string;
}

export interface CompositionEntry {
  taxon: string;
  full_name: string;
  kind: string;
  abundance: number;
  reference: number;
}

export interface Driver {
  taxon: string;
  abundance: number;
  reference: number;
  contribution: number;
  direction: "toward_dysbiotic" | "toward_healthy";
  risk_sign: number;
  vs_reference: "elevated" | "depleted" | "near";
  fold_change: number;
  explanation: string;
}

/** A ratio metric plus whether it hit the display cap. */
export interface Ratio {
  value: number;
  capped: boolean;
}

export interface Metrics {
  shannon: number;
  richness: number;
  evenness: number;
  cuti_staph: Ratio;
  restricta_globosa: Ratio;
  epidermidis_capitis: Ratio;
  fungal_fraction: number;
  dominant_taxon: string;
}

export type EvidenceTier =
  | "randomised"
  | "interventional"
  | "observational"
  | "none";

/** What is documented to move a taxon, with the evidence qualified. */
export interface Lever {
  /** Mechanism class only. Never a product, dose or protocol. */
  mechanism: string;
  evidence: EvidenceTier;
  evidence_label: string;
  /**
   * "species" if the published effect resolves to this taxon, "genus" if only
   * measured at genus level. Genus-level evidence cannot attribute an effect to
   * one species of that genus.
   */
  resolution: "species" | "genus" | "none";
  note: string;
  citations: string[];
}

export interface Recommendation {
  taxon: string;
  current: number;
  target: number;
  action: "increase" | "decrease";
  message: string;
  lever: Lever | null;
}

/** Colour and label per evidence tier, strongest first. */
export const EVIDENCE_STYLE: Record<
  EvidenceTier,
  { label: string; colour: string; background: string }
> = {
  randomised: {
    label: "randomised trials",
    colour: "#5eead4",
    background: "rgba(45,212,191,0.16)",
  },
  interventional: {
    label: "interventional",
    colour: "#93c5fd",
    background: "rgba(96,165,250,0.16)",
  },
  observational: {
    label: "observational",
    colour: "#fcd34d",
    background: "rgba(251,191,36,0.16)",
  },
  none: {
    label: "none established",
    colour: "#cbd5e1",
    background: "rgba(148,163,184,0.16)",
  },
};

export interface RadarEntry {
  taxon: string;
  sample: number;
  healthy: number;
}

export interface WaterfallStep {
  taxon: string;
  contribution: number;
  cumulative_logit: number;
  cumulative_prob: number;
  direction: "toward_dysbiotic" | "toward_healthy";
  abundance: number;
  reference: number;
}

export interface Waterfall {
  base_logit: number;
  base_prob: number;
  final_logit: number;
  final_prob: number;
  /** final_logit minus the last cumulative value; expected ~0. */
  residual: number;
  steps: WaterfallStep[];
}

export interface Point {
  x: number;
  y: number;
}

export interface OrdinationPoint extends Point {
  label: "Healthy" | "Dysbiotic";
}

export interface OrdinationResponse {
  points: OrdinationPoint[];
  reference: Point;
  explained_variance: number[];
  method: string;
  note: string;
}

export interface TrajectoryStep {
  step: number;
  fraction: number;
  prob_dysbiotic: number;
  label: "Healthy" | "Dysbiotic";
  x: number;
  y: number;
  composition: Record<string, number>;
}

export interface TrajectoryResponse {
  path: TrajectoryStep[];
  crosses_at: number | null;
  method: string;
  note: string;
}

export interface AnalyzeResponse {
  sample_name: string;
  label: "Healthy" | "Dysbiotic";
  confidence: number;
  prob_healthy: number;
  prob_dysbiotic: number;
  composition: CompositionEntry[];
  drivers: Driver[];
  metrics: Metrics;
  recommendations: Recommendation[];
  radar: RadarEntry[];
  waterfall: Waterfall;
  ordination: Point;
  warnings: string[];
}

export interface UploadResponse {
  count: number;
  analyses: AnalyzeResponse[];
}

const BASE = "/api";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* ignore parse errors */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function getSamples(): Promise<SamplesResponse> {
  return handle<SamplesResponse>(await fetch(`${BASE}/samples`));
}

export async function analyzeSample(sampleId: string): Promise<AnalyzeResponse> {
  return handle<AnalyzeResponse>(
    await fetch(`${BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sample_id: sampleId }),
    })
  );
}

export async function analyzeAbundances(
  abundances: Record<string, number>,
  name?: string
): Promise<AnalyzeResponse> {
  return handle<AnalyzeResponse>(
    await fetch(`${BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ abundances, name }),
    })
  );
}

export async function uploadCohort(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return handle<UploadResponse>(
    await fetch(`${BASE}/upload`, { method: "POST", body: form })
  );
}

export async function getOrdination(): Promise<OrdinationResponse> {
  return handle<OrdinationResponse>(await fetch(`${BASE}/ordination`));
}

export interface HealthOmicsSource {
  s3_uri: string;
  region: string;
  bytes: number;
  raw_taxa: number;
  note: string;
}

export interface HealthOmicsDemoResponse {
  source: HealthOmicsSource;
  raw_abundances: Record<string, number>;
  analysis: AnalyzeResponse;
}

export async function getHealthOmicsDemo(): Promise<HealthOmicsDemoResponse> {
  return handle<HealthOmicsDemoResponse>(await fetch(`${BASE}/healthomics/demo`));
}

export async function getTrajectory(
  body: { sample_id?: string; abundances?: Record<string, number>; steps?: number },
  signal?: AbortSignal
): Promise<TrajectoryResponse> {
  return handle<TrajectoryResponse>(
    await fetch(`${BASE}/trajectory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps: 24, ...body }),
      signal,
    })
  );
}

/** Analyze arbitrary abundances, cancellable so slider drags can supersede. */
export async function analyzeAbundancesSignal(
  abundances: Record<string, number>,
  name: string | undefined,
  signal: AbortSignal
): Promise<AnalyzeResponse> {
  return handle<AnalyzeResponse>(
    await fetch(`${BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ abundances, name }),
      signal,
    })
  );
}

// Stable, high-contrast colour per taxon, shared across all charts.
// Related species share a hue family so the audience reads them as pairs, and
// within each pair the protective and risk member are visually distinct.
export const TAXON_COLORS: Record<string, string> = {
  Cutibacterium: "#2dd4bf", // teal, keystone
  "S. epidermidis": "#38bdf8", // sky, protective staphylococcus
  "S. capitis": "#fb7185", // rose, risk staphylococcus
  "M. restricta": "#f59e0b", // amber, risk malassezia
  "M. globosa": "#fcd34d", // light amber, paired malassezia
  Corynebacterium: "#818cf8",
  Streptococcus: "#a78bfa",
  Micrococcus: "#c4b5fd",
  Other: "#64748b",
};

export function taxonColor(taxon: string): string {
  return TAXON_COLORS[taxon] ?? "#94a3b8";
}

/** Format a ratio, showing the cap explicitly when it was hit. */
export function formatRatio(ratio: Ratio, digits = 2): string {
  return ratio.capped ? `>${ratio.value.toFixed(0)}` : ratio.value.toFixed(digits);
}
