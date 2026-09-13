"""Domain model for the scalp microbiome.

Everything downstream (synthetic data, metrics, classifier, API) operates on the
canonical taxon ordering defined here, so a sample is always representable as a
fixed-length relative-abundance vector.

Calibration
-----------
Reference proportions are anchored on measured scalp communities, principally
Grimshaw et al. 2019 (PLoS ONE 14:e0225796), which paired 16S + ITS2 profiling
with species-level qPCR on healthy and dandruff scalps. Key figures used:

  * Cutibacterium mean relative abundance ~56% healthy, ~52% dandruff (bacteria).
  * Staphylococcus ~24.5% healthy, ~34% dandruff (bacteria). Note this is roughly
    three times higher than the "low Staphylococcus = healthy" folk model.
  * Malassezia dominates the mycobiome (>86% of fungal taxa) on BOTH healthy and
    dandruff scalps, with no significant difference in relative abundance. The
    fungal signal lives in species composition and absolute load, not genus share.
  * Species-level qPCR: S. capitis rises with dandruff severity while
    S. epidermidis falls. The genus-level increase is driven by S. capitis, so a
    single "Staphylococcus" feature would average out two opposing associations.
  * Community shifts were significant at *lesional* sites; whole-head averages
    were not. The dysbiotic profiles below are therefore lesional-site profiles.

Consequences for this model
---------------------------
1. Staphylococcus is split into S. epidermidis (protective) and S. capitis (risk).
2. Malassezia is split into M. restricta (risk) and M. globosa, so the
   restricta:globosa balance carries the fungal signal rather than genus load.
3. The bacterial axis (Cutibacterium vs Staphylococcus) is the primary
   discriminator, consistent with Xu et al. 2016 finding the bacterial
   association with dandruff stronger than the fungal one.

Assay assumption
----------------
A single vector mixing bacterial and fungal fractions is only meaningful for
SHOTGUN metagenomics. Amplicon studies sequence 16S and ITS separately and
normalise them independently, so their tables cannot be concatenated into one set
of proportions. See ASSAY_NOTE.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# Canonical taxa. Order matters: it defines the feature-vector layout used by
# the metrics and the classifier. "Other" absorbs the long tail so every
# profile sums to ~1.0.
# ---------------------------------------------------------------------------
TAXA: List[str] = [
    "Cutibacterium",     # C. acnes; keystone commensal of sebaceous sites
    "S. epidermidis",    # protective staphylococcal commensal (falls in dandruff)
    "S. capitis",        # staphylococcal risk species (rises with severity)
    "M. restricta",      # dominant scalp Malassezia; rises at lesional sites
    "M. globosa",        # second Malassezia; falls at severe lesional sites
    "Corynebacterium",   # skin commensal
    "Streptococcus",     # low-abundance / transient on scalp
    "Micrococcus",       # low-abundance commensal
    "Other",             # aggregated long tail
]

TAXON_INDEX: Dict[str, int] = {name: i for i, name in enumerate(TAXA)}
N_TAXA: int = len(TAXA)

ASSAY_NOTE = (
    "Profiles are modelled as a single shotgun-metagenomics composition mixing "
    "bacterial and fungal fractions. 16S and ITS amplicon tables are normalised "
    "separately and cannot be combined into one set of proportions."
)

# The smallest relative abundance treated as credible, i.e. the assumed limit of
# detection. Used consistently across the app: ratio denominators are floored
# here, zeros are replaced with it before the log-ratio transform, and the
# synthetic generator uses it to decide when a taxon could go undetected.
#
# Keeping one value matters for the log-ratio geometry. Replacing zeros with a
# value far below the smallest real measurement creates enormous CLR excursions
# that dominate the variance and swamp the biological signal.
DETECTION_LIMIT = 0.001  # 0.1%

# Taxa that make up the fungal (mycobiome) fraction.
FUNGAL_TAXA: List[str] = ["M. restricta", "M. globosa"]

# Aggregate buckets that are never actionable recommendation targets.
AGGREGATE_TAXA: List[str] = ["Other"]

# Declared biological risk direction per taxon:
#   +1  more of it is associated with dysbiosis (risk)
#   -1  more of it is associated with health (protective)
#    0  neutral or an aggregate, no meaningful direction
#
# This is a statement about biology, not about the fitted model, and it is what
# keeps recommendations sensible: without it, a sample whose Cutibacterium sits
# slightly above the cohort mean would be told to suppress its own keystone
# commensal. The classifier derives its own risk_sign from the training data and
# is expected to agree with the non-zero entries here.
RISK_DIRECTION: Dict[str, int] = {
    "Cutibacterium": -1,    # keystone commensal of sebaceous skin
    "S. epidermidis": -1,   # protective; depleted at lesional sites
    "S. capitis": +1,       # rises with flaking severity
    "M. restricta": +1,     # clearest fungal association with dandruff
    "M. globosa": -1,       # falls at the most severe sites
    "Corynebacterium": -1,  # part of a balanced commensal community
    "Streptococcus": 0,     # low abundance, no clear scalp association
    "Micrococcus": 0,       # low abundance, no clear scalp association
    "Other": 0,             # aggregate bucket
}

# Human-friendly labels and one-line descriptors used by the UI.
TAXON_META: Dict[str, Dict[str, str]] = {
    "Cutibacterium": {
        "full_name": "Cutibacterium acnes",
        "kind": "bacterium",
        "role": (
            "Keystone commensal of sebaceous skin and the most abundant genus on "
            "healthy scalp (~56% of bacteria). Formerly Propionibacterium."
        ),
    },
    "S. epidermidis": {
        "full_name": "Staphylococcus epidermidis",
        "kind": "bacterium",
        "role": (
            "Generally beneficial staphylococcal commensal. Absolute abundance "
            "decreases at dandruff lesional sites."
        ),
    },
    "S. capitis": {
        "full_name": "Staphylococcus capitis",
        "kind": "bacterium",
        "role": (
            "The most abundant scalp Staphylococcus species, and the one that "
            "rises with dandruff severity. It drives the genus-level increase."
        ),
    },
    "M. restricta": {
        "full_name": "Malassezia restricta",
        "kind": "fungus",
        "role": (
            "Dominant lipophilic yeast of the scalp mycobiome. Increases at "
            "severe-flaking sites; the clearest fungal dandruff association."
        ),
    },
    "M. globosa": {
        "full_name": "Malassezia globosa",
        "kind": "fungus",
        "role": (
            "Second major scalp Malassezia. Decreases at the most severe "
            "flaking sites, so the restricta:globosa balance is informative."
        ),
    },
    "Corynebacterium": {
        "full_name": "Corynebacterium",
        "kind": "bacterium",
        "role": "Skin commensal; more prominent at moist sites than on scalp.",
    },
    "Streptococcus": {
        "full_name": "Streptococcus",
        "kind": "bacterium",
        "role": "Low-abundance or transient taxon on the scalp.",
    },
    "Micrococcus": {
        "full_name": "Micrococcus",
        "kind": "bacterium",
        "role": "Low-abundance skin commensal.",
    },
    "Other": {
        "full_name": "Other taxa",
        "kind": "mixed",
        "role": (
            "Aggregated long tail. Real scalp surveys recover 100+ genera; this "
            "bucket stands in for everything outside the modelled taxa."
        ),
    },
}

# ---------------------------------------------------------------------------
# Reference healthy profile (fractions of the whole community).
#
# Derivation: bacterial fraction ~0.88 of the community, split using Grimshaw
# healthy bacterial proportions (Cutibacterium ~56%, Staphylococcus ~24.5%);
# fungal fraction ~0.12, split M. restricta : M. globosa at roughly 5:3.
#
# Resulting Cutibacterium : Staphylococcus = 0.49 / 0.21 = 2.33, closely
# matching the ~2.3 implied by the published healthy means.
# ---------------------------------------------------------------------------
HEALTHY_REFERENCE: Dict[str, float] = {
    "Cutibacterium": 0.490,
    "S. epidermidis": 0.090,
    "S. capitis": 0.120,
    "M. restricta": 0.075,
    "M. globosa": 0.045,
    "Corynebacterium": 0.050,
    "Streptococcus": 0.020,
    "Micrococcus": 0.020,
    "Other": 0.090,
}


# ---------------------------------------------------------------------------
# Known levers: what is documented to move a taxon, and how good the evidence is.
#
# The app can say which taxa need to move. Saying how to move them is a
# different and much weaker claim, so every entry carries an explicit evidence
# tier and, critically, a RESOLUTION: whether the published effect was measured
# at genus level or resolves to the species this model actually uses.
#
# That distinction is the point. Selenium disulfide has interventional evidence
# for reducing Staphylococcus and raising Cutibacterium, but those studies
# quantify Staphylococcus spp. as a genus. Since S. capitis and S. epidermidis
# move in OPPOSITE directions in dandruff (Grimshaw 2019), genus-level evidence
# cannot tell you which species a treatment suppressed. Presenting it as though
# it could would overstate the literature.
#
# No doses, durations or protocols: mechanism class only. This describes what is
# known to influence a taxon, not what anyone should do.
# ---------------------------------------------------------------------------

# Ordinal evidence tiers, strongest first.
EVIDENCE_TIERS: Dict[str, str] = {
    "randomised": "Randomised controlled trials",
    "interventional": "Interventional studies (non-randomised or single-arm)",
    "observational": "Observational association only",
    "none": "No established intervention",
}


@dataclass(frozen=True)
class Lever:
    """A documented way to move a taxon, with its evidence qualified."""

    # "decrease" or "increase": the direction the evidence supports.
    direction: str
    # Mechanism class, never a product recommendation or a dose.
    mechanism: str
    # Key of EVIDENCE_TIERS.
    evidence: str
    # "species" if the published effect resolves to this modelled taxon,
    # "genus" if only measured at genus level, "none" if not applicable.
    resolution: str
    # What the evidence does and does not support, in plain language.
    note: str
    # Short author-year citations.
    citations: Tuple[str, ...] = ()


KNOWN_LEVERS: Dict[str, Lever] = {
    "M. restricta": Lever(
        direction="decrease",
        mechanism="Topical antifungals: azoles, pyrithiones, selenium disulfide",
        evidence="randomised",
        resolution="genus",
        note=(
            "Reducing Malassezia load and flaking is well supported by randomised "
            "trials. Those trials measure Malassezia at genus or total-load level, "
            "so they do not establish an abundance target for M. restricta itself."
        ),
        citations=(
            "Pierard-Franchimont et al. 2002, Skin Pharmacol Appl Skin Physiol",
            "Schwartz et al. 2013, Int J Cosmet Sci",
            "Choi et al. 2019, J Dermatolog Treat (systematic review)",
        ),
    ),
    "Cutibacterium": Lever(
        direction="increase",
        mechanism="Selenium disulfide shampoo",
        evidence="interventional",
        resolution="genus",
        note=(
            "Selenium disulfide has been reported to raise Cutibacterium relative "
            "abundance while lowering Staphylococcus. The evidence is "
            "interventional rather than randomised, and measured at genus level."
        ),
        citations=(
            "Massiot et al. 2022, J Cosmet Dermatol",
            "Clavaud et al. 2023, Eur J Dermatol",
            "Jiang et al. 2026, Front Med (single-arm)",
        ),
    ),
    "S. capitis": Lever(
        direction="decrease",
        mechanism="Selenium disulfide shampoo (genus-level effect only)",
        evidence="interventional",
        resolution="genus",
        note=(
            "Total Staphylococcus has been reduced in intervention studies, but "
            "those studies quantify the genus. Because S. capitis and "
            "S. epidermidis move in opposite directions in dandruff, genus-level "
            "evidence cannot show which species was suppressed. No intervention is "
            "established as selective for S. capitis."
        ),
        citations=(
            "Massiot et al. 2022, J Cosmet Dermatol",
            "Jiang et al. 2026, Front Med",
            "Grimshaw et al. 2019, PLoS ONE (species divergence)",
        ),
    ),
    "S. epidermidis": Lever(
        direction="increase",
        mechanism="None established",
        evidence="none",
        resolution="none",
        note=(
            "No intervention is established to selectively restore S. epidermidis. "
            "Topical probiotics and microbiome transfer remain experimental and "
            "have not been shown to reach a scalp abundance target."
        ),
        citations=("Grimshaw et al. 2019, PLoS ONE",),
    ),
    "M. globosa": Lever(
        direction="increase",
        mechanism="None established (behaves as an outcome)",
        evidence="none",
        resolution="none",
        note=(
            "No intervention aims to raise M. globosa. Its share tends to recover "
            "as M. restricta is suppressed, so it acts as a consequence of "
            "rebalancing rather than a target."
        ),
        citations=("Grimshaw et al. 2019, PLoS ONE",),
    ),
    "Corynebacterium": Lever(
        direction="increase",
        mechanism="None established",
        evidence="none",
        resolution="none",
        note=(
            "No scalp intervention is established to raise Corynebacterium. Its "
            "recovery is reported alongside broader community rebalancing rather "
            "than as a treatment target."
        ),
        citations=(),
    ),
}


@dataclass
class SampleProfile:
    """A named relative-abundance profile."""

    id: str
    name: str
    description: str
    abundances: Dict[str, float] = field(default_factory=dict)

    def as_vector(self) -> List[float]:
        """Return abundances as a canonical-ordered, normalised vector."""
        vec = [max(0.0, float(self.abundances.get(t, 0.0))) for t in TAXA]
        total = sum(vec)
        if total <= 0:
            raise ValueError(f"Profile '{self.id}' has no positive abundance.")
        return [v / total for v in vec]


# ---------------------------------------------------------------------------
# Built-in demo profiles.
#
# The dysbiotic profiles represent LESIONAL sites, since that is where the
# published community shifts reach significance. Whole-head averages differ far
# less, and presenting these as whole-scalp profiles would overstate the effect.
# ---------------------------------------------------------------------------
BUILTIN_SAMPLES: List[SampleProfile] = [
    SampleProfile(
        id="healthy",
        name="Healthy scalp",
        description=(
            "Cutibacterium-dominant with Staphylococcus around a quarter of "
            "bacteria, and the fungal balance tipped toward M. globosa."
        ),
        # Deliberately NOT identical to HEALTHY_REFERENCE. A real subject never
        # sits exactly on the cohort mean, and a sample equal to the reference
        # would produce all-zero driver contributions, leaving the drivers panel
        # with nothing to say on first load.
        abundances={
            "Cutibacterium": 0.520,
            "S. epidermidis": 0.105,
            "S. capitis": 0.098,
            "M. restricta": 0.062,
            "M. globosa": 0.050,
            "Corynebacterium": 0.046,
            "Streptococcus": 0.018,
            "Micrococcus": 0.017,
            "Other": 0.084,
        },
    ),
    SampleProfile(
        id="dandruff",
        name="Dandruff (lesional site)",
        description=(
            "S. capitis expansion with S. epidermidis loss, and the fungal "
            "balance tipped toward M. restricta."
        ),
        abundances={
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
    ),
    SampleProfile(
        id="post_antibiotic",
        name="Post-antibiotic",
        description=(
            "Cutibacterium suppressed, heavy S. capitis overgrowth, minor taxa "
            "collapsed. The one profile with genuinely reduced diversity."
        ),
        abundances={
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
    ),
    SampleProfile(
        id="seborrheic",
        name="Oily / seborrheic",
        description=(
            "Sebum-rich community: expanded Malassezia alongside elevated "
            "S. capitis, with diversity higher than healthy rather than lower."
        ),
        abundances={
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
    ),
]

BUILTIN_BY_ID: Dict[str, SampleProfile] = {s.id: s for s in BUILTIN_SAMPLES}


# ---------------------------------------------------------------------------
# Input name mapping.
#
# Real tables use many spellings, and 16S tables often stop at genus level. We
# accept aliases, and where a genus must be split into its modelled species we
# apportion it using the healthy reference and report that we did so, rather
# than silently discarding the value or dumping it into "Other".
# ---------------------------------------------------------------------------
_ALIASES: Dict[str, str] = {
    # Cutibacterium / Propionibacterium
    "cutibacterium": "Cutibacterium",
    "cutibacterium acnes": "Cutibacterium",
    "c. acnes": "Cutibacterium",
    "c acnes": "Cutibacterium",
    "propionibacterium": "Cutibacterium",
    "propionibacterium acnes": "Cutibacterium",
    "p. acnes": "Cutibacterium",
    # Staphylococcus species
    "s. epidermidis": "S. epidermidis",
    "s epidermidis": "S. epidermidis",
    "staphylococcus epidermidis": "S. epidermidis",
    "staph epidermidis": "S. epidermidis",
    "s. capitis": "S. capitis",
    "s capitis": "S. capitis",
    "staphylococcus capitis": "S. capitis",
    "staph capitis": "S. capitis",
    # Malassezia species
    "m. restricta": "M. restricta",
    "m restricta": "M. restricta",
    "malassezia restricta": "M. restricta",
    "m. globosa": "M. globosa",
    "m globosa": "M. globosa",
    "malassezia globosa": "M. globosa",
    # Remaining modelled taxa
    "corynebacterium": "Corynebacterium",
    "streptococcus": "Streptococcus",
    "micrococcus": "Micrococcus",
    "other": "Other",
    "others": "Other",
    "unclassified": "Other",
}

# Genus-level names that must be split across modelled species, with the split
# taken from the healthy reference proportions.
_GENUS_SPLITS: Dict[str, Tuple[str, ...]] = {
    "staphylococcus": ("S. epidermidis", "S. capitis"),
    "staphylococcus spp.": ("S. epidermidis", "S. capitis"),
    "staphylococcus sp.": ("S. epidermidis", "S. capitis"),
    "malassezia": ("M. restricta", "M. globosa"),
    "malassezia spp.": ("M. restricta", "M. globosa"),
    "malassezia sp.": ("M. restricta", "M. globosa"),
}


def healthy_reference_vector() -> List[float]:
    """Normalised reference vector in canonical order."""
    vec = [HEALTHY_REFERENCE[t] for t in TAXA]
    total = sum(vec)
    return [v / total for v in vec]


def _canonical_name(raw: str) -> str | None:
    """Map an arbitrary taxon label onto a canonical taxon, or None."""
    key = raw.strip().strip('"').lower()
    key = key.replace("_", " ").replace("-", " ")
    while "  " in key:
        key = key.replace("  ", " ")
    if key in _ALIASES:
        return _ALIASES[key]
    # Exact canonical match (case-insensitive).
    for taxon in TAXA:
        if taxon.lower() == key:
            return taxon
    return None


def to_vector(abundances: Dict[str, float]) -> Tuple[List[float], List[str]]:
    """Normalise an arbitrary {taxon: value} mapping onto the canonical vector.

    Returns
    -------
    (vector, warnings)
        `vector` is normalised to sum to 1.0 in canonical taxon order.
        `warnings` describes any interpretation the caller should know about:
        genus-level values that were split, and unrecognised taxa folded into
        "Other".

    Input does not need to be pre-normalised; raw counts work fine.
    """
    vec = [0.0] * N_TAXA
    other_idx = TAXON_INDEX["Other"]
    warnings: List[str] = []
    split_genera: List[str] = []
    unknown: List[str] = []

    ref = HEALTHY_REFERENCE

    for name, value in abundances.items():
        if not isinstance(name, str):
            continue
        try:
            val = max(0.0, float(value))
        except (TypeError, ValueError):
            continue
        if val == 0.0:
            continue

        canonical = _canonical_name(name)
        if canonical is not None:
            vec[TAXON_INDEX[canonical]] += val
            continue

        # Genus-level label needing a split across modelled species.
        key = name.strip().lower().replace("_", " ")
        targets = _GENUS_SPLITS.get(key)
        if targets:
            weights = [ref[t] for t in targets]
            total_w = sum(weights) or 1.0
            for taxon, w in zip(targets, weights):
                vec[TAXON_INDEX[taxon]] += val * (w / total_w)
            split_genera.append(name.strip())
            continue

        # Unrecognised taxon: fold into the long tail.
        vec[other_idx] += val
        unknown.append(name.strip())

    total = sum(vec)
    if total <= 0:
        raise ValueError("Abundance profile has no positive values.")
    vec = [v / total for v in vec]

    if split_genera:
        pretty = ", ".join(sorted(set(split_genera)))
        warnings.append(
            f"Genus-level input ({pretty}) was apportioned across modelled "
            f"species using healthy-reference proportions. That assumption is "
            f"conservative and biases the call toward healthy: within-genus "
            f"balance is where much of the signal sits, so a dysbiotic sample "
            f"can read as healthy here. Species-level input is needed for a "
            f"reliable call."
        )
    if unknown:
        shown = ", ".join(sorted(set(unknown))[:6])
        more = "" if len(set(unknown)) <= 6 else f" and {len(set(unknown)) - 6} more"
        warnings.append(
            f"Unrecognised taxa folded into 'Other': {shown}{more}."
        )

    # Assay sanity check: a table with no fungal component is almost certainly
    # 16S-only, in which case the fungal axis is simply unavailable.
    fungal_total = sum(vec[TAXON_INDEX[t]] for t in FUNGAL_TAXA)
    if fungal_total <= 0:
        warnings.append(
            "No fungal taxa detected. This looks like a bacteria-only (16S) "
            "table; Malassezia cannot be recovered from 16S, so the fungal "
            "axis is unavailable and the call rests on bacteria alone."
        )

    return vec, warnings
