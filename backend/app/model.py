"""Classifier + interpretation layer for ScalpBiome.

Pipeline
--------
    composition -> CLR -> standardise -> logistic regression

CLR first, because relative abundances are compositional and Euclidean statistics
on raw proportions ignore the simplex constraint (see transforms.py). CLR keeps
one coordinate per taxon, so coefficients remain readable per taxon, which the
driver panel depends on.

Logistic regression is chosen over a black box deliberately: its coefficients give
an exact signed decomposition of the prediction, so we can say which taxa pushed a
call and in which direction. A random forest is available as an alternative and
its global importances are exposed too.

On the accuracy figure
----------------------
`synthetic_holdout_accuracy` is measured on held-out samples from the *same
generative model* that produced the training data. It confirms the pipeline
learns the structure it was given. It is NOT biological validation, and is
labelled as such everywhere it surfaces. Real validation would need sequenced
scalp samples with clinical scores.

Per-sample driver math
----------------------
Drivers decompose the log-odds gap between this sample and the healthy reference:

    logit(x) - logit(ref) = sum_i  w_i * (clr(x)_i - clr(ref)_i) / scale_i

so each taxon's term is its signed push away from the healthy reference, positive
toward dysbiosis. The standardiser's mean cancels in the difference, so this is
exact rather than an approximation.

Centring on the reference rather than on the training-cohort mean matters here.
CLR coordinates share a geometric mean, so every coordinate moves when any taxon
moves. Decomposed against the cohort mean, that cross-talk let a low-abundance
bucket outrank the taxon actually carrying the signal. Against the reference the
dominant term in each coordinate is ln(x_i / ref_i), which is exactly the
"how far is this taxon from healthy" quantity the UI reports.

One residual CLR artifact remains and is handled in the wording: because the
coordinates are constrained to sum to zero, a taxon sitting exactly at its
reference value still carries a small non-zero term. Such taxa rank low and are
described as near-reference rather than as pushing either way.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

import numpy as np
from sklearn.decomposition import PCA
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from . import data_gen
from .taxa import (
    AGGREGATE_TAXA,
    N_TAXA,
    RISK_DIRECTION,
    TAXA,
    healthy_reference_vector,
)
from .transforms import CLRTransformer

VALIDATION_NOTE = (
    "Accuracy is measured on held-out samples from the same synthetic generator "
    "that produced the training data. It is a pipeline check, not biological "
    "validation: no sequenced scalp samples were used."
)


# A taxon within this relative tolerance of its reference is treated as
# "at reference" for wording purposes, rather than elevated or depleted.
NEAR_REFERENCE_TOLERANCE = 0.15  # 15% relative


@dataclass
class Driver:
    taxon: str
    abundance: float          # this sample's fraction for the taxon
    reference: float          # healthy-reference fraction
    contribution: float       # signed log-odds push vs reference (+ => dysbiotic)
    direction: str            # "toward_dysbiotic" | "toward_healthy"
    risk_sign: int            # +1 => more of this taxon is dysbiotic; -1 => protective
    vs_reference: str         # "elevated" | "depleted" | "near"
    fold_change: float        # sample / reference

    def as_dict(self) -> dict:
        return {
            "taxon": self.taxon,
            "abundance": round(self.abundance, 4),
            "reference": round(self.reference, 4),
            "contribution": round(self.contribution, 4),
            "direction": self.direction,
            "risk_sign": self.risk_sign,
            "vs_reference": self.vs_reference,
            "fold_change": round(self.fold_change, 3),
        }


@dataclass
class Prediction:
    label: str                # "Healthy" | "Dysbiotic"
    prob_dysbiotic: float
    prob_healthy: float
    confidence: float         # probability of the predicted label
    drivers: List[Driver]

    def as_dict(self) -> dict:
        return {
            "label": self.label,
            "prob_dysbiotic": round(self.prob_dysbiotic, 4),
            "prob_healthy": round(self.prob_healthy, 4),
            "confidence": round(self.confidence, 4),
            "drivers": [d.as_dict() for d in self.drivers],
        }


class ScalpModel:
    """Trains at construction; exposes prediction + interpretation helpers."""

    def __init__(
        self,
        model_type: str = "logistic",
        n_per_class: int = 300,
        seed: int = 42,
    ) -> None:
        self.model_type = model_type
        self.seed = seed
        self.classes_ = ["Healthy", "Dysbiotic"]  # index matches label ints
        self.validation_note = VALIDATION_NOTE

        X, y = data_gen.generate_dataset(n_per_class=n_per_class, seed=seed)
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.25, random_state=seed, stratify=y
        )

        # CLR first, then standardise the log-ratio coordinates.
        self.clr = CLRTransformer()
        Z_train = self.clr.fit_transform(X_train)
        self.scaler = StandardScaler().fit(Z_train)
        Zs_train = self.scaler.transform(Z_train)

        if model_type == "random_forest":
            self.clf = RandomForestClassifier(
                n_estimators=250, random_state=seed, n_jobs=-1
            )
        else:
            self.clf = LogisticRegression(max_iter=1000, C=1.0, random_state=seed)
        self.clf.fit(Zs_train, y_train)

        Zs_test = self.scaler.transform(self.clr.transform(X_test))
        self.synthetic_holdout_accuracy = float(self.clf.score(Zs_test, y_test))

        self._coef = self.clf.coef_[0] if hasattr(self.clf, "coef_") else None
        self._ref_vec = np.asarray(healthy_reference_vector(), dtype=float)
        # CLR coordinates of the healthy reference, used to centre the driver
        # decomposition on the reference instead of the training-cohort mean.
        self._ref_clr = self.clr.transform(self._ref_vec.reshape(1, -1))[0]

        # Per-taxon "risk direction", derived from the raw compositions in the
        # training data rather than from model internals, so it reflects biology
        # and holds for any classifier:
        #   +1 => more abundant in dysbiotic samples (risk taxon)
        #   -1 => more abundant in healthy samples (protective)
        healthy_mean = X_train[y_train == data_gen.LABEL_HEALTHY].mean(axis=0)
        dysbiotic_mean = X_train[y_train == data_gen.LABEL_DYSBIOTIC].mean(axis=0)
        self.risk_sign = np.where(dysbiotic_mean >= healthy_mean, 1, -1).astype(int)

        # ------------------------------------------------------------------
        # Ordination: PCA on the *unstandardised* CLR coordinates.
        #
        # This is the deliberate choice. Euclidean distance between CLR vectors
        # is Aitchison distance, so PCA in that space is a genuine Aitchison
        # (compositional) biplot and the plotted distances mean what a microbiome
        # researcher expects. Standardising first would rescale the axes and the
        # distances would no longer be Aitchison distances, so the classifier's
        # standardised feature space is intentionally NOT reused here.
        # ------------------------------------------------------------------
        self._clr_pca = PCA(n_components=2, random_state=seed).fit(Z_train)
        train_proj = self._clr_pca.transform(Z_train)

        # Principal-component signs are arbitrary, so the plot could mirror itself
        # between restarts. Pin the orientation: healthy on the left, dysbiosis to
        # the right, so the axis reads the same way in every rehearsal and the
        # presenter can point at it without checking first.
        self._pc_signs = np.ones(2)
        healthy_pc1 = train_proj[y_train == data_gen.LABEL_HEALTHY, 0].mean()
        if healthy_pc1 > 0:
            self._pc_signs[0] = -1.0
        healthy_pc2 = train_proj[y_train == data_gen.LABEL_HEALTHY, 1].mean()
        if healthy_pc2 > 0:
            self._pc_signs[1] = -1.0
        train_proj = train_proj * self._pc_signs

        # Subsample the training cloud so the payload stays small and the scatter
        # stays legible on a projector.
        rng = np.random.default_rng(seed)
        n_show = min(280, len(train_proj))
        idx = rng.choice(len(train_proj), size=n_show, replace=False)
        self.ordination_points = [
            {
                "x": round(float(train_proj[i, 0]), 4),
                "y": round(float(train_proj[i, 1]), 4),
                "label": "Dysbiotic"
                if int(y_train[i]) == data_gen.LABEL_DYSBIOTIC
                else "Healthy",
            }
            for i in idx
        ]
        self.ordination_explained = [
            round(float(v), 4) for v in self._clr_pca.explained_variance_ratio_
        ]
        self.ordination_reference = self.project(self._ref_vec)

    # ------------------------------------------------------------------
    # Geometry helpers
    # ------------------------------------------------------------------
    def _clr_of(self, vec) -> np.ndarray:
        return self.clr.transform(np.asarray(vec, dtype=float).reshape(1, -1))[0]

    def project(self, vec) -> Dict[str, float]:
        """Project a composition into the 2D Aitchison ordination."""
        p = self._clr_pca.transform(self._clr_of(vec).reshape(1, -1))[0] * self._pc_signs
        return {"x": round(float(p[0]), 4), "y": round(float(p[1]), 4)}

    def logit_from_clr(self, clr_vec: np.ndarray) -> float:
        """Dysbiosis log-odds for a CLR coordinate vector."""
        z = self.scaler.transform(np.asarray(clr_vec, dtype=float).reshape(1, -1))
        return float(self.clf.decision_function(z)[0])

    def prob_from_clr(self, clr_vec: np.ndarray) -> float:
        """P(dysbiotic) for a CLR coordinate vector."""
        z = self.scaler.transform(np.asarray(clr_vec, dtype=float).reshape(1, -1))
        return float(self.clf.predict_proba(z)[0][data_gen.LABEL_DYSBIOTIC])

    def decision_logit(self, vec) -> float:
        return self.logit_from_clr(self._clr_of(vec))

    # ------------------------------------------------------------------
    # Exact log-odds waterfall
    # ------------------------------------------------------------------
    def waterfall(self, vec) -> Dict[str, object]:
        """Decompose the log-odds gap from the healthy reference to this sample.

        Returns every taxon's term, ordered by magnitude, with the running
        cumulative log-odds. Because the decomposition is exact, the final
        cumulative value equals the sample's log-odds: the waterfall closes with
        no residual. That is the point of showing it, so no term is dropped and
        the caller should not truncate the list.
        """
        sample_clr = self._clr_of(vec)
        base_logit = self.logit_from_clr(self._ref_clr)
        final_logit = self.logit_from_clr(sample_clr)

        drivers = self._drivers(
            np.asarray(vec, dtype=float).reshape(-1), sample_clr
        )

        def to_prob(logit: float) -> float:
            return float(1.0 / (1.0 + np.exp(-logit)))

        running = base_logit
        steps = []
        for d in drivers:  # already sorted by |contribution|
            running += d.contribution
            steps.append(
                {
                    "taxon": d.taxon,
                    "contribution": round(d.contribution, 4),
                    "cumulative_logit": round(running, 4),
                    "cumulative_prob": round(to_prob(running), 4),
                    "direction": d.direction,
                    "abundance": round(d.abundance, 4),
                    "reference": round(d.reference, 4),
                }
            )

        residual = final_logit - running
        return {
            "base_logit": round(base_logit, 4),
            "base_prob": round(to_prob(base_logit), 4),
            "final_logit": round(final_logit, 4),
            "final_prob": round(to_prob(final_logit), 4),
            # Should be ~0. Surfaced rather than hidden so the claim that the
            # decomposition is exact is checkable from the API response itself.
            "residual": round(float(residual), 9),
            "steps": steps,
        }

    # ------------------------------------------------------------------
    # Treatment trajectory
    # ------------------------------------------------------------------
    def trajectory(self, vec, steps: int = 24) -> List[Dict[str, object]]:
        """Walk from a composition to the healthy reference along a geodesic.

        The path is linear interpolation in CLR space, which is the geodesic in
        Aitchison geometry, not a naive blend of proportions. In composition space
        each step is a weighted geometric mean of the endpoints, so intermediate
        points stay valid compositions and ratios move smoothly.

        This is a *simulated* trajectory illustrating the direction of travel. It
        is not longitudinal data and does not model any specific intervention.
        """
        start = self._clr_of(vec)
        end = self._ref_clr.copy()
        out: List[Dict[str, object]] = []

        for i in range(steps + 1):
            t = i / steps
            clr_t = (1.0 - t) * start + t * end
            # Inverse CLR is the softmax, giving back a valid composition.
            exp_t = np.exp(clr_t - clr_t.max())
            comp = exp_t / exp_t.sum()
            proj = self._clr_pca.transform(clr_t.reshape(1, -1))[0] * self._pc_signs
            prob = self.prob_from_clr(clr_t)
            out.append(
                {
                    "step": i,
                    "fraction": round(t, 4),
                    "prob_dysbiotic": round(prob, 4),
                    "label": "Dysbiotic" if prob >= 0.5 else "Healthy",
                    "x": round(float(proj[0]), 4),
                    "y": round(float(proj[1]), 4),
                    "composition": {
                        TAXA[j]: round(float(comp[j]), 4) for j in range(N_TAXA)
                    },
                }
            )
        return out

    # ------------------------------------------------------------------
    # Prediction
    # ------------------------------------------------------------------
    def predict(self, vec: List[float]) -> Prediction:
        x = np.asarray(vec, dtype=float).reshape(1, -1)
        if x.shape[1] != N_TAXA:
            raise ValueError(f"Expected {N_TAXA} taxa, got {x.shape[1]}.")

        x_clr = self.clr.transform(x)
        z = self.scaler.transform(x_clr)
        proba = self.clf.predict_proba(z)[0]
        prob_healthy = float(proba[data_gen.LABEL_HEALTHY])
        prob_dysbiotic = float(proba[data_gen.LABEL_DYSBIOTIC])
        label = "Dysbiotic" if prob_dysbiotic >= 0.5 else "Healthy"
        confidence = max(prob_healthy, prob_dysbiotic)

        drivers = self._drivers(x.reshape(-1), x_clr[0])
        return Prediction(
            label=label,
            prob_dysbiotic=prob_dysbiotic,
            prob_healthy=prob_healthy,
            confidence=confidence,
            drivers=drivers,
        )

    def _drivers(self, sample: np.ndarray, sample_clr: np.ndarray) -> List[Driver]:
        """Signed per-taxon contributions vs the healthy reference, strongest first.

        `sample` is the raw composition (for display); `sample_clr` is its CLR
        coordinate vector. The decomposition is centred on the reference:

            contribution_i = w_i * (clr(x)_i - clr(ref)_i) / scale_i

        which sums exactly to logit(x) - logit(ref).
        """
        delta_clr = sample_clr - self._ref_clr
        scale = self.scaler.scale_

        if self._coef is not None:
            contrib = self._coef * (delta_clr / scale)
        else:  # pragma: no cover - alternative model path
            # Random forest: no signed coefficients, so weight the reference
            # deviation by global importance and take the sign from the
            # deviation crossed with the taxon's risk direction.
            importance = getattr(self.clf, "feature_importances_", np.ones(N_TAXA))
            contrib = importance * (delta_clr / scale) * self.risk_sign

        drivers: List[Driver] = []
        for i in range(N_TAXA):
            ref_i = float(self._ref_vec[i])
            abundance = float(sample[i])
            fold = abundance / ref_i if ref_i > 0 else 0.0
            if abs(fold - 1.0) <= NEAR_REFERENCE_TOLERANCE:
                vs_ref = "near"
            elif fold > 1.0:
                vs_ref = "elevated"
            else:
                vs_ref = "depleted"

            drivers.append(
                Driver(
                    taxon=TAXA[i],
                    abundance=abundance,
                    reference=ref_i,
                    contribution=float(contrib[i]),
                    direction=(
                        "toward_dysbiotic" if contrib[i] >= 0 else "toward_healthy"
                    ),
                    risk_sign=int(self.risk_sign[i]),
                    vs_reference=vs_ref,
                    fold_change=float(fold),
                )
            )
        drivers.sort(key=lambda d: abs(d.contribution), reverse=True)
        return drivers

    # ------------------------------------------------------------------
    # Global feature importance
    # ------------------------------------------------------------------
    def global_importance(self) -> Dict[str, float]:
        if hasattr(self.clf, "feature_importances_"):
            vals = self.clf.feature_importances_
        elif self._coef is not None:
            vals = np.abs(self._coef)
        else:
            vals = np.ones(N_TAXA)
        vals = vals / (vals.sum() or 1.0)
        return {TAXA[i]: float(vals[i]) for i in range(N_TAXA)}


# ---------------------------------------------------------------------------
# "What would help" recommendations.
# ---------------------------------------------------------------------------
@dataclass
class Recommendation:
    taxon: str
    current: float
    target: float
    action: str      # "increase" | "decrease"
    message: str

    def as_dict(self) -> dict:
        return {
            "taxon": self.taxon,
            "current": round(self.current, 4),
            "target": round(self.target, 4),
            "action": self.action,
            "message": self.message,
        }


# Taxon-specific phrasing for the largest gaps.
_INCREASE_PHRASING: Dict[str, str] = {
    "Cutibacterium": (
        "Restore Cutibacterium from {cur:.0f}% toward the healthy ~{tgt:.0f}% to "
        "re-establish the keystone commensal of sebaceous skin."
    ),
    "S. epidermidis": (
        "Recover S. epidermidis from {cur:.0f}% toward the healthy ~{tgt:.0f}%. "
        "This protective species is depleted at lesional sites even as the "
        "Staphylococcus genus expands."
    ),
    "M. globosa": (
        "Rebalance M. globosa from {cur:.0f}% toward the healthy ~{tgt:.0f}% to "
        "bring the restricta:globosa ratio back down."
    ),
}

_DECREASE_PHRASING: Dict[str, str] = {
    "S. capitis": (
        "Reduce S. capitis from {cur:.0f}% toward the healthy ~{tgt:.0f}%. This "
        "is the species driving the genus-level Staphylococcus increase."
    ),
    "M. restricta": (
        "Reduce M. restricta from {cur:.0f}% toward the healthy ~{tgt:.0f}%, the "
        "clearest fungal association with flaking severity."
    ),
}


def generate_recommendations(vec: List[float], max_items: int = 3) -> List[Recommendation]:
    """Suggest community shifts that would move a sample toward the healthy
    reference.

    Taxa are ranked by absolute deviation from the reference, and only deviations
    in a *harmful* direction become recommendations:

      * risk taxa are flagged when elevated, never when depleted
      * protective taxa are flagged when depleted, never when elevated
      * neutral taxa are flagged only when depleted, to rebuild commensal balance
      * aggregate buckets are skipped entirely

    Without that filter, a healthy sample whose Cutibacterium sits a little above
    the cohort mean would be advised to suppress its own keystone commensal.

    This is descriptive guidance about community composition, not clinical advice.
    """
    sample = np.asarray(vec, dtype=float)
    sample = sample / (sample.sum() or 1.0)
    ref = np.asarray(healthy_reference_vector(), dtype=float)
    deviation = sample - ref

    order = np.argsort(np.abs(deviation))[::-1]
    recs: List[Recommendation] = []
    for i in order:
        gap = deviation[i]
        if abs(gap) < 0.03:  # ignore near-target taxa
            continue
        taxon = TAXA[i]
        if taxon in AGGREGATE_TAXA:
            continue

        risk = RISK_DIRECTION.get(taxon, 0)
        elevated = gap > 0

        # Skip deviations that are not in a harmful direction.
        if elevated and risk <= 0:
            # Protective or neutral taxon above reference: not a problem.
            continue
        if not elevated and risk > 0:
            # Risk taxon below reference: already favourable.
            continue

        cur_pct = sample[i] * 100
        tgt_pct = ref[i] * 100
        if elevated:
            action = "decrease"
            template = _DECREASE_PHRASING.get(
                taxon,
                "Reduce {taxon} from {cur:.0f}% toward the healthy ~{tgt:.0f}% to "
                "relieve its dominance.",
            )
        else:
            action = "increase"
            template = _INCREASE_PHRASING.get(
                taxon,
                "Encourage {taxon} from {cur:.0f}% toward the healthy ~{tgt:.0f}% "
                "to rebuild community balance.",
            )
        msg = template.format(taxon=taxon, cur=cur_pct, tgt=tgt_pct)

        recs.append(
            Recommendation(
                taxon=taxon,
                current=float(sample[i]),
                target=float(ref[i]),
                action=action,
                message=msg,
            )
        )
        if len(recs) >= max_items:
            break
    return recs
