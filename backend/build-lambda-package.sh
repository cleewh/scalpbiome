#!/usr/bin/env bash
# Build the Lambda deployment package. No Docker required.
#
# pip can fetch wheels for a platform other than the host, so a Linux/arm64
# package builds fine from macOS as long as every dependency ships a manylinux
# aarch64 wheel (--only-binary=:all: makes that a hard requirement rather than
# silently falling back to a source build that would produce host binaries).
#
# The strip step matters: unstripped, the dependency tree is ~269 MB, over
# Lambda's 250 MB unzipped limit. Removing bundled test suites and caches brings
# it to ~181 MB.
#
# Usage: ./build-lambda-package.sh [output_dir]
set -euo pipefail
cd "$(dirname "$0")"

OUT="${1:-build/lambda}"
PYTHON_VERSION="3.12"
PLATFORM="manylinux2014_aarch64"

# Lambda's hard limit on unzipped deployment package size.
MAX_UNZIPPED_MB=250

echo "==> Cleaning ${OUT}"
rm -rf "${OUT}"
mkdir -p "${OUT}"

echo "==> Downloading ${PLATFORM} wheels for Python ${PYTHON_VERSION}"
# --only-binary=:all: fails loudly rather than building from source, which on
# macOS would produce darwin binaries that cannot run on Lambda.
python3 -m pip install \
  --quiet \
  --platform "${PLATFORM}" \
  --python-version "${PYTHON_VERSION}" \
  --only-binary=:all: \
  --target "${OUT}" \
  -r requirements.txt

echo "==> Stripping test suites, caches and type stubs"
find "${OUT}" -type d -name tests -prune -exec rm -rf {} + 2>/dev/null || true
find "${OUT}" -type d -name test -prune -exec rm -rf {} + 2>/dev/null || true
find "${OUT}" -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
find "${OUT}" -type d -name "*.dist-info" -exec rm -rf {}/licenses \; 2>/dev/null || true
find "${OUT}" -name "*.pyi" -delete 2>/dev/null || true
find "${OUT}" -name "*.pyc" -delete 2>/dev/null || true
# scikit-learn ships .pyx/.pxd Cython sources that are never used at runtime.
find "${OUT}" -name "*.pyx" -delete 2>/dev/null || true
find "${OUT}" -name "*.pxd" -delete 2>/dev/null || true

echo "==> Copying application code"
cp -R app "${OUT}/app"
cp lambda_handler.py "${OUT}/"
find "${OUT}/app" -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true

SIZE_MB=$(du -sm "${OUT}" | cut -f1)
echo "==> Package size: ${SIZE_MB} MB (Lambda limit ${MAX_UNZIPPED_MB} MB)"
if [ "${SIZE_MB}" -ge "${MAX_UNZIPPED_MB}" ]; then
  echo "ERROR: package exceeds the Lambda unzipped size limit." >&2
  exit 1
fi

# Fail fast if a native extension was built for the wrong platform. A darwin
# binary here would deploy cleanly and then fail at runtime with an opaque
# import error, so it is worth catching now.
if find "${OUT}" -name "*.so" | grep -q .; then
  if find "${OUT}" -name "*-darwin.so" | grep -q .; then
    echo "ERROR: found macOS binaries in the package; wheels resolved incorrectly." >&2
    exit 1
  fi
  echo "==> Native extensions present and Linux-targeted"
fi

echo "==> Done: ${OUT}"
