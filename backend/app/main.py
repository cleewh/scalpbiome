"""ScalpBiome FastAPI application.

Endpoints
---------
GET  /api/health   liveness + model status
GET  /api/samples  taxa metadata, built-in profiles, model info, assay note
POST /api/analyze  analyze a built-in sample (by id) or a raw abundance profile
POST /api/upload   analyze a CSV/TSV cohort (rows = taxa, columns = samples)

The classifier is trained once at startup (synthetic data, fixed seed) and held in
application state, so every request is fast and reproducible.
"""

from __future__ import annotations

import secrets
from contextlib import asynccontextmanager
from typing import Dict, List, Tuple

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Header CloudFront adds to every origin request so the API can tell
# CloudFront-originated traffic from direct hits on the execute-api endpoint.
ORIGIN_SECRET_HEADER = "x-scalpbiome-origin"

from . import healthomics as healthomics_mod
from . import metrics as metrics_mod
from . import model as model_mod
from . import tables as tables_mod
from . import taxa as taxa_mod
from .model import ScalpModel, generate_recommendations
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    CompositionEntry,
    DriverOut,
    LeverOut,
    MetricsOut,
    ModelInfo,
    OrdinationPoint,
    OrdinationResponse,
    Point,
    RadarEntry,
    RatioOut,
    RecommendationOut,
    SampleSummary,
    SamplesResponse,
    TaxonInfo,
    TrajectoryRequest,
    TrajectoryResponse,
    TrajectoryStep,
    Waterfall,
    WaterfallStep,
)
from .settings import settings

STATE: Dict[str, object] = {}


def _build_model() -> ScalpModel:
    """Construct and train the classifier.

    Logistic regression on CLR coordinates gives interpretable per-sample
    drivers; swap model_type="random_forest" to compare.
    """
    return ScalpModel(
        model_type="logistic",
        n_per_class=settings.model_samples_per_class,
        seed=settings.model_seed,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the model at startup under uvicorn. Under Lambda the lifespan may not
    # run, or may run per invocation depending on the adapter, so _get_model()
    # below also initialises lazily and caches. Training is idempotent and
    # seeded, so either path yields the identical model.
    STATE.setdefault("model", _build_model())
    yield
    STATE.clear()


app = FastAPI(
    title="ScalpBiome API",
    version="3.0.0",
    description="Scalp & skin microbiome health analyzer.",
    lifespan=lifespan,
)

# CORS.
#
# In the deployed stack the SPA and the API are served from one CloudFront
# distribution, so requests are same-origin and no CORS headers are needed; the
# allow-list stays empty and nothing cross-origin is permitted. Locally, Vite
# proxies /api so it is same-origin there too. The localhost entries exist only
# for running the frontend without the proxy, and are opt-out via env.
#
# Credentials are never allowed: there is no session, cookie, or auth token in
# this app, so enabling them would add risk for no benefit.
_cors_origins = list(settings.cors_allow_origins)
_cors_origin_regex = (
    r"http://(localhost|127\.0\.0\.1):\d+" if settings.allow_localhost_cors else None
)
if _cors_origins or _cors_origin_regex:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_origin_regex=_cors_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        max_age=600,
    )


def _get_model() -> ScalpModel:
    """Return the trained model, building it once per process if needed.

    Caching at module scope rather than relying on the ASGI lifespan matters on
    Lambda: some adapters run the lifespan around every invocation, which would
    retrain the model on each request and add seconds of latency. Here training
    happens at most once per execution environment.
    """
    model = STATE.get("model")
    if model is None:
        model = _build_model()
        STATE["model"] = model
    return model  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Plain-language driver explanations
# ---------------------------------------------------------------------------
def _driver_explanation(driver: model_mod.Driver) -> str:
    """Phrase one driver in plain language.

    Contributions are exact log-odds terms measured against the healthy
    reference, so the sign agrees with (deviation from reference) crossed with
    (whether the taxon is a risk or protective one). The wording follows the same
    two facts, so the sentence can never contradict the bar beside it.
    """
    cur = driver.abundance * 100
    ref = driver.reference * 100
    taxon = driver.taxon
    toward_dysbiotic = driver.direction == "toward_dysbiotic"

    # Taxa sitting at their reference value carry only the small residual term
    # from the CLR sum-to-zero constraint. Say so rather than implying a push.
    if driver.vs_reference == "near":
        return (
            f"{taxon} at {cur:.0f}% sits close to the healthy ~{ref:.0f}%, "
            f"so it barely influences the call."
        )

    fold = driver.fold_change
    if driver.vs_reference == "elevated":
        magnitude = f"{fold:.1f}x the healthy ~{ref:.0f}%"
        if toward_dysbiotic:
            return (
                f"{taxon} elevated at {cur:.0f}%, {magnitude}, pushing the call "
                f"toward dysbiotic."
            )
        return (
            f"{taxon} elevated at {cur:.0f}%, {magnitude}. This taxon is "
            f"protective, so the excess supports a healthy call."
        )

    # depleted
    shortfall = f"down from the healthy ~{ref:.0f}%"
    if toward_dysbiotic:
        return (
            f"{taxon} depleted at {cur:.0f}%, {shortfall}, pushing the call "
            f"toward dysbiotic."
        )
    return (
        f"{taxon} reduced at {cur:.0f}%, {shortfall}. Lower levels of this "
        f"taxon lean healthy."
    )


