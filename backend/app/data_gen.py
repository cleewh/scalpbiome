"""Synthetic scalp-microbiome data generator.

Produces biologically plausible healthy and dysbiotic relative-abundance profiles.
This is what makes the app self-contained and reproducible: the classifier is
trained on this synthetic cohort at startup, so there are no data files,
downloads, or credentials to manage.

Generative model
----------------
Profiles are drawn from a **Dirichlet** distribution centred on per-class template
compositions. Dirichlet is the natural choice here: its support is exactly the
simplex, so every draw is a valid composition summing to 1 without post-hoc
renormalisation, and a single concentration parameter controls dispersion. Lower
concentration produces more variable communities.

Rare-taxon dropout is applied afterwards to mimic non-detection at shallow
sequencing depth. The dropout threshold deliberately targets genuinely
low-abundance taxa only; an earlier version used a threshold high enough to
exclude every major taxon, which made the mechanism almost inert.

Calibration
-----------
Templates follow the measured proportions documented in taxa.py (Grimshaw et al.
2019). Note in particular:

  * Healthy Staphylococcus is substantial (~21% of the community here), not
    trace. The discriminating signal is *which* Staphylococcus: S. capitis
    expands with severity while S. epidermidis contracts.
  * Total Malassezia load is roughly stable across classes. The fungal signal is
    carried by the M. restricta : M. globosa balance.
  * Diversity is NOT treated as a dysbiosis marker. On sebaceous sites a healthy
    community is already highly dominated by one taxon, so low diversity is the
    healthy baseline. Only the post-antibiotic template has genuinely reduced
    diversity; the seborrheic template is more diverse than healthy. Diversity is
    reported as descriptive context, not as evidence of dysbiosis.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np

from .taxa import DETECTION_LIMIT, TAXA, N_TAXA

# Class labels used throughout the model layer.
LABEL_HEALTHY = 0
LABEL_DYSBIOTIC = 1

# Dirichlet concentration. Higher values sit tighter around the template.
#
# 90 is chosen deliberately over something tighter. At concentration 220 the two
# classes barely overlap and the classifier scores ~99.5%, which is not a
# flattering number: it says the synthetic problem is too easy to be informative.
# At 90 the classes overlap the way real cohorts do, hold-out accuracy lands
# around 96%, and the ordination still separates cleanly enough to be legible.
DEFAULT_CONCENTRATION = 90.0

# A taxon can go undetected only if its *sampled* abundance lands near the
# detection limit. Keyed on the drawn value rather than the template mean,
# because a taxon sitting at 2% is reliably detected at any sensible sequencing
# depth no matter how rare it is on average.
#
# An earlier version keyed dropout on the template mean, which dropped 2% taxa
# outright. Combined with log-ratio geometry that produced excursions bigger than
# the biological signal, and the ordination ended up fitting the dropout pattern.
NON_DETECTION_CEILING = 5.0 * DETECTION_LIMIT  # 0.5%


# Mean compositions per (sub)type. These are the Dirichlet means; see taxa.py for
# how they were derived from published proportions.
_TEMPLATES: Dict[str, Dict[str, float]] = {
    "healthy": {
        "Cutibacterium": 0.490,
        "S. epidermidis": 0.090,
        "S. capitis": 0.120,
        "M. restricta": 0.075,
        "M. globosa": 0.045,
        "Corynebacterium": 0.050,
        "Streptococcus": 0.020,
        "Micrococcus": 0.020,
        "Other": 0.090,
    },
    # Dysbiotic sub-types (lesional-site compositions) ----------------------
    "dandruff": {
        "Cutibacterium": 0.410,
        "S. epidermidis": 0.070,
        "S. capitis": 0.260,
        "M. restricta": 0.110,
        "M. globosa": 0.030,
        "Corynebacterium": 0.040,
        "Streptococcus": 0.020,
        "Micrococcus": 0.015,
        "Other": 0.045,
    },
    "seborrheic": {
        "Cutibacterium": 0.340,
        "S. epidermidis": 0.060,
        "S. capitis": 0.220,
        "M. restricta": 0.200,
        "M. globosa": 0.040,
        "Corynebacterium": 0.040,
        "Streptococcus": 0.015,
        "Micrococcus": 0.015,
        "Other": 0.070,
    },
    "post_antibiotic": {
        "Cutibacterium": 0.100,
        "S. epidermidis": 0.050,
        "S. capitis": 0.460,
        "M. restricta": 0.140,
        "M. globosa": 0.020,
        "Corynebacterium": 0.015,
        "Streptococcus": 0.005,
        "Micrococcus": 0.005,
        "Other": 0.205,
    },
}

_DYSBIOTIC_SUBTYPES: List[str] = ["dandruff", "seborrheic", "post_antibiotic"]


def _template_vector(name: str) -> np.ndarray:
    t = _TEMPLATES[name]
    return np.array([t[taxon] for taxon in TAXA], dtype=float)


def _sample_from_template(
    template: np.ndarray,
    rng: np.random.Generator,
    concentration: float,
    dropout_p: float,
) -> np.ndarray:
    """Draw one composition from a Dirichlet centred on `template`.

    Dropout then zeroes rare taxa with probability `dropout_p`, after which the
    composition is renormalised.
    """
    alpha = np.clip(template * concentration, 1e-6, None)
    vec = rng.dirichlet(alpha)

    # Non-detection: only taxa that happened to land near the detection limit can
    # be reported as absent, which is how non-detection actually behaves.
    for i in range(N_TAXA):
        if vec[i] < NON_DETECTION_CEILING and rng.random() < dropout_p:
            vec[i] = 0.0

    total = vec.sum()
    if total <= 0:
        return template / template.sum()
    return vec / total


def generate_dataset(
    n_per_class: int = 300,
    seed: int = 42,
    concentration: float = DEFAULT_CONCENTRATION,
    dropout_p: float = 0.25,
) -> Tuple[np.ndarray, np.ndarray]:
    """Generate a balanced synthetic cohort.

    Returns
    -------
    X : np.ndarray, shape (2 * n_per_class, N_TAXA)
        Compositions in canonical taxon order (rows sum to 1).
    y : np.ndarray, shape (2 * n_per_class,)
        Labels (LABEL_HEALTHY / LABEL_DYSBIOTIC).
    """
    rng = np.random.default_rng(seed)

    healthy_template = _template_vector("healthy")
    rows: List[np.ndarray] = []
    labels: List[int] = []

    for _ in range(n_per_class):
        rows.append(
            _sample_from_template(healthy_template, rng, concentration, dropout_p)
        )
        labels.append(LABEL_HEALTHY)

    # Dysbiotic class spread evenly across sub-types, so the model learns the
    # family of degraded communities rather than one archetype.
    for i in range(n_per_class):
        subtype = _DYSBIOTIC_SUBTYPES[i % len(_DYSBIOTIC_SUBTYPES)]
        template = _template_vector(subtype)
        # Dysbiotic communities are more variable and lose rare taxa more often.
        rows.append(
            _sample_from_template(
                template, rng, concentration * 0.8, dropout_p * 1.3
            )
        )
        labels.append(LABEL_DYSBIOTIC)

    X = np.vstack(rows)
    y = np.array(labels, dtype=int)

    order = rng.permutation(len(y))
    return X[order], y[order]


def generate_profile_dict(kind: str = "healthy", seed: int | None = None) -> Dict[str, float]:
    """Convenience: one noisy profile as a {taxon: fraction} dict.

    `kind` is 'healthy' or one of the dysbiotic sub-type names.
    """
    if kind not in _TEMPLATES:
        raise ValueError(f"Unknown profile kind '{kind}'. Options: {list(_TEMPLATES)}")
    rng = np.random.default_rng(seed)
    vec = _sample_from_template(
        _template_vector(kind), rng, DEFAULT_CONCENTRATION, 0.25
    )
    return {TAXA[i]: float(vec[i]) for i in range(N_TAXA)}
