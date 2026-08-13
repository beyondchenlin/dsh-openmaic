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

link_pkg() {
  local target="$CHECKOUT/$2"
  if [ ! -e "$target" ]; then
    echo "test: skip missing dependency target: $2" >&2
    return 0
  fi
  mkdir -p "$(dirname "node_modules/$1")"
  ln -sfn "$target" "node_modules/$1"
}

echo "=== Linking test dependencies (checkout: $CHECKOUT) ==="
mkdir -p node_modules/@deepseek-ai node_modules/@standard-schema node_modules/@types
ln -sfn "$CHECKOUT/node_modules/@types" node_modules/@types
link_pkg @deepseek-ai/cordis vendor/cordis
link_pkg @deepseek-ai/cosmokit vendor/cosmokit
link_pkg @deepseek-ai/schemastery vendor/schemastery
link_pkg @deepseek-ai/dsh-brand packages/util/brand
link_pkg @deepseek-ai/dsh-llm packages/llm/llm
link_pkg @deepseek-ai/dsh-scope packages/core/scope
link_pkg @deepseek-ai/dsh-session packages/core/session
link_pkg @deepseek-ai/dsh-skill packages/skill/skill
link_pkg @deepseek-ai/dsh-system-prompt packages/core/system-prompt
link_pkg @deepseek-ai/dsh-tools packages/core/tools

STD_SCHEMA=$(find "$CHECKOUT/node_modules/.pnpm" -maxdepth 1 -type d -iname '@standard-schema+spec@*' 2>/dev/null | head -1)
if [ -n "$STD_SCHEMA" ]; then
  ln -sfn "$STD_SCHEMA/node_modules/@standard-schema/spec" node_modules/@standard-schema/spec
fi

echo "=== Running tests (vitest) ==="
VITEST_MAX_WORKERS=4 "$VITEST" run