def _lever_for(taxon: str, action: str) -> LeverOut | None:
    """Documented means of moving a taxon in the requested direction.

    Returns None when nothing is catalogued, or when the catalogued evidence is
    for the opposite direction: evidence that a treatment lowers a taxon says
    nothing about how to raise it.
    """
    lever = taxa_mod.KNOWN_LEVERS.get(taxon)
    if lever is None or lever.direction != action:
        return None
    return LeverOut(
        mechanism=lever.mechanism,
        evidence=lever.evidence,
        evidence_label=taxa_mod.EVIDENCE_TIERS[lever.evidence],
        resolution=lever.resolution,
        note=lever.note,
        citations=list(lever.citations),
    )


def _build_analysis(
    vec: List[float],
    sample_name: str,
    warnings: List[str] | None = None,
    top_drivers: int = 4,
) -> AnalyzeResponse:
    """Run the full pipeline for one normalised composition."""
    model = _get_model()
    pred = model.predict(vec)
    div = metrics_mod.compute_metrics(vec)
    recs = generate_recommendations(vec, max_items=3)
    ref_vec = taxa_mod.healthy_reference_vector()

    composition = [
        CompositionEntry(
            taxon=taxa_mod.TAXA[i],
            full_name=taxa_mod.TAXON_META[taxa_mod.TAXA[i]]["full_name"],
            kind=taxa_mod.TAXON_META[taxa_mod.TAXA[i]]["kind"],
            abundance=round(vec[i], 4),
            reference=round(ref_vec[i], 4),
        )
        for i in range(taxa_mod.N_TAXA)
    ]

    # Aggregate buckets are excluded from the drivers panel. "Other" is a
    # mixture of unrelated taxa, so calling it a risk or protective driver has
    # no biological meaning even when its contribution is numerically large.
    # model.predict() still decomposes the full composition; this is display-only.
    interpretable = [d for d in pred.drivers if d.taxon not in taxa_mod.AGGREGATE_TAXA]
    drivers = [
        DriverOut(
            taxon=d.taxon,
            abundance=round(d.abundance, 4),
            reference=round(d.reference, 4),
            contribution=round(d.contribution, 4),
            direction=d.direction,
            risk_sign=d.risk_sign,
            vs_reference=d.vs_reference,
            fold_change=round(d.fold_change, 3),
            explanation=_driver_explanation(d),
        )
        for d in interpretable[:top_drivers]
    ]

    metrics_out = MetricsOut(
        shannon=round(div.shannon, 3),
        richness=div.richness,
        evenness=round(div.evenness, 3),
        cuti_staph=RatioOut(
            value=round(div.cuti_staph_ratio, 2), capped=div.cuti_staph_capped
        ),
        restricta_globosa=RatioOut(
            value=round(div.restricta_globosa_ratio, 2),
            capped=div.restricta_globosa_capped,
        ),
        epidermidis_capitis=RatioOut(
            value=round(div.epidermidis_capitis_ratio, 2),
            capped=div.epidermidis_capitis_capped,
        ),
        fungal_fraction=round(div.fungal_fraction, 4),
        dominant_taxon=taxa_mod.TAXA[div.dominant_taxon_index],
    )

    radar = [
        RadarEntry(
            taxon=taxa_mod.TAXA[i],
            sample=round(vec[i], 4),
            healthy=round(ref_vec[i], 4),
        )
        for i in range(taxa_mod.N_TAXA)
    ]

    # Full exact decomposition. Every taxon is included so the waterfall closes;
    # truncating it would defeat the purpose of showing it.
    wf = model.waterfall(vec)
    waterfall = Waterfall(
        base_logit=wf["base_logit"],
        base_prob=wf["base_prob"],
        final_logit=wf["final_logit"],
        final_prob=wf["final_prob"],
        residual=wf["residual"],
        steps=[WaterfallStep(**s) for s in wf["steps"]],
    )

    return AnalyzeResponse(
        sample_name=sample_name,
        label=pred.label,
        confidence=round(pred.confidence, 4),
        prob_healthy=round(pred.prob_healthy, 4),
        prob_dysbiotic=round(pred.prob_dysbiotic, 4),
        composition=composition,
        drivers=drivers,
        metrics=metrics_out,
        recommendations=[
            RecommendationOut(**r.as_dict(), lever=_lever_for(r.taxon, r.action))
            for r in recs
        ],
        radar=radar,
        waterfall=waterfall,
        ordination=Point(**model.project(vec)),
        warnings=warnings or [],
    )


