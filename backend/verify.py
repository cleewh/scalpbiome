#!/usr/bin/env python
"""Verification suite for ScalpBiome.

Checks the things that would embarrass the presenter if they were wrong:
literature calibration, exactness of the driver decomposition, agreement between
declared biology and the model's data-derived risk directions, sane
recommendations, ratio edge cases, and the input-parsing paths.

Run:  python verify.py
Exits non-zero if any check fails.
"""

from __future__ import annotations

import sys
import warnings

import numpy as np

warnings.filterwarnings("ignore")

from app import metrics, taxa  # noqa: E402
from app.main import STATE, _build_analysis  # noqa: E402
from app.model import ScalpModel  # noqa: E402

FAILURES: list[str] = []
CHECKS = 0


def check(condition: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    print(("  PASS  " if condition else "  FAIL  ") + message)
    if not condition:
        FAILURES.append(message)


def section(title: str) -> None:
    print(f"\n{title}\n{'-' * len(title)}")


model = ScalpModel()
STATE["model"] = model

BACTERIAL_FRACTION = 1.0 - sum(
    taxa.HEALTHY_REFERENCE[t] for t in taxa.FUNGAL_TAXA
)

# ---------------------------------------------------------------------------
section("1. Literature calibration (Grimshaw et al. 2019)")
# ---------------------------------------------------------------------------
ref = taxa.HEALTHY_REFERENCE
cuti_of_bacteria = ref["Cutibacterium"] / BACTERIAL_FRACTION
staph_of_bacteria = (ref["S. epidermidis"] + ref["S. capitis"]) / BACTERIAL_FRACTION

check(
    0.52 <= cuti_of_bacteria <= 0.60,
    f"Cutibacterium is {cuti_of_bacteria * 100:.0f}% of bacteria (published ~56%)",
)
check(
    0.21 <= staph_of_bacteria <= 0.28,
    f"Staphylococcus is {staph_of_bacteria * 100:.0f}% of bacteria (published ~24.5%)",
)

healthy_vec = taxa.healthy_reference_vector()
cs, _ = metrics.cuti_staph_ratio(healthy_vec)
check(
    2.1 <= cs <= 2.6,
    f"reference Cutibacterium:Staphylococcus = {cs:.2f} (published means imply ~2.3)",
)

dandruff_vec = taxa.BUILTIN_BY_ID["dandruff"].as_vector()
cs_d, _ = metrics.cuti_staph_ratio(dandruff_vec)
check(
    cs_d < cs,
    f"dandruff ratio {cs_d:.2f} sits below the healthy reference {cs:.2f}",
)

# ---------------------------------------------------------------------------
section("2. Species splits carry opposite directions")
# ---------------------------------------------------------------------------
check(
    taxa.RISK_DIRECTION["S. capitis"] > 0
    and taxa.RISK_DIRECTION["S. epidermidis"] < 0,
    "S. capitis is a risk taxon while S. epidermidis is protective",
)
check(
    taxa.RISK_DIRECTION["M. restricta"] > 0
    and taxa.RISK_DIRECTION["M. globosa"] < 0,
    "M. restricta is a risk taxon while M. globosa is protective",
)

mismatches = [
    t
    for t in taxa.TAXA
    if taxa.RISK_DIRECTION[t] != 0
    and taxa.RISK_DIRECTION[t] != int(model.risk_sign[taxa.TAXON_INDEX[t]])
]
check(
    not mismatches,
    f"declared biology agrees with the model's data-derived risk signs "
    f"({'none differ' if not mismatches else 'differs: ' + ', '.join(mismatches)})",
)

# ---------------------------------------------------------------------------
section("3. Driver decomposition is exact")
# ---------------------------------------------------------------------------


def logit(v) -> float:
    z = model.scaler.transform(model.clr.transform(np.asarray(v).reshape(1, -1)))
    return float(model.clf.decision_function(z)[0])


for sid in ["healthy", "dandruff", "post_antibiotic", "seborrheic"]:
    vec = np.asarray(taxa.BUILTIN_BY_ID[sid].as_vector())
    all_drivers = model._drivers(vec, model.clr.transform(vec.reshape(1, -1))[0])
    total = sum(d.contribution for d in all_drivers)
    expected = logit(vec) - logit(model._ref_vec)
    check(
        abs(total - expected) < 1e-6,
        f"{sid}: sum of contributions ({total:+.4f}) equals "
        f"logit(x) - logit(ref) ({expected:+.4f})",
    )

# ---------------------------------------------------------------------------
section("4. Classification and metric behaviour")
# ---------------------------------------------------------------------------
expected_labels = {
    "healthy": "Healthy",
    "dandruff": "Dysbiotic",
    "post_antibiotic": "Dysbiotic",
    "seborrheic": "Dysbiotic",
}
results = {}
for sid, want in expected_labels.items():
    s = taxa.BUILTIN_BY_ID[sid]
    r = _build_analysis(s.as_vector(), s.name)
    results[sid] = r
    check(r.label == want, f"{sid} -> {r.label} ({r.confidence * 100:.1f}%)")
    check(
        abs(sum(c.abundance for c in r.composition) - 1.0) < 0.02,
        f"{sid} composition sums to ~1",
    )
    check(
        all(d.taxon not in taxa.AGGREGATE_TAXA for d in r.drivers),
        f"{sid} drivers exclude the aggregate 'Other' bucket",
    )

# The healthy seed must not equal the reference, or its drivers panel is empty.
healthy_profile = np.asarray(taxa.BUILTIN_BY_ID["healthy"].as_vector())
check(
    float(np.abs(healthy_profile - np.asarray(healthy_vec)).sum()) > 0.02,
    "healthy built-in differs from the reference, so drivers have something to say",
)
check(
    any(d.vs_reference != "near" for d in results["healthy"].drivers),
    "healthy sample shows at least one non-trivial driver",
)

# ---------------------------------------------------------------------------
section("5. Diversity is not miscast as a dysbiosis marker")
# ---------------------------------------------------------------------------
h_shannon = results["healthy"].metrics.shannon
seb_shannon = results["seborrheic"].metrics.shannon
pa_shannon = results["post_antibiotic"].metrics.shannon
check(
    seb_shannon > h_shannon,
    f"seborrheic Shannon ({seb_shannon}) exceeds healthy ({h_shannon}), so the "
    f"'dysbiosis = low diversity' claim is not being made",
)
check(
    pa_shannon < h_shannon,
    f"post-antibiotic Shannon ({pa_shannon}) is below healthy ({h_shannon})",
)

# ---------------------------------------------------------------------------
section("6. Recommendations never fight the biology")
# ---------------------------------------------------------------------------
bad = []
for sid, r in results.items():
    for rec in r.recommendations:
        d = taxa.RISK_DIRECTION[rec.taxon]
        if rec.action == "decrease" and d < 0:
            bad.append(f"{sid}: told to reduce protective {rec.taxon}")
        if rec.action == "increase" and d > 0:
            bad.append(f"{sid}: told to increase risk {rec.taxon}")
        if rec.taxon in taxa.AGGREGATE_TAXA:
            bad.append(f"{sid}: recommended action on aggregate {rec.taxon}")
check(not bad, f"no counter-productive recommendations ({'; '.join(bad) or 'clean'})")
check(
    not results["healthy"].recommendations,
    "healthy sample produces no corrective recommendations",
)

# ---------------------------------------------------------------------------
section("6b. Intervention claims are evidence-graded and not overstated")
# ---------------------------------------------------------------------------
# Guards against the failure mode where a plausible-sounding intervention gets
# attached to a taxon without qualifying what the literature actually shows.
for name, lever in taxa.KNOWN_LEVERS.items():
    check(name in taxa.TAXA, f"{name}: lever refers to a modelled taxon")
    check(
        lever.evidence in taxa.EVIDENCE_TIERS,
        f"{name}: evidence tier '{lever.evidence}' is a declared tier",
    )
    check(
        lever.direction in ("increase", "decrease"),
        f"{name}: direction is explicit ({lever.direction})",
    )
    check(
        lever.resolution in ("species", "genus", "none"),
        f"{name}: resolution declared ({lever.resolution})",
    )
    # A claim backed by evidence must cite something.
    if lever.evidence != "none":
        check(
            len(lever.citations) > 0,
            f"{name}: non-empty evidence tier carries citations",
        )
    # No doses, products or protocols anywhere in the catalogue.
    blob = f"{lever.mechanism} {lever.note}".lower()
    for banned in ("mg", "%", "twice daily", "once daily", "apply ", "prescrib"):
        check(banned not in blob, f"{name}: mechanism states no dose/protocol ('{banned}')")

# The load-bearing scientific point: genus-level evidence must not be presented
# as species-specific for a genus whose species diverge.
for species in ("S. capitis", "S. epidermidis"):
    lever = taxa.KNOWN_LEVERS.get(species)
    if lever and lever.evidence != "none":
        check(
            lever.resolution == "genus",
            f"{species}: genus-level evidence is labelled as such, not as species-level",
        )
        check(
            "genus" in lever.note.lower(),
            f"{species}: note explains the genus/species limitation",
        )

check(
    taxa.KNOWN_LEVERS["S. epidermidis"].evidence == "none",
    "no intervention is claimed to selectively restore S. epidermidis",
)
check(
    taxa.KNOWN_LEVERS["M. restricta"].evidence == "randomised",
    "antifungal reduction of Malassezia is the one randomised-evidence claim",
)

# ---------------------------------------------------------------------------
section("7. Ratio edge cases")
# ---------------------------------------------------------------------------
no_staph, _ = taxa.to_vector(
    {"Cutibacterium": 0.7, "M. restricta": 0.2, "M. globosa": 0.1}
)
dm = metrics.compute_metrics(no_staph)
check(
    dm.cuti_staph_ratio <= metrics.RATIO_CAP and dm.cuti_staph_capped,
    f"zero Staphylococcus yields a capped ratio ({dm.cuti_staph_ratio}), not a "
    f"six-figure number",
)

sparse = [0.6, 0.39, 0.005, 0.005, 0.0, 0.0, 0.0, 0.0, 0.0]
sm = metrics.compute_metrics(sparse)
check(
    sm.richness == 2,
    f"richness counts only taxa above {metrics.PRESENCE_THRESHOLD:.0%} (got {sm.richness})",
)
check(
    0.0 <= sm.evenness <= 1.0,
    f"evenness stays in [0,1] on a sparse profile (got {sm.evenness:.3f})",
)

# ---------------------------------------------------------------------------
section("8. Input parsing")
# ---------------------------------------------------------------------------
genus_vec, genus_warnings = taxa.to_vector(
    {
        "Cutibacterium": 0.49,
        "Staphylococcus": 0.21,
        "Malassezia": 0.12,
        "Corynebacterium": 0.05,
        "Streptococcus": 0.02,
        "Micrococcus": 0.02,
        "Other": 0.09,
    }
)
check(
    np.allclose(genus_vec, healthy_vec, atol=1e-6),
    "genus-level input splits to exactly the healthy reference",
)
check(
    any("apportioned" in w for w in genus_warnings),
    "genus split is reported to the user",
)

_, only_16s = taxa.to_vector(
    {"Cutibacterium": 0.56, "Staphylococcus": 0.245, "Other": 0.195}
)
check(
    any("16S" in w for w in only_16s),
    "bacteria-only table triggers the missing-fungal-axis warning",
)

alias_vec, _ = taxa.to_vector(
    {
        "Propionibacterium acnes": 0.49,
        "Staphylococcus_epidermidis": 0.09,
        "S. capitis": 0.12,
        "Malassezia restricta": 0.075,
        "M. globosa": 0.045,
        "Corynebacterium": 0.05,
        "Streptococcus": 0.02,
        "Micrococcus": 0.02,
        "Other": 0.09,
    }
)
check(
    np.allclose(alias_vec, healthy_vec, atol=1e-6),
    "name aliases (Propionibacterium, underscores, abbreviations) all resolve",
)

counts_vec, _ = taxa.to_vector(
    {"Cutibacterium": 4900, "S. epidermidis": 900, "S. capitis": 1200}
)
check(
    abs(sum(counts_vec) - 1.0) < 1e-9,
    "raw counts are renormalised to a composition",
)

# ---------------------------------------------------------------------------
print(f"\n{'=' * 60}")
if FAILURES:
    print(f"{len(FAILURES)} of {CHECKS} checks FAILED:")
    for f in FAILURES:
        print(f"  - {f}")
    sys.exit(1)
print(f"All {CHECKS} checks passed.")
