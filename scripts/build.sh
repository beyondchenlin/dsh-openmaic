#!/bin/bash
# Build the dsh-openmaic external plugin against the harness checkout: bundle
# the node half (lib/index.js + d.ts) and the browser half (lib/client.js)
# with tsdown. Dependency resolution mirrors dsh-visualize: the plugin's
# node_modules holds symlinks into the harness checkout, so the bundler
# type-checks against the same vendored/workspace packages the running dsh
# ships. Defaults to the local harness checkout; override with DSH_CHECKOUT.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ] && command -v dsh &>/dev/null; then
  DSH_BIN=$(readlink -f "$(command -v dsh)" 2>/dev/null || command -v dsh)
  # dsh lives at <checkout>/bin/dsh
  CANDIDATE=$(cd "$(dirname "$DSH_BIN")/.." && pwd 2>/dev/null || true)
  if [ -n "$CANDIDATE" ] && [ -d "$CANDIDATE/packages" ] && [ -d "$CANDIDATE/vendor" ]; then
    CHECKOUT="$CANDIDATE"
  fi
fi
if [ -z "$CHECKOUT" ] || [ ! -d "$CHECKOUT/packages" ] || [ ! -d "$CHECKOUT/vendor" ]; then
  echo "build: cannot locate the harness checkout (set DSH_CHECKOUT or put dsh on PATH)" >&2
  exit 1
fi

TSDOWN="$CHECKOUT/node_modules/.bin/tsdown"
if [ ! -x "$TSDOWN" ]; then
  echo "build: tsdown not found at $TSDOWN" >&2
  exit 1
fi

echo "=== Linking build dependencies (checkout: $CHECKOUT) ==="
node scripts/link-harness-deps.mjs "$CHECKOUT"

echo "=== Bundling src -> lib (tsdown) ==="
"$TSDOWN"

# Guard the browser half against externals drift. The web shell hands the plugin
# factory a `require` backed by a frozen module table; a require for anything
# outside that table fails the whole loader entry at boot ("missed the module
# table"). Every specifier tsdown leaves external in lib/client.js must appear
# below, which mirrors CLIENT_EXTERNALS in tsdown.config.ts. A require for a
# node-side host package (dsh-llm, dsh-tools, @openmaic/generation, ...) means a
# browser module imported a node-half module for a value; move the shared part
# into a pure module (see src/fragment.ts, src/widget-meta.ts).
echo "=== Checking client bundle externals ==="
ALLOWED_CLIENT_REQUIRES="
react
react/jsx-runtime
react-dom
react-dom/client
@deepseek-ai/cordis
@deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-client-ui-dockkit
"
UNEXPECTED=""
while read -r spec; do
  [ -n "$spec" ] || continue
  if ! grep -qxF "$spec" <<<"$ALLOWED_CLIENT_REQUIRES"; then
    UNEXPECTED="$UNEXPECTED $spec"
  fi
done < <(grep -o 'require("[^"]*")' lib/client.js | sed 's/^require("//; s/")$//' | sort -u)
if [ -n "$UNEXPECTED" ]; then
  echo "build: lib/client.js requires modules the loader module table cannot answer:$UNEXPECTED" >&2
  echo "build: the browser half must not import a node-half module for a value" >&2
  exit 1
fi

# The bundle is fetched as one classic script, so it must stay one file: the
# loader has no way to fetch an emitted chunk, and a leftover dynamic import
# (bare specifier or relative chunk) rejects at call time in the browser.
DYNAMIC=$( { grep -o 'import("[^"]*")' lib/client.js || true; } | sort -u | tr '\n' ' ')
if [ -n "$DYNAMIC" ]; then
  echo "build: lib/client.js kept dynamic imports the browser cannot resolve: $DYNAMIC" >&2
  echo "build: bundle the dependency inline, or alias it to a local stub" >&2
  exit 1
fi
CHUNKS=$(find lib -name '*.cjs' | tr '\n' ' ')
if [ -n "$CHUNKS" ]; then
  echo "build: the browser bundle split into chunks the loader cannot fetch: $CHUNKS" >&2
  exit 1
fi

echo "=== Build complete ==="
ls -la lib/