# ---------------------------------------------------------------------------
# Input validation shared by the JSON endpoints
# ---------------------------------------------------------------------------
def _vector_from_request(
    sample_id: str | None, abundances: Dict[str, float] | None
) -> Tuple[List[float], List[str], str]:
    """Resolve a request into (vector, warnings, display_name).

    Bounds the abundance mapping: unknown taxa fold into "Other", so there is no
    legitimate reason for a caller to send thousands of keys, and parsing an
    unbounded mapping is needless work on a public endpoint.
    """
    if sample_id:
        sample = taxa_mod.BUILTIN_BY_ID.get(sample_id)
        if sample is None:
            raise HTTPException(
                status_code=404, detail=f"Unknown sample_id '{sample_id}'."
            )
        return sample.as_vector(), [], sample.name

    if abundances:
        if len(abundances) > settings.max_abundance_keys:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Too many taxa: {len(abundances)} exceeds the limit of "
                    f"{settings.max_abundance_keys}."
                ),
            )
        try:
            vec, warnings = taxa_mod.to_vector(abundances)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return vec, warnings, "Custom sample"

    raise HTTPException(
        status_code=400, detail="Provide either 'sample_id' or 'abundances'."
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "model_ready": STATE.get("model") is not None}


@app.middleware("http")
async def require_origin_secret(request: Request, call_next):
    """Reject requests that did not arrive through CloudFront.

    The API sits behind an API Gateway HTTP API, whose execute-api endpoint is
    publicly resolvable. CloudFront injects a shared header on every origin
    request; anything without it is refused, so the CloudFront distribution (and
    therefore WAF rate limiting) is the only usable path in.

    This is defence in depth against opportunistic scanning of execute-api
    endpoints, not a user credential: the value is visible to anyone with read
    access to the distribution config in this account. It is compared in constant
    time regardless, since a timing oracle would make guessing cheaper.

    Disabled when no secret is configured, which is the local-development case.
    """
    expected = settings.origin_secret
    if expected:
        provided = request.headers.get(ORIGIN_SECRET_HEADER, "")
        if not secrets.compare_digest(provided, expected):
            return JSONResponse(
                status_code=403,
                content={
                    "detail": (
                        "Direct access is not permitted. Requests must arrive "
                        "through the CloudFront distribution."
                    )
                },
            )
    return await call_next(request)


@app.get("/api/samples", response_model=SamplesResponse)
def get_samples() -> SamplesResponse:
    model = _get_model()
    ref = taxa_mod.HEALTHY_REFERENCE
    taxa_info = [
        TaxonInfo(
            name=t,
            full_name=taxa_mod.TAXON_META[t]["full_name"],
            kind=taxa_mod.TAXON_META[t]["kind"],
            role=taxa_mod.TAXON_META[t]["role"],
            reference=ref[t],
            risk_sign=int(model.risk_sign[taxa_mod.TAXON_INDEX[t]]),
        )
        for t in taxa_mod.TAXA
    ]
    samples = [
        SampleSummary(
            id=s.id, name=s.name, description=s.description, abundances=s.abundances
        )
        for s in taxa_mod.BUILTIN_SAMPLES
    ]
    model_info = ModelInfo(
        model_type=model.model_type,
        transform="clr",
        synthetic_holdout_accuracy=round(model.synthetic_holdout_accuracy, 4),
        validation_note=model.validation_note,
        global_importance={
            k: round(v, 4) for k, v in model.global_importance().items()
        },
    )
    return SamplesResponse(
        taxa=taxa_info,
        samples=samples,
        model=model_info,
        assay_note=taxa_mod.ASSAY_NOTE,
    )


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    vec, warnings, default_name = _vector_from_request(req.sample_id, req.abundances)
    return _build_analysis(vec, req.name or default_name, warnings)


