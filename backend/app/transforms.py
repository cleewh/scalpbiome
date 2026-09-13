"""Compositional-data transforms.

Relative abundances live on the simplex: they are constrained to sum to 1, so the
components are not independent and ordinary Euclidean statistics on raw
proportions are not well founded (Aitchison 1982). The standard remedy in
microbiome analysis is to move to log-ratio coordinates before modelling.

We use the centred log-ratio (CLR):

    clr(x)_i = ln(x_i) - (1/D) * sum_j ln(x_j)

i.e. each component's log abundance relative to the geometric mean of the
composition. CLR keeps one coordinate per taxon, so model coefficients stay
readable per taxon, which matters because the app reports per-taxon drivers.

Zeros
-----
CLR needs strictly positive values. Zeros in compositional data are handled by
replacement rather than by adding a constant to everything: each zero is set to a
small delta below the plausible detection limit and the observed parts are scaled
down so the composition still sums to 1 (multiplicative replacement,
Martin-Fernandez et al. 2003). This preserves the ratios between observed parts,
which a naive pseudocount does not.
"""

from __future__ import annotations

import numpy as np

from .taxa import DETECTION_LIMIT

# Replacement value for zeros. Set to the assumed detection limit rather than
# something arbitrarily smaller: a zero means "below detection", so the detection
# limit is the honest stand-in.
#
# This is not a cosmetic choice. With a much smaller delta, a single undetected
# taxon produces a CLR excursion larger than any real between-group difference,
# and downstream PCA then fits that artifact instead of the biology.
DEFAULT_DELTA = DETECTION_LIMIT


def multiplicative_replacement(X: np.ndarray, delta: float = DEFAULT_DELTA) -> np.ndarray:
    """Replace zeros with `delta`, scaling observed parts to keep rows summing to 1."""
    A = np.asarray(X, dtype=float)
    if A.ndim == 1:
        A = A.reshape(1, -1)
    A = np.clip(A, 0.0, None)

    # Normalise defensively; callers may pass counts.
    row_sums = A.sum(axis=1, keepdims=True)
    row_sums[row_sums <= 0] = 1.0
    A = A / row_sums

    out = A.copy()
    for r in range(A.shape[0]):
        zero_mask = A[r] <= 0
        n_zero = int(zero_mask.sum())
        if n_zero == 0:
            continue
        # Observed parts shrink by the total mass handed to the zeros.
        retained = 1.0 - n_zero * delta
        if retained <= 0:
            # Degenerate: essentially everything is zero. Fall back to uniform.
            out[r] = np.full(A.shape[1], 1.0 / A.shape[1])
            continue
        out[r][~zero_mask] = A[r][~zero_mask] * retained
        out[r][zero_mask] = delta
    return out


def clr(X: np.ndarray, delta: float = DEFAULT_DELTA) -> np.ndarray:
    """Centred log-ratio transform, with zero replacement applied first."""
    A = multiplicative_replacement(X, delta=delta)
    log_A = np.log(A)
    geometric_mean_log = log_A.mean(axis=1, keepdims=True)
    return log_A - geometric_mean_log


class CLRTransformer:
    """Minimal stateless transformer so CLR can sit in front of a scaler.

    Kept deliberately simple rather than subclassing sklearn's base classes: it
    holds no fitted state, so there is nothing to leak between train and predict.
    """

    def __init__(self, delta: float = DEFAULT_DELTA) -> None:
        self.delta = delta

    def fit(self, X: np.ndarray, y: np.ndarray | None = None) -> "CLRTransformer":  # noqa: ARG002
        return self

    def transform(self, X: np.ndarray) -> np.ndarray:
        return clr(X, delta=self.delta)

    def fit_transform(self, X: np.ndarray, y: np.ndarray | None = None) -> np.ndarray:
        return self.fit(X, y).transform(X)
