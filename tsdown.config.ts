/**
 * tsdown preset for dsh-openmaic: an ESM node half with declarations plus a
 * browser half (lib/client.js) wrapped for the harness client-plugin loader.
 * All @deepseek-ai packages are type-only imports (erased at build); the node
 * half keeps schemastery/cordis unbundled because the Loader validates the
 * plugin's `Config` schema and must see its own instances; the browser half
 * keeps the platform module table external (React, Cordis, loader seeds) and
 * bundles everything else inline.
 */
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = '@openmaic/dsh-openmaic'

/** Module specifiers the dsh web shell shares into its frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/** Externals resolved from the loader module table. */
const CLIENT_EXTERNALS: readonly string[] = PLATFORM_MODULES

// shiki is a lazy optional peer of the renderer (code highlighting). It cannot
// ship either way — external leaves a bare `import("shiki")` the browser cannot
// resolve in a classic script, bundled it drags every TextMate grammar in as a
// separate chunk the loader cannot fetch — so the browser build resolves it to
// a local stub and the renderer falls back to plain text. See the stub's header.
const SHIKI_STUB = fileURLToPath(new URL('./src/client/shiki-stub.ts', import.meta.url))

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: {
      // schemastery stays unbundled because the Loader validates the plugin's
      // `Config` schema and must see its own schemastery instance; cordis is
      // type-only in this bundle.
      neverBundle: ['@deepseek-ai/schemastery', '@deepseek-ai/cordis'],
    },
  },
  {
    // Browser bundle: lib/client.js, served by the harness at /plugins/<id>/client.js.
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      // The OpenMAIC renderer and its heavy peers must be bundled into the
      // client: the web shell's frozen module table cannot answer them.
      // shiki is listed too: a dependency is externalized by default, and that
      // check runs on the raw specifier before the alias below can redirect it.
      alwaysBundle: [/@openmaic\/(renderer|dsl)/, /^echarts($|\/)/, /^motion($|\/)/, /^@emotion\/is-prop-valid$/, /^shiki($|\/)/],
    },
    alias: { shiki: SHIKI_STUB },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      // One classic script is all the loader fetches: a dynamic import must be
      // inlined rather than split into a chunk nothing can load.
      inlineDynamicImports: true,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: `return module.exports; } });`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
