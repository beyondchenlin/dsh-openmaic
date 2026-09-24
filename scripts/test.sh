#!/bin/bash
# Run the dsh-openmaic plugin tests with the harness checkout's vitest. Mirrors
# build.sh: symlink the node host dependencies into node_modules first, then
# run vitest against the same vendored/workspace packages.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ] && command -v dsh &>/dev/null; then
  DSH_BIN=$(readlink -f "$(command -v dsh)" 2>/dev/null || command -v dsh)
  CANDIDATE=$(cd "$(dirname "$DSH_BIN")/.." && pwd 2>/dev/null || true)
  if [ -n "$CANDIDATE" ] && [ -d "$CANDIDATE/packages" ] && [ -d "$CANDIDATE/vendor" ]; then
    CHECKOUT="$CANDIDATE"
  fi
fi
if [ -z "$CHECKOUT" ] || [ ! -d "$CHECKOUT/packages" ] || [ ! -d "$CHECKOUT/vendor" ]; then
  echo "test: cannot locate the harness checkout (set DSH_CHECKOUT or put dsh on PATH)" >&2
  exit 1
fi

VITEST="$CHECKOUT/node_modules/.bin/vitest"
if [ ! -x "$VITEST" ]; then
  echo "test: vitest not found at $VITEST" >&2
  exit 1
fi

echo "=== Linking test dependencies (checkout: $CHECKOUT) ==="
node scripts/link-harness-deps.mjs "$CHECKOUT"

echo "=== Running tests (vitest) ==="
VITEST_MAX_WORKERS=4 "$VITEST" run --exclude '.tools/**'
