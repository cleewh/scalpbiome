"""Pydantic request/response schemas for the ScalpBiome API."""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class TaxonInfo(BaseModel):
    name: str
    full_name: str
    kind: str
    role: str
    reference: float = Field(..., description="Healthy-reference relative abundance.")
    risk_sign: int = Field(
        ..., description="+1 => more abundant in dysbiotic samples; -1 => protective."
    )


class SampleSummary(BaseModel):
    id: str
    name: str
    description: str
    abundances: Dict[str, float]


class AnalyzeRequest(BaseModel):
    """Analyze either a built-in sample (by id) or a raw abundance profile."""

    sample_id: Optional[str] = Field(
        default=None, description="Id of a built-in sample to analyze."
    )
    abundances: Optional[Dict[str, float]] = Field(
        default=None,
        description=(
            "{taxon: value}; counts or fractions. Genus-level Staphylococcus and "
            "Malassezia are split across modelled species; unknown taxa fold "
            "into 'Other'."
        ),
    )
    name: Optional[str] = Field(default=None, description="Display name for the sample.")


class CompositionEntry(BaseModel):
    taxon: str
    full_name: str
    kind: str
    abundance: float
    reference: float


class DriverOut(BaseModel):
    taxon: str
    abundance: float
    reference: float
    contribution: float
    direction: str
    risk_sign: int
    vs_reference: str = Field(..., description="elevated | depleted | near")
    fold_change: float
    explanation: str


class RatioOut(BaseModel):
    """A ratio metric plus whether it hit the display cap."""

    value: float
    capped: bool


class MetricsOut(BaseModel):
    shannon: float
    richness: int
    evenness: float
    cuti_staph: RatioOut
    restricta_globosa: RatioOut
    epidermidis_capitis: RatioOut
    fungal_fraction: float
    dominant_taxon: str


class LeverOut(BaseModel):
    """What is documented to move a taxon, with the evidence qualified."""

    mechanism: str = Field(
        ..., description="Mechanism class only. Never a product, dose or protocol."
    )
    evidence: str = Field(
        ..., description="randomised | interventional | observational | none"
    )
    evidence_label: str
    resolution: str = Field(
        ...,
        description=(
            "'species' if the published effect resolves to this taxon, 'genus' if "
            "only measured at genus level, 'none' if not applicable. Genus-level "
            "evidence cannot attribute an effect to one species of that genus."
        ),
    )
    note: str
    citations: List[str]


class RecommendationOut(BaseModel):
    taxon: str
    current: float
    target: float
    action: str
    message: str
    lever: Optional[LeverOut] = Field(
        default=None,
        description="Documented means of moving this taxon, if any is established.",
    )


class RadarEntry(BaseModel):
    taxon: str
    sample: float
    healthy: float


class WaterfallStep(BaseModel):
    taxon: str
    contribution: float
    cumulative_logit: float
    cumulative_prob: float
    direction: str
    abundance: float
    reference: float


class Waterfall(BaseModel):
    """Exact decomposition of the log-odds gap from reference to sample."""

    base_logit: float
    base_prob: float
    final_logit: float
    final_prob: float
    residual: float = Field(
        ...,
        description=(
            "final_logit minus the last cumulative value. Exposed so callers can "
            "verify the decomposition closes; expected to be ~0."
        ),
    )
    steps: List[WaterfallStep]


class Point(BaseModel):
    x: float
    y: float


class OrdinationPoint(BaseModel):
    x: float
    y: float
    label: str


class OrdinationResponse(BaseModel):
    points: List[OrdinationPoint]
    reference: Point
    explained_variance: List[float]
    method: str
    note: str


class TrajectoryStep(BaseModel):
    step: int
    fraction: float
    prob_dysbiotic: float
    label: str
    x: float
    y: float
    composition: Dict[str, float]


class TrajectoryRequest(BaseModel):
    sample_id: Optional[str] = None
    abundances: Optional[Dict[str, float]] = None
    steps: int = Field(default=24, ge=2)


class TrajectoryResponse(BaseModel):
    path: List[TrajectoryStep]
    crosses_at: Optional[float] = Field(
        default=None,
        description="Interpolation fraction where P(dysbiotic) first drops below 0.5.",
    )
    method: str
    note: str


class AnalyzeResponse(BaseModel):
    sample_name: str
    label: str
    confidence: float
    prob_healthy: float
    prob_dysbiotic: float
    composition: List[CompositionEntry]
    drivers: List[DriverOut]
    metrics: MetricsOut
    recommendations: List[RecommendationOut]
    radar: List[RadarEntry]
    waterfall: Waterfall
    ordination: Point = Field(
        ..., description="This sample's position in the Aitchison ordination."
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Data-quality notes: genus splits, unknown taxa, missing fungal axis.",
    )


class ModelInfo(BaseModel):
    model_type: str
    transform: str
    synthetic_holdout_accuracy: float
    validation_note: str
    global_importance: Dict[str, float]


class SamplesResponse(BaseModel):
    taxa: List[TaxonInfo]
    samples: List[SampleSummary]
    model: ModelInfo
    assay_note: str