@app.get("/api/ordination", response_model=OrdinationResponse)
def ordination() -> OrdinationResponse:
    """The synthetic training cloud projected into two dimensions.

    Computed once at startup, so this is a cheap static payload.
    """
    model = _get_model()
    return OrdinationResponse(
        points=[OrdinationPoint(**p) for p in model.ordination_points],
        reference=Point(**model.ordination_reference),
        explained_variance=model.ordination_explained,
        method="Aitchison PCA (PCA on unstandardised CLR coordinates)",
        note=(
            "Euclidean distance in this plot is Aitchison distance, the standard "
            "metric for compositional data. Axes are principal components of the "
            "CLR-transformed training set; the percentages give the share of "
            "total variance each captures."
        ),
    )


@app.post("/api/trajectory", response_model=TrajectoryResponse)
def trajectory(req: TrajectoryRequest) -> TrajectoryResponse:
    """Interpolate from a sample to the healthy reference and score each step."""
    if req.steps > settings.max_trajectory_steps:
        raise HTTPException(
            status_code=400,
            detail=(
                f"steps must be <= {settings.max_trajectory_steps} "
                f"(requested {req.steps})."
            ),
        )
    model = _get_model()
    vec, _, _ = _vector_from_request(req.sample_id, req.abundances)
    path = model.trajectory(vec, steps=req.steps)
    crosses = next(
        (p["fraction"] for p in path if p["prob_dysbiotic"] < 0.5), None
    )
    return TrajectoryResponse(
        path=[TrajectoryStep(**p) for p in path],
        crosses_at=crosses,
        method="Linear interpolation in CLR space (geodesic in Aitchison geometry)",
        note=(
            "Each step is a weighted geometric mean of the endpoints, so every "
            "point on the path is a valid composition. This is a simulated "
            "direction of travel, not longitudinal data, and it does not model "
            "any specific intervention."
        ),
    )


@app.get("/api/healthomics/demo")
def healthomics_demo() -> dict:
    """Run the real S3 ingest path against an in-process mock.

    Demonstrates that the HealthOmics integration is implemented rather than
    sketched. Uses moto to intercept boto3, so there are no network calls, no
    credentials, and no real AWS resources involved.
    """
    if not settings.enable_healthomics_demo:
        raise HTTPException(status_code=404, detail="HealthOmics demo is disabled.")
    try:
        result = healthomics_mod.demo_healthomics_roundtrip()
    except healthomics_mod.HealthOmicsError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Feed the loaded table through the same normalisation and analysis the
    # upload path uses, so the response shows the full journey end to end.
    try:
        vec, warnings = taxa_mod.to_vector(result["abundances"])  # type: ignore[arg-type]
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    analysis = _build_analysis(vec, "HealthOmics run 1234567890", warnings)
    return {
        "source": {
            "s3_uri": result["s3_uri"],
            "region": result["region"],
            "bytes": result["bytes"],
            "raw_taxa": result["raw_taxa"],
            "note": result["note"],
        },
        "raw_abundances": result["abundances"],
        "analysis": analysis.model_dump(),
    }


async def _read_bounded(file: UploadFile) -> bytes:
    """Read an upload in chunks, refusing anything over the configured cap.

    Reading with a cap rather than trusting Content-Length: the header is
    attacker-controlled, so the only reliable bound is how much we actually read.
    """
    limit = settings.max_upload_bytes
    chunks: List[bytes] = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds the {limit // 1024} KiB limit.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)) -> dict:
    """Parse a CSV/TSV abundance table and analyze every sample column.

    Layout: rows = taxa, columns = samples. The first column holds taxon names.
    Delimiter is auto-detected. Genus-level Staphylococcus and Malassezia are
    split across modelled species (reported in `warnings`), and unknown taxa fold
    into 'Other'.

    This is the local equivalent of a HealthOmics/S3 abundance table
    (see healthomics.load_from_healthomics).
    """
    raw = await _read_bounded(file)
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    text = raw.decode("utf-8-sig", errors="replace")
    try:
        table = tables_mod.parse_table(
            text,
            max_rows=settings.max_rows,
            max_sample_columns=settings.max_sample_columns,
        )
    except tables_mod.TableError as exc:
        # Bound violations are 413; genuine parse problems are 400.
        status = 413 if "exceeds the limit" in str(exc) else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc

    analyses = []
    for i, name in enumerate(table.sample_names):
        try:
            vec, warnings = taxa_mod.to_vector(table.as_mapping(i))
        except ValueError:
            # Skip empty/degenerate sample columns rather than failing the batch.
            continue
        analyses.append(_build_analysis(vec, name, warnings))

    if not analyses:
        raise HTTPException(
            status_code=400,
            detail="No usable sample columns found (all empty or non-numeric).",
        )

    return {"count": len(analyses), "analyses": [a.model_dump() for a in analyses]}
