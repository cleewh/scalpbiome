import type { AnalyzeResponse } from "../api";
import { InfoBubble } from "./InfoBubble";
import { HELP } from "../helpContent";

// The headline of the whole demo: a large, unmistakable Healthy / Dysbiotic
// verdict with a confidence meter, sized to read from the back of a room.
export function VerdictCard({ result }: { result: AnalyzeResponse }) {
  const healthy = result.label === "Healthy";
  const confidencePct = Math.round(result.confidence * 100);
  const accent = healthy ? "text-healthy" : "text-dysbiotic";
  const ring = healthy ? "border-healthy/40" : "border-dysbiotic/40";
  const barColor = healthy ? "bg-healthy" : "bg-dysbiotic";
  const glow = healthy
    ? "shadow-[0_0_60px_-15px_rgba(45,212,191,0.6)]"
    : "shadow-[0_0_60px_-15px_rgba(251,113,133,0.6)]";

  return (
    <div className={`card animate-rise border-2 ${ring} ${glow}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="card-title">Verdict</h3>
            <InfoBubble title="Verdict and confidence" align="left">
              {HELP.verdict}
            </InfoBubble>
          </div>
          <p className="mt-1 text-xs leading-snug text-white/55">
            The classifier's call for this composition.
          </p>
          <h2 className={`mt-3 text-5xl font-extrabold tracking-tight ${accent}`}>
            {result.label}
          </h2>
          <p className="mt-1 text-lg text-white/60">{result.sample_name}</p>
        </div>
        <div
          className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 ${ring}`}
          aria-hidden
        >
          <span className={`text-3xl ${accent}`}>
            {healthy ? "\u2713" : "\u26A0"}
          </span>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between text-sm text-white/60">
          <span>Model confidence</span>
          <span className={`font-semibold ${accent}`}>{confidencePct}%</span>
        </div>
        <div
          className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/10"
          role="meter"
          aria-valuenow={confidencePct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Model confidence ${confidencePct} percent`}
        >
          <div
            className={`h-full rounded-full ${barColor} transition-all duration-700`}
            style={{ width: `${confidencePct}%` }}
          />
        </div>
        <div className="mt-3 flex justify-between text-xs text-white/45">
          <span>Healthy {Math.round(result.prob_healthy * 100)}%</span>
          <span>Dysbiotic {Math.round(result.prob_dysbiotic * 100)}%</span>
        </div>
        <p className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/40">
          Confidence is distance from the decision boundary, not biological
          certainty. Trained on synthetic profiles, so this demonstrates the
          method rather than diagnosing a subject.
        </p>
      </div>
    </div>
  );
}
