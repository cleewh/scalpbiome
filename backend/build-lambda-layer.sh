#!/usr/bin/env bash
# Build the dependency Lambda layer. No Docker required.
#
# Why a layer rather than one package: the dependency tree is ~179 MB and almost
# never changes, while application code is ~150 KB and changes constantly. Bundled
# together, editing one line re-uploads 179 MB, which makes iteration slow and a
# live deployment demo dependent on upload bandwidth. Split, an application change
# uploads ~150 KB.
#
# pip can fetch wheels for a platform other than the host, so a Linux/arm64 layer
# builds fine from macOS. --only-binary=:all: makes that a hard requirement rather
# than letting pip fall back to a source build that would produce host binaries.
#
# Layers must place Python packages under `python/` at the archive root.
#
# Usage: ./build-lambda-layer.sh [output_dir]
set -euo pipefail
cd "$(dirname "$0")"

OUT="${1:-build/layer}"
PYTHON_VERSION="3.12"
PLATFORM="manylinux2014_aarch64"

# Lambda's limit applies to the function and all its layers combined, unzipped.
MAX_UNZIPPED_MB=250

echo "==> Cleaning ${OUT}"
rm -rf "${OUT}"
mkdir -p "${OUT}/python"

echo "==> Downloading ${PLATFORM} wheels for Python ${PYTHON_VERSION}"
python3 -m pip install \
  --quiet \
  --platform "${PLATFORM}" \
  --python-version "${PYTHON_VERSION}" \
  --only-binary=:all: \
  --target "${OUT}/python" \
  -r requirements.txt

echo "==> Stripping test suites, caches and type stubs"
find "${OUT}" -type d -name tests -prune -exec rm -rf {} + 2>/dev/null || true
find "${OUT}" -type d -name test -prune -exec rm -rf {} + 2>/dev/null || true
find "${OUT}" -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
find "${OUT}" -type d -name "*.dist-info" -exec rm -rf {}/licenses \; 2>/dev/null || true
find "${OUT}" -name "*.pyi" -delete 2>/dev/null || true
find "${OUT}" -name "*.pyc" -delete 2>/dev/null || true
# scikit-learn ships Cython sources that are never used at runtime.
find "${OUT}" -name "*.pyx" -delete 2>/dev/null || true
find "${OUT}" -name "*.pxd" -delete 2>/dev/null || true

SIZE_MB=$(du -sm "${OUT}" | cut -f1)
echo "==> Layer size: ${SIZE_MB} MB (function + layers limit ${MAX_UNZIPPED_MB} MB)"
if [ "${SIZE_MB}" -ge "${MAX_UNZIPPED_MB}" ]; then
  echo "ERROR: layer exceeds the Lambda unzipped size limit." >&2
  exit 1
fi

# A darwin binary here would deploy cleanly and fail at runtime with an opaque
# import error, so catch it now.
if find "${OUT}" -name "*-darwin.so" | grep -q .; then
  echo "ERROR: found macOS binaries; wheels resolved incorrectly." >&2
  exit 1
fi
if find "${OUT}" -name "*.so" | grep -q .; then
  echo "==> Native extensions present and Linux-targeted"
fi

echo "==> Done: ${OUT}"
