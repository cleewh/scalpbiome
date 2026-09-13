"""Runtime configuration.

Everything here is environment-driven so the same image runs locally and in
Lambda. Defaults are chosen to be safe for a public deployment: features that
touch real AWS resources are OFF unless explicitly switched on, and every input
bound is finite.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str) -> List[str]:
    raw = os.environ.get(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    # --- Input limits -----------------------------------------------------
    # The upload endpoint parses untrusted files. Every dimension is bounded so
    # a malicious or accidental payload cannot exhaust memory or CPU. 256 KiB is
    # generous for a taxon-by-sample table (thousands of rows).
    max_upload_bytes: int = field(
        default_factory=lambda: _env_int("SCALPBIOME_MAX_UPLOAD_BYTES", 256 * 1024)
    )
    max_rows: int = field(
        default_factory=lambda: _env_int("SCALPBIOME_MAX_ROWS", 2000)
    )
    max_sample_columns: int = field(
        default_factory=lambda: _env_int("SCALPBIOME_MAX_SAMPLE_COLUMNS", 50)
    )
    # Bounds the JSON body of /api/analyze; unknown taxa fold into "Other" so
    # there is no legitimate reason to send a huge mapping.
    max_abundance_keys: int = field(
        default_factory=lambda: _env_int("SCALPBIOME_MAX_ABUNDANCE_KEYS", 500)
    )
    max_trajectory_steps: int = field(
        default_factory=lambda: _env_int("SCALPBIOME_MAX_TRAJECTORY_STEPS", 60)
    )

    # --- CORS -------------------------------------------------------------
    # In the deployed stack the SPA and the API share one CloudFront origin, so
    # no cross-origin access is needed and this list stays empty. Locally the
    # Vite dev server proxies /api, so it is same-origin there too; the localhost
    # entries only matter if someone runs the frontend without the proxy.
    cors_allow_origins: List[str] = field(
        default_factory=lambda: _env_list("SCALPBIOME_CORS_ORIGINS")
    )
    allow_localhost_cors: bool = field(
        default_factory=lambda: _env_bool("SCALPBIOME_ALLOW_LOCALHOST_CORS", True)
    )

    # --- HealthOmics / S3 -------------------------------------------------
    # Reading an arbitrary caller-supplied s3:// URI would be a data-exfiltration
    # primitive if the function had broad S3 permissions. It is therefore off by
    # default, and when enabled it only reads from an explicit bucket allow-list.
    enable_s3_ingest: bool = field(
        default_factory=lambda: _env_bool("SCALPBIOME_ENABLE_S3_INGEST", False)
    )
    allowed_s3_buckets: List[str] = field(
        default_factory=lambda: _env_list("SCALPBIOME_ALLOWED_S3_BUCKETS")
    )
    aws_region: str = field(
        default_factory=lambda: os.environ.get("AWS_REGION", "ap-southeast-1")
    )

    # The in-process moto demo makes no network calls and needs no credentials,
    # so it is safe to leave on: it demonstrates the HealthOmics code path
    # without touching a real account.
    enable_healthomics_demo: bool = field(
        default_factory=lambda: _env_bool("SCALPBIOME_ENABLE_HEALTHOMICS_DEMO", True)
    )

    # --- Model ------------------------------------------------------------
    model_seed: int = field(
        default_factory=lambda: _env_int("SCALPBIOME_MODEL_SEED", 42)
    )
    model_samples_per_class: int = field(
        default_factory=lambda: _env_int("SCALPBIOME_SAMPLES_PER_CLASS", 300)
    )

    # --- Origin protection -------------------------------------------------
    # Shared value CloudFront injects on origin requests. When set, requests
    # lacking it are refused, so the API Gateway endpoint cannot be used
    # directly and all traffic must pass CloudFront (and thus WAF).
    #
    # Empty locally, where the API is reached through the Vite proxy.
    origin_secret: str = field(
        default_factory=lambda: os.environ.get("SCALPBIOME_ORIGIN_SECRET", "").strip()
    )


settings = Settings()
