"""AWS Lambda entrypoint.

Wraps the FastAPI app with Mangum so the same application serves both uvicorn
locally and Lambda in production.

The model is warmed at import time rather than on first request. Import happens
during the Lambda init phase, which gets full CPU and is not billed against the
request, so paying for training here keeps the first real request fast.
`_get_model()` caches, so this is a one-off per execution environment.
"""

from __future__ import annotations

import logging

from mangum import Mangum

from app.main import _get_model, app

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Warm the classifier during init. Seeded and deterministic, so every execution
# environment ends up with an identical model.
_get_model()
logger.info("ScalpBiome model warmed during Lambda init")

# lifespan="off": the app's startup work is already done above, and running the
# ASGI lifespan per invocation would repeat it.
handler = Mangum(app, lifespan="off", api_gateway_base_path="/")
