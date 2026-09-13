# ScalpBiome

A scalp & skin microbiome analyzer. Upload or pick a taxonomic abundance profile and
immediately see whether the community looks **healthy** or **dysbiotic**, which microbes are
driving that call, and what shifts would move it toward a healthy community.

Built for a live demo at an AWS × SCELSE microbiome seminar. Runs fully offline: no API keys,
no external services, no data downloads.

---

## Quick start

Two terminals, one command each.

**Terminal 1 — backend (http://localhost:8000)**

```bash
cd backend && ./run.sh
```

Creates a virtual environment, installs dependencies, trains the classifier on synthetic data
at startup, and serves the API.

**Terminal 2 — frontend (http://localhost:5173)**

```bash
cd frontend && npm install && npm run dev
```

Open **http://localhost:5173**. The app loads with the *Healthy scalp* sample already
analyzed, so there is an immediate visual with nothing to click.

Every panel has a **?** help bubble explaining what it shows and what it does not. Bubbles open
on hover, on keyboard focus, or on click, and close with Escape.

### Requirements

- Python 3.11–3.13 (`run.sh` prefers `python3.13`; override with `PYTHON_BIN=python3.12 ./run.sh`).
  Python 3.14 is not recommended yet since some scientific wheels are still catching up.
- Node.js 18+

---

## The biology being modelled

Nine taxa, in `backend/app/taxa.py`. Two genera are deliberately **split to species** because
their members carry opposite associations with scalp health:

| Taxon | Healthy reference | Direction |
| --- | --- | --- |
| *Cutibacterium acnes* | 49.0% | protective (keystone) |
| *Staphylococcus capitis* | 12.0% | risk |
| *Staphylococcus epidermidis* | 9.0% | protective |
| *Malassezia restricta* | 7.5% | risk |
| *Malassezia globosa* | 4.5% | protective |
| *Corynebacterium* | 5.0% | protective |
| *Streptococcus* | 2.0% | neutral |
| *Micrococcus* | 2.0% | neutral |
| Other (long tail) | 9.0% | aggregate |

### Calibration

Reference proportions are anchored on measured scalp communities, principally
[Grimshaw et al. 2019, PLoS ONE 14:e0225796](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0225796),
which paired 16S + ITS2 profiling with species-level qPCR on healthy and dandruff scalps.
Corroborating work: [Clavaud et al. 2013](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0058203),
[Xu et al. 2016](https://www.nature.com/articles/srep24877), and
[Saxena et al. 2018](https://www.frontiersin.org/journals/cellular-and-infection-microbiology/articles/10.3389/fcimb.2018.00346/full).

Three findings shape the model, and each one contradicts a common simplification:

**Healthy scalp carries plenty of *Staphylococcus*.** Measured means are roughly 56%
*Cutibacterium* and 24.5% *Staphylococcus* among bacteria on healthy scalps. The "healthy means
low *Staphylococcus*" folk model is wrong by about threefold. The reference here gives a
*Cutibacterium*:*Staphylococcus* ratio of **2.33**, matching the ~2.3 implied by those means.
Dandruff lesional sites fall below about 1.5, so the discriminating window is narrow.

**Total *Malassezia* load barely differs.** *Malassezia* dominates the mycobiome on healthy and
dandruff scalps alike, with no significant difference in relative abundance, and fungal
communities did not cluster by scalp condition. The fungal signal lives in the **species
balance**: *M. restricta* rises and *M. globosa* falls at severe-flaking sites. Modelling
"elevated *Malassezia*" as the primary dandruff driver would lean on the weakest available
signal, so this app leads with the bacterial axis instead, consistent with Xu et al. finding the
bacterial association stronger than the fungal one.

**The two *Staphylococcus* species move in opposite directions.** Species-level qPCR shows
*S. capitis* rising with dandruff severity while *S. epidermidis* falls. The genus-level
increase is driven by *S. capitis*. A single genus feature would average two opposing
associations into noise, which is why the split matters.

The classifier derives its own per-taxon risk direction from the training data, and it agrees
with the declared biology on all six directional taxa. That consistency check runs in
`verify.py`.

### Dysbiotic profiles are lesional-site profiles

Community shifts reached significance at **lesional sites**; whole-head averages differed far
less, and non-lesional sites on dandruff scalps clustered with healthy scalps. The three
dysbiotic built-in profiles are therefore labelled and described as lesional sites. Presenting
them as whole-scalp averages would overstate the effect size.

### Assay assumption

Profiles are modelled as a **single shotgun-metagenomics composition** mixing bacterial and
fungal fractions. This matters: 16S and ITS amplicon runs are normalised separately and cannot
be concatenated into one set of proportions, and 16S recovers no *Malassezia* at all. Since AWS
HealthOmics metagenomics workflows produce shotgun output, the assumption holds for the
intended data path.

If you upload a bacteria-only table, the app says so rather than silently returning a confident
verdict on a profile with no fungal component.

---

## How the analysis works

### Metrics

Three **ratios** carry the discriminating signal, and each is shown against its healthy
reference value:

- *Cutibacterium* : *Staphylococcus* — primary bacterial axis (healthy ~2.3)
- *M. restricta* : *M. globosa* — fungal axis (healthy ~1.7)
- *S. epidermidis* : *S. capitis* — within-genus axis (healthy ~0.75)

Ratio denominators are floored at a 0.1% detection limit and values are capped, so a sample
with no detected *Staphylococcus* cannot render a meaningless six-figure ratio.

**Shannon index and evenness are reported as context, not as a health signal.** A healthy
sebaceous scalp is dominated by *Cutibacterium*, so low diversity is the healthy baseline; the
"low diversity means dysbiosis" heuristic comes from gut microbiome work and does not transfer.
Among the built-in profiles only post-antibiotic has genuinely reduced diversity, and the
seborrheic profile is *more* diverse than healthy. Richness is computed but is not shown as a
headline tile: over a fixed nine-taxon vector it barely moves, and it is not comparable to
richness from a real survey that recovers 100+ genera.

### Classifier

Pipeline: **composition → CLR → standardise → logistic regression**.

Relative abundances are compositional, so they are mapped through a **centred log-ratio**
transform before modelling (`transforms.py`); ordinary statistics on raw proportions ignore the
constraint that components sum to one. Zeros are handled by multiplicative replacement rather
than a flat pseudocount, which preserves ratios between observed parts.

Logistic regression is used rather than a black box because its coefficients give an exact
per-taxon decomposition, which is what the drivers panel reports.

### Drivers

Drivers decompose the log-odds gap between the sample and the healthy reference:

```
logit(x) - logit(ref) = Σ  wᵢ · (clr(x)ᵢ - clr(ref)ᵢ) / scaleᵢ
```

The standardiser's mean cancels in the difference, so this is exact, and the terms sum to the
log-odds gap (asserted in `verify.py`).

Centring on the **reference** rather than on the training-cohort mean is load-bearing. CLR
coordinates share a geometric mean, so every coordinate moves when any taxon moves. Decomposed
against the cohort mean, that cross-talk let the aggregated `Other` bucket outrank the taxon
actually carrying the signal. Against the reference, the dominant term in each coordinate is
`ln(xᵢ / refᵢ)` — exactly the "how far from healthy" quantity the UI reports.

One residual artifact is handled in the wording: because CLR coordinates are constrained to sum
to zero, a taxon sitting exactly at its reference still carries a small non-zero term. Those
taxa rank low and are described as *at reference* rather than as pushing either way. `Other` is
excluded from the panel entirely, since calling a mixture of unrelated taxa a "driver" would not
mean anything.

### Recommendations

Taxa are ranked by absolute deviation from the reference, but only deviations in a **harmful
direction** become recommendations: risk taxa when elevated, protective taxa when depleted.
Without that filter a healthy sample whose *Cutibacterium* sits slightly above the cohort mean
would be advised to suppress its own keystone commensal. Aggregate buckets are skipped.

This is descriptive guidance about community composition, not clinical advice.

### Synthetic data

Profiles are drawn from a **Dirichlet** distribution centred on per-class template
compositions. Dirichlet is the natural choice: its support is exactly the simplex, so every
draw is a valid composition without post-hoc renormalisation. Rare-taxon dropout then mimics
non-detection at shallow sequencing depth. Fixed seed, so results are identical run to run.

The dysbiotic class is split across three sub-types (dandruff, seborrheic, post-antibiotic) so
the model learns the family of degraded communities rather than one archetype.

### On the accuracy figure

The reported accuracy is measured on held-out samples from **the same generative model** that
produced the training data. It confirms the pipeline learns the structure it was given. It is
**not biological validation** — no sequenced scalp samples were used. The UI labels it
"Synthetic hold-out" and states this inline rather than burying it, because presented as plain
"accuracy" it implies a validation that has not happened. Real validation would need sequenced
scalp samples with paired clinical scores.

---

## Deployment

Live at **https://d3vn5sgkb90sy1.cloudfront.net**

```
CloudFront ──(default)──> S3 bucket (private, OAC)          static SPA
           └─(/api/*)───> API Gateway HTTP API ─> Lambda     inference
```

Serving both from one distribution means the browser sees a single origin, so the API needs no
CORS headers and no cross-origin surface exists.

Two stacks:
- `ScalpBiomeWaf` in **us-east-1** — a web ACL scoped to CLOUDFRONT must live there
- `ScalpBiome` in **ap-southeast-1** (Singapore)

```bash
cd infra && npm install
npx cdk deploy --all          # WAF first, then the app stack
python3 security-audit.py     # 75 assertions against the synthesized templates
npx cdk destroy --all         # app stack first; the stack dependency enforces order
```

No Docker required. `pip` cross-downloads Linux/arm64 wheels, and CDK's local bundling runs
`backend/build-lambda-package.sh` on the host.

### Why API Gateway rather than a Lambda function URL

A Lambda function URL with CloudFront origin access control (OAC) was tried first, since it
keeps the origin unreachable except via a SigV4-signed request from one specific distribution.
CloudFront's signed requests were rejected with a 403 from the function URL authorizer. Ruled
out, each by direct test:

- **Not the resource policy** — an unconditional allow for `cloudfront.amazonaws.com`, with 90
  seconds of propagation, still failed.
- **Not Host or Authorization forwarding** — failed with the managed
  `AllViewerExceptHostHeader` policy and with a custom allow-list omitting both.
- **Not compression**, and **not** the documented permission-before-OAC ordering (detaching and
  reattaching the OAC with the permission already present changed nothing).
- **Not the function** — a directly SigV4-signed request returned 200, and `aws lambda invoke`
  returned 200.

OAC signing was confirmed active: with the OAC attached Lambda returns `Forbidden. For
troubleshooting Function URL authorization issues…`, and with it detached the response changes
to plain `Forbidden`. Controlled comparisons showed an invalid signature produces a different
message again ("signature we calculated does not match"), so the request was arriving signed and
being denied at authorization.

An HTTP API with a Lambda proxy integration is the pattern already running in this account, so
it was adopted as the known-good configuration rather than continuing to guess.

### Keeping CloudFront the only route in

An `execute-api` endpoint is publicly resolvable, which would otherwise bypass CloudFront and
WAF. CloudFront injects an `x-scalpbiome-origin` header on every origin request and the
application refuses anything without it, compared in constant time:

```
$ curl https://<api-id>.execute-api.ap-southeast-1.amazonaws.com/api/health
{"detail":"Direct access is not permitted. Requests must arrive through the CloudFront distribution."}   403

$ curl https://d3vn5sgkb90sy1.cloudfront.net/api/health
{"status":"ok","model_ready":true}                                                                      200
```

Stated plainly: this stops opportunistic scanning of execute-api hostnames. It is **not a
credential** — the value is readable by anyone with CloudFront or CloudFormation read access in
the account, and it is derived deterministically so redeploys do not churn the distribution.
Override it with `--context originSecret=...` if you want a value not derivable from the
account id. A real secret would belong in Secrets Manager, which CloudFront custom headers
cannot resolve at request time.

### Security posture

Verified by `infra/security-audit.py` (75 assertions), cdk-nag AwsSolutionsChecks, and cfn-lint.

- S3 site bucket private behind OAC; direct S3 GET returns 403. All four public-access blocks
  on, encryption on, non-TLS requests denied by bucket policy.
- Execution role holds **only** `AWSLambdaBasicExecutionRole` (CloudWatch Logs). No S3, KMS,
  Secrets Manager or DynamoDB, so there is nothing for a compromised handler to reach.
- WAF: per-IP rate limit (600 requests / 5 min, blocking) plus AWS managed Common, Known Bad
  Inputs and IP Reputation rule groups.
- Lambda reserved concurrency of 20 — a hard ceiling on cost and blast radius independent of WAF.
- Input bounds enforced in the application, not only at the edge: 256 KiB uploads, 2000 rows,
  50 columns, 500 taxa keys, 60 trajectory steps. Uploads are read in bounded chunks rather
  than trusting Content-Length.
- CSP with `script-src 'self'` and no inline or eval; HSTS one year; nosniff; frame DENY;
  strict-origin-when-cross-origin. No third-party origins at all — the webfont CDN was removed.
- API Gateway access logging records request metadata only: no headers, bodies or query
  strings, because an uploaded abundance table may be unpublished data.
- `/api/*` uses CachingDisabled: the same URL returns different results per request body, so a
  shared cache could serve one caller's analysis to another.
- No secrets in the templates (asserted).

**Two things to know.** The API is **unauthenticated** by design: a public demo with no
accounts, no persistence, and nothing to protect. The controls above address abuse of compute
and availability, not confidentiality. And the **TLS floor is 1.0**: with the default
`*.cloudfront.net` certificate CloudFront pins the security policy and ignores
`minimumProtocolVersion`, so modern browsers negotiate 1.2/1.3 but older clients are accepted.
Raising it requires a custom domain with an ACM certificate.

Running cost is roughly **$9–10/month**, almost entirely WAF ($5 web ACL + ~$4 of rules).
CloudFront, Lambda, API Gateway and S3 all sit inside free tier at demo volumes.

---

## AWS HealthOmics integration

The input layer is structured so a real metagenomics run can drop in where the CSV upload sits
today. The seam is `backend/app/healthomics.py`:

```python
load_from_healthomics(s3_uri: str, region_name: str = "ap-southeast-1") -> Dict[str, float]
```

It is a documented stub and is intentionally not implemented, so nothing about the demo depends
on AWS credentials.

**Where it plugs in.** An AWS HealthOmics metagenomics workflow (a taxonomic profiler such as
Kraken2/Bracken or MetaPhlAn wrapped in a HealthOmics run) writes a taxonomic
relative-abundance table to an S3 output prefix. `load_from_healthomics()` reads that table and
returns the same `{taxon: fraction}` mapping the app already consumes, so **no downstream code
changes**: `taxa.to_vector()` normalises it onto the canonical taxa, maps name aliases, splits
genus-level values, folds unknown genera into `Other`, and reports what it did. The local
CSV/TSV upload path in `main.py` already implements exactly this parsing, so swapping in S3 is
only a matter of fetching the bytes.

To make it real: add `boto3` to `requirements.txt`, grant the service read access to the output
bucket, and confirm the profiler emits species-level calls for *Staphylococcus* and
*Malassezia* (genus-level input still works, but the app will flag that it had to split it).

**Region.** Both the data and this inference service can stay in **ap-southeast-1** (Singapore),
co-located with SCELSE workloads, so nothing has to leave the region.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness and model-ready status |
| `GET` | `/api/samples` | Taxa metadata, built-in profiles, model info, assay note |
| `POST` | `/api/analyze` | Analyze a built-in sample (`sample_id`) or a raw profile (`abundances`) |
| `POST` | `/api/upload` | Analyze every sample column in a CSV/TSV cohort |

Interactive docs at **http://localhost:8000/docs**.

```bash
curl -X POST http://localhost:8000/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"sample_id":"dandruff"}'
```

Analyses include a `warnings` array describing how the input was interpreted (genus splits,
unrecognised taxa, missing fungal axis).

---

## Sample data

- `backend/sample_data/cohort_example.csv` — 5 subjects, species-level names
- `backend/sample_data/cohort_genus_level.csv` — 3 subjects, genus-level names, demonstrates
  the automatic *Staphylococcus* / *Malassezia* split and the resulting warning

**Worth demoing deliberately:** `Genus_02` in the genus-level file is the dandruff-like
composition, and it comes back **Healthy**. That is not a bug. Splitting a genus by
healthy-reference proportions pins the *S. epidermidis*:*S. capitis* and
*M. restricta*:*M. globosa* ratios at healthy values, so two of the three discriminating axes
are erased and only the *Cutibacterium*:*Staphylococcus* axis survives. It is a concise
demonstration of why the species split matters, and the warning banner says so on screen.

---

## Verification

```bash
cd backend && source .venv/bin/activate && python verify.py
```

Checks the literature calibration, that the driver decomposition is exact, that declared
biology agrees with the model's data-derived risk directions, that no recommendation suppresses
a protective taxon, the ratio edge cases, and the upload paths.

---

## Project layout

```
backend/
  app/
    taxa.py         9 canonical taxa, healthy reference, built-ins, name mapping
    data_gen.py     Dirichlet synthetic generator (trains the model)
    transforms.py   CLR + multiplicative zero replacement
    metrics.py      three ratios + Shannon/evenness/richness
    model.py        CLR pipeline, reference-centred drivers, recommendations
    healthomics.py  AWS HealthOmics / S3 input stub
    schemas.py      Pydantic request/response models
    main.py         FastAPI app
  sample_data/
  verify.py
  run.sh
frontend/
  src/
    api.ts          typed client + 9-taxon colour palette
    helpContent.tsx all help-bubble copy, in one place
    App.tsx         layout, seeding, cohort switching, data-quality banner
    components/     InfoBubble, VerdictCard, CompositionChart, DriversPanel,
                    MetricTiles, RecommendationsPanel, ReferenceRadar, Controls
```

The frontend proxies `/api` to `127.0.0.1:8000` in dev (`vite.config.ts`), so the browser sees a
single origin and there is no CORS friction during the demo.

---

## Notes for the presenter

- Nothing is fetched at runtime. Unplug the network and it still works.
- The model retrains on every backend start from a fixed seed, so the numbers on screen are the
  same every rehearsal.
- The healthy built-in profile is deliberately *not* identical to the reference. A real subject
  never sits exactly on the cohort mean, and a sample equal to the reference would produce
  all-zero driver contributions and an empty drivers panel on first load.
- If asked "is this 16S or shotgun?", the answer is in the footer and in the composition help
  bubble: shotgun, because bacteria and fungi share one composition.
- If asked about validation, the accuracy figure is labelled as a synthetic pipeline check in
  the UI itself. Do not describe it as accuracy on real samples.
- Health calls come from a model trained on synthetic data for demonstration. This is not a
  diagnostic tool.
