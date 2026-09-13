#!/usr/bin/env bash
# One-command backend launcher for ScalpBiome.
# Creates a local venv (Python 3.13), installs deps, and starts the API.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON_BIN:-python3.13}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python3"
fi

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment with $PYTHON_BIN ..."
  "$PYTHON_BIN" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "Installing dependencies ..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo "Starting ScalpBiome API on http://localhost:8000 ..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
