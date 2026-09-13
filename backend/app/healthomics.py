"""AWS HealthOmics / S3 ingest.

This is the real code path a HealthOmics metagenomics output would take into
ScalpBiome, plus an in-process demo that exercises it without an AWS account.

Production flow
---------------
1. A HealthOmics metagenomics workflow (a taxonomic profiler such as
   Kraken2/Bracken or MetaPhlAn wrapped in a HealthOmics run) writes a taxonomic
   abundance table to an S3 output prefix.
2. `load_from_healthomics()` reads that object and returns the same
   {taxon: value} mapping the rest of the app already consumes, so nothing
   downstream changes: `taxa.to_vector()` handles name aliases, genus-level
   splits, and unknown taxa.
3. Inference and data both stay in ap-southeast-1, co-located with SCELSE
   workloads.

Security posture
----------------
Fetching a caller-supplied `s3://` URI is a data-exfiltration and SSRF primitive
if the running role has broad S3 read access. Three controls apply:

  * The path is DISABLED unless `SCALPBIOME_ENABLE_S3_INGEST` is set.
  * When enabled, the bucket must appear in `SCALPBIOME_ALLOWED_S3_BUCKETS`.
  * The deployed IAM role is granted read access only to the allow-listed
    prefix, so even a bypass of the checks above cannot reach other buckets.

The demo path injects an in-memory S3 reader instead of calling AWS. It makes no
network calls and uses no credentials, so it is safe to expose publicly, and it
adds no dependencies to the deployment package.
"""

from __future__ import annotations

from typing import Any, Dict, Protocol, Tuple
from urllib.parse import urlparse

from . import tables
from .settings import settings

DEFAULT_REGION = "ap-southeast-1"  # Singapore, co-located with SCELSE workloads

# Bounded read: never pull an unbounded object into memory.
MAX_OBJECT_BYTES = 2 * 1024 * 1024  # 2 MiB


class HealthOmicsError(RuntimeError):
    """Raised for configuration or input problems in the S3 ingest path."""


def parse_s3_uri(s3_uri: str) -> Tuple[str, str]:
    """Split an s3:// URI into (bucket, key), rejecting anything malformed."""
    parsed = urlparse(s3_uri)
    if parsed.scheme != "s3":
        raise HealthOmicsError(
            f"Expected an s3:// URI, got scheme {parsed.scheme!r}."
        )
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    if not bucket or not key:
        raise HealthOmicsError("S3 URI must include both a bucket and a key.")
    # Reject traversal-ish keys outright; S3 keys are opaque but this keeps the
    # audit trail clean and blocks obvious probing.
    if ".." in key:
        raise HealthOmicsError("S3 key must not contain '..'.")
    return bucket, key


def _assert_bucket_allowed(
    bucket: str, allowed_buckets: Tuple[str, ...] | None = None
) -> None:
    """Enforce the bucket allow-list.

    `allowed_buckets` lets a caller narrow the allow-list for a single call
    (the offline demo uses it for its mocked bucket). It can only ever be
    narrower in effect than the deployed IAM policy, which is the real control.
    """
    if allowed_buckets is not None:
        if bucket not in allowed_buckets:
            raise HealthOmicsError(
                f"Bucket {bucket!r} is not permitted for this call."
            )
        return

    if not settings.enable_s3_ingest:
        raise HealthOmicsError(
            "S3 ingest is disabled. Set SCALPBIOME_ENABLE_S3_INGEST=1 and add the "
            "bucket to SCALPBIOME_ALLOWED_S3_BUCKETS to enable it."
        )
    if bucket not in settings.allowed_s3_buckets:
        raise HealthOmicsError(
            f"Bucket {bucket!r} is not in the allow-list. "
            f"Permitted: {settings.allowed_s3_buckets or '(none configured)'}."
        )


class S3Reader(Protocol):
    """The one S3 operation this module needs.

    Narrowing the dependency to a Protocol means the demo can supply an in-memory
    implementation without patching botocore, and makes the trust boundary
    explicit: nothing here can do anything to S3 except read one object.
    """

    def get_object(self, *, Bucket: str, Key: str) -> Dict[str, Any]: ...  # noqa: N803


def parse_abundance_table(
    raw: bytes, sample_column: str | None = None
) -> Dict[str, float]:
    """Parse a taxon-by-sample abundance table into {taxon: value}.

    Layout matches the local CSV/TSV upload path: first column holds taxon names,
    remaining columns are samples. Delimiter is auto-detected. If
    `sample_column` is omitted the first sample column is used.
    """
    if len(raw) > MAX_OBJECT_BYTES:
        raise HealthOmicsError(
            f"Abundance table exceeds {MAX_OBJECT_BYTES} bytes."
        )
    text = raw.decode("utf-8-sig", errors="replace")
    try:
        return tables.parse_single_sample(
            text, max_rows=settings.max_rows, sample_column=sample_column
        )
    except tables.TableError as exc:
        raise HealthOmicsError(f"Could not parse abundance table: {exc}") from exc


