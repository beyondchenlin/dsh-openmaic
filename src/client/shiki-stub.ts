/**
 * Build-time stand-in for `shiki`, aliased into the browser bundle only.
 *
 * `@openmaic/renderer`'s code element lazily does `import('shiki')` to syntax
 * highlight code blocks. Neither shape of the real dependency works inside a
 * dsh client plugin: the bundle is one classic script handed a frozen module
 * table, so leaving shiki external emits a bare `import("shiki")` the browser
 * cannot resolve (an unhandled rejection at highlight time), while bundling it
 * pulls every TextMate grammar in as a separate chunk — tens of megabytes, and
 * chunks the loader has no way to fetch.
 *
 * So the stub resolves with a highlighter whose `codeToHtml` throws. The
 * renderer already wraps that call in try/catch and falls back to escaped
 * plain text, which is the documented degradation: code blocks render with
 * their frame, line numbers, and content, just without token colors.
 *
 * @module @openmaic/dsh-openmaic/client/shiki-stub
 */

const UNAVAILABLE = 'dsh-openmaic: shiki is not bundled into the client plugin; code renders unhighlighted'

/** The slice of the shiki surface `@openmaic/renderer` calls. */
export interface StubHighlighter {
  getLoadedLanguages: () => string[]
  codeToHtml: (code: string, options: unknown) => string
}

/**
 * Stand in for shiki's `createHighlighter`.
 * @returns a highlighter that reports no languages and refuses to highlight.
 */
export function createHighlighter(): Promise<StubHighlighter> {
  return Promise.resolve({
    getLoadedLanguages: () => [],
    codeToHtml: () => { throw new Error(UNAVAILABLE) },
  })
}
