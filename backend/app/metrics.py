"""Diversity and ratio metrics for a single microbiome sample.

All functions take a relative-abundance vector in canonical taxon order (see
taxa.py). Vectors are renormalised defensively.

On diversity as a health signal
-------------------------------
Alpha diversity is reported as descriptive context, NOT as evidence of dysbiosis.
A healthy sebaceous scalp is dominated by Cutibacterium, so low diversity is the
healthy baseline; the "low diversity means dysbiosis" heuristic is imported from
gut microbiome work and does not transfer. Among the built-in profiles only
post-antibiotic has reduced diversity, while the seborrheic profile is more
diverse than healthy.

The discriminating metrics are the three ratios below.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np

from .taxa import DETECTION_LIMIT as _DETECTION_LIMIT
from .taxa import TAXON_INDEX

# A taxon counts as "present" above this fraction. Used for BOTH richness and the
# evenness denominator so the two cannot disagree about what is present.
PRESENCE_THRESHOLD = 0.01

# Smallest credible relative abundance, shared with the log-ratio transform and
# the synthetic generator (see taxa.DETECTION_LIMIT). Ratios floor their
# denominator here rather than at machine epsilon, which would let a zero
# denominator produce a meaningless six-figure ratio on screen.
DETECTION_LIMIT = _DETECTION_LIMIT

# Ratios are capped for display sanity; `*_capped` flags say when this happened.
RATIO_CAP = 100.0


@dataclass
class DiversityMetrics:
    shannon: float
    richness: int
    evenness: float                  # Pielou, using the same presence threshold
    cuti_staph_ratio: float          # Cutibacterium : total Staphylococcus
    cuti_staph_capped: bool
    restricta_globosa_ratio: float   # M. restricta : M. globosa
    restricta_globosa_capped: bool
    epidermidis_capitis_ratio: float  # S. epidermidis : S. capitis
    epidermidis_capitis_capped: bool
    fungal_fraction: float           # total mycobiome share
    dominant_taxon_index: int


def _normalise(vec: Sequence[float]) -> np.ndarray:
    arr = np.asarray(vec, dtype=float)
    arr = np.clip(arr, 0.0, None)
    total = arr.sum()
    if total <= 0:
        raise ValueError("Cannot compute metrics on an all-zero profile.")
    return arr / total


def _safe_ratio(numerator: float, denominator: float) -> tuple[float, bool]:
    """Ratio with a detection-limit floor and a display cap.

    Returns (value, was_capped). Flooring at DETECTION_LIMIT keeps a zero
    denominator from producing an absurd number; capping keeps the tile readable.
    """
    denom = max(denominator, DETECTION_LIMIT)
    value = numerator / denom
    if value > RATIO_CAP:
        return RATIO_CAP, True
    return float(value), False


def shannon_index(vec: Sequence[float]) -> float:
    """Shannon diversity H = -sum(p_i * ln p_i), natural log."""
    p = _normalise(vec)
    nz = p[p > 0]
    return float(-np.sum(nz * np.log(nz)))


def richness(vec: Sequence[float], threshold: float = PRESENCE_THRESHOLD) -> int:
    """Number of modelled taxa present above `threshold`.

    Note this is richness over the modelled taxa only, capped at N_TAXA. It is
    not comparable to richness from a real survey, which recovers 100+ genera.
    """
    p = _normalise(vec)
    return int(np.sum(p > threshold))


def pielou_evenness(vec: Sequence[float], threshold: float = PRESENCE_THRESHOLD) -> float:
    """Pielou's evenness in [0, 1]; 1.0 = perfectly even community.

    Uses the same presence threshold as `richness` so the two are consistent.
    """
    p = _normalise(vec)
    r = int(np.sum(p > threshold))
    if r <= 1:
        return 0.0
    # Shannon over the taxa counted as present, so numerator and denominator
    # describe the same community.
    present = p[p > threshold]
    present = present / present.sum()
    h = float(-np.sum(present * np.log(present)))
    return float(h / np.log(r))


def cuti_staph_ratio(vec: Sequence[float]) -> tuple[float, bool]:
    """Cutibacterium : total Staphylococcus.

    The primary bacterial axis. Published healthy means imply roughly 2.3, and
    dandruff lesional sites fall below ~1.5, so this is a narrower window than
    the folk model suggests.
    """
    p = _normalise(vec)
    cuti = p[TAXON_INDEX["Cutibacterium"]]
    staph = p[TAXON_INDEX["S. epidermidis"]] + p[TAXON_INDEX["S. capitis"]]
    return _safe_ratio(float(cuti), float(staph))


def restricta_globosa_ratio(vec: Sequence[float]) -> tuple[float, bool]:
    """M. restricta : M. globosa.

    The fungal axis. Total Malassezia load barely differs between healthy and
    dandruff scalps, so genus share is uninformative; the species balance is
    where the signal sits.
    """
    p = _normalise(vec)
    restricta = p[TAXON_INDEX["M. restricta"]]
    globosa = p[TAXON_INDEX["M. globosa"]]
    return _safe_ratio(float(restricta), float(globosa))


def epidermidis_capitis_ratio(vec: Sequence[float]) -> tuple[float, bool]:
    """S. epidermidis : S. capitis.

    Within-genus axis. S. capitis rises with dandruff severity while
    S. epidermidis falls, so this ratio separates samples that a genus-level
    Staphylococcus feature would treat as identical.
    """
    p = _normalise(vec)
    epi = p[TAXON_INDEX["S. epidermidis"]]
    cap = p[TAXON_INDEX["S. capitis"]]
    return _safe_ratio(float(epi), float(cap))


def fungal_fraction(vec: Sequence[float]) -> float:
    """Total mycobiome share of the community."""
    p = _normalise(vec)
    return float(
        p[TAXON_INDEX["M. restricta"]] + p[TAXON_INDEX["M. globosa"]]
    )


def compute_metrics(vec: Sequence[float]) -> DiversityMetrics:
    """Compute the full metric bundle for one sample."""
    p = _normalise(vec)
    cs, cs_capped = cuti_staph_ratio(p)
    rg, rg_capped = restricta_globosa_ratio(p)
    ec, ec_capped = epidermidis_capitis_ratio(p)
    return DiversityMetrics(
        shannon=shannon_index(p),
        richness=richness(p),
        evenness=pielou_evenness(p),
        cuti_staph_ratio=cs,
        cuti_staph_capped=cs_capped,
        restricta_globosa_ratio=rg,
        restricta_globosa_capped=rg_capped,
        epidermidis_capitis_ratio=ec,
        epidermidis_capitis_capped=ec_capped,
        fungal_fraction=fungal_fraction(p),
        dominant_taxon_index=int(np.argmax(p)),
    )
