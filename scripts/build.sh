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

link_pkg() {
  local target="$CHECKOUT/$2"
  if [ ! -e "$target" ]; then
    echo "build: skip missing dependency target: $2" >&2
    return 0
  fi
  mkdir -p "$(dirname "node_modules/$1")"
  ln -sfn "$target" "node_modules/$1"
}

echo "=== Linking build dependencies (checkout: $CHECKOUT) ==="
mkdir -p node_modules/@deepseek-ai node_modules/@standard-schema node_modules/@types
ln -sfn "$CHECKOUT/node_modules/@types" node_modules/@types
# Node half.
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
# Browser half (external at build time, resolved by the loader module table;
# symlinked so `tsc -p tsconfig.client.json` type-checks against them).
link_pkg @deepseek-ai/dsh-client-runtime packages/client/runtime
link_pkg @deepseek-ai/dsh-client-ui-tool packages/client/ui-tool
link_pkg @deepseek-ai/dsh-client-ui-slots packages/client/ui-slots
link_pkg @deepseek-ai/dsh-client-ui-conversation packages/client/ui-conversation
link_pkg @deepseek-ai/dsh-client-ui-primitives packages/client/ui-primitives
link_pkg @deepseek-ai/dsh-client-web-react packages/client/web-react
link_pkg @deepseek-ai/dsh-client-ui-attachment packages/client/ui-attachment
link_pkg @deepseek-ai/dsh-client-schema-form packages/client/schema-form
# react and its types, hoisted only inside the pnpm store.
REACT=$(find "$CHECKOUT/node_modules/.pnpm" -maxdepth 1 -type d -iname 'react@*' 2>/dev/null | head -1)
if [ -n "$REACT" ]; then ln -sfn "$REACT/node_modules/react" node_modules/react; fi
TYPES_REACT=$(find "$CHECKOUT/node_modules/.pnpm" -maxdepth 1 -type d -iname '@types+react@*' 2>/dev/null | head -1)
if [ -n "$TYPES_REACT" ]; then ln -sfn "$TYPES_REACT/node_modules/@types/react" node_modules/@types/react; fi
STD_SCHEMA=$(find "$CHECKOUT/node_modules/.pnpm" -maxdepth 1 -type d -iname '@standard-schema+spec@*' 2>/dev/null | head -1)
if [ -n "$STD_SCHEMA" ]; then
  ln -sfn "$STD_SCHEMA/node_modules/@standard-schema/spec" node_modules/@standard-schema/spec
fi

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
@deepseek-ai/dsh-client-runtime/client
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-web-react
@deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-client-ui-attachment
@deepseek-ai/dsh-client-schema-form
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
DYNAMIC=$(grep -o 'import("[^"]*")' lib/client.js | sort -u | tr '\n' ' ')
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