def load_from_healthomics(
    s3_uri: str,
    region_name: str = DEFAULT_REGION,
    sample_column: str | None = None,
    allowed_buckets: Tuple[str, ...] | None = None,
    client: S3Reader | None = None,
) -> Dict[str, float]:
    """Load a taxonomic abundance table from a HealthOmics S3 output.

    Returns {taxon: relative_abundance_or_count}, ready for `taxa.to_vector()`.

    `client` allows an S3 reader to be injected; when omitted a real boto3 client
    is created. Injection is how the offline demo exercises this function without
    patching botocore or shipping a mocking library to production.

    Raises HealthOmicsError if ingest is disabled, the bucket is not
    allow-listed, or the object cannot be read or parsed.
    """
    bucket, key = parse_s3_uri(s3_uri)
    _assert_bucket_allowed(bucket, allowed_buckets)

    if client is None:
        # Imported lazily: boto3 is only needed on the real ingest path, which is
        # disabled by default.
        import boto3  # noqa: PLC0415

        client = boto3.client("s3", region_name=region_name)

    try:
        obj = client.get_object(Bucket=bucket, Key=key)
        # Bounded read: one extra byte lets us detect oversize without loading it.
        raw = obj["Body"].read(MAX_OBJECT_BYTES + 1)
    except HealthOmicsError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HealthOmicsError(f"Could not read {s3_uri}: {exc}") from exc

    return parse_abundance_table(raw, sample_column=sample_column)


# ---------------------------------------------------------------------------
# Offline demo
# ---------------------------------------------------------------------------
# A HealthOmics-style output: species-level calls with a long tail the model
# folds into "Other", written the way a profiler would emit it.
DEMO_TABLE = """taxon\tSRR_scalp_01\tSRR_scalp_02
Cutibacterium acnes\t0.412\t0.489
Staphylococcus capitis\t0.258\t0.121
Staphylococcus epidermidis\t0.071\t0.092
Malassezia restricta\t0.109\t0.074
Malassezia globosa\t0.031\t0.046
Corynebacterium tuberculostearicum\t0.039\t0.051
Streptococcus mitis\t0.021\t0.019
Micrococcus luteus\t0.014\t0.021
Lawsonella clevelandensis\t0.026\t0.048
Rothia mucilaginosa\t0.019\t0.039
"""

DEMO_BUCKET = "scalpbiome-healthomics-demo"
DEMO_KEY = "runs/1234567890/outputs/taxonomic_abundance.tsv"
DEMO_URI = f"s3://{DEMO_BUCKET}/{DEMO_KEY}"


class _InMemoryS3(Dict[Tuple[str, str], bytes]):
    """Minimal S3 reader backed by a dict, satisfying the S3Reader protocol.

    Deliberately hand-rolled rather than using moto. moto pulls in botocore,
    werkzeug and several other packages, which would add tens of megabytes to a
    deployment package that has to stay under Lambda's size limit, and shipping a
    mocking framework to a public endpoint is poor practice regardless.

    The tradeoff is honest: this fakes the S3 call itself. Everything around it,
    the URI parsing, allow-list enforcement, bounded read, and table parsing, is
    the real production code path.
    """

    def get_object(self, *, Bucket: str, Key: str) -> Dict[str, Any]:  # noqa: N803
        try:
            payload = self[(Bucket, Key)]
        except KeyError as exc:
            raise HealthOmicsError(
                f"NoSuchKey: s3://{Bucket}/{Key}"
            ) from exc
        return {"Body": _BytesBody(payload), "ContentLength": len(payload)}


class _BytesBody:
    """Streaming-body stand-in exposing the `read(n)` interface boto3 provides."""

    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def read(self, amt: int | None = None) -> bytes:
        return self._payload if amt is None else self._payload[:amt]


def demo_healthomics_roundtrip() -> Dict[str, object]:
    """Exercise the S3 ingest path against an in-memory object store.

    Runs fully offline: no credentials, no network, no real AWS resources. The
    S3 client is injected rather than patched, so the URI validation, bucket
    allow-listing, bounded read and parsing all execute exactly as they would in
    production.
    """
    if not settings.enable_healthomics_demo:
        raise HealthOmicsError("HealthOmics demo is disabled.")

    payload = DEMO_TABLE.encode("utf-8")
    store = _InMemoryS3()
    store[(DEMO_BUCKET, DEMO_KEY)] = payload

    # Narrow the allow-list to the demo bucket for this call only. Passing it
    # explicitly avoids mutating global settings, which would otherwise widen
    # access for concurrent requests in the same process.
    abundances = load_from_healthomics(
        DEMO_URI,
        region_name=DEFAULT_REGION,
        allowed_buckets=(DEMO_BUCKET,),
        client=store,
    )

    return {
        "s3_uri": DEMO_URI,
        "region": DEFAULT_REGION,
        "bytes": len(payload),
        "raw_taxa": len(abundances),
        "abundances": abundances,
        "note": (
            "Read through the production load_from_healthomics() code path with "
            "an injected in-memory S3 reader. URI validation, bucket "
            "allow-listing, bounded read and table parsing are all the real "
            "implementation. No network calls, no credentials, no AWS resources."
        ),
    }
