/**
 * The model-facing `openmaic_render` tool: take one inline-HTML teaching
 * fragment as a direct argument, validate it against the inline contract, and
 * project it into the persisted `tool/result` meta so the browser half renders
 * it as a sandboxed card and replay reproduces the same card byte for byte.
 *
 * Passing the markup as an argument (rather than a file path) keeps the node
 * half free of any filesystem dependency; the model-facing result stays a
 * one-line confirmation so the fragment (already in the model's own output)
 * is not re-echoed into context.
 *
 * @module @openmaic/dsh-openmaic/tool
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { openmaicMetaFrom, validateFragment, OPENMAIC_RENDER_TOOL_NAME } from './fragment.ts'

export { OPENMAIC_RENDER_TOOL_NAME } from './fragment.ts'

/** Size ceiling for one fragment; teaching cards should stay well under it. */
export const MAX_FRAGMENT_BYTES = 256 * 1024

const DESCRIPTION =
  'Show the user an interactive OpenMAIC teaching card (a concept card, quiz, ' +
  'step-by-step walkthrough, or slide) rendered inline in the conversation. ' +
  'Pass the markup in `fragment`: literal inline HTML only, no document ' +
  'skeleton. Load the `openmaic-render` skill for the authoring contract first.'

/**
 * Build the `openmaic_render` tool definition.
 * @returns the tool definition to register on `ctx.tools`.
 */
export function openmaicRenderTool(): ToolDefinition {
  return defineTool({
    name: OPENMAIC_RENDER_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      fragment: {
        type: 'string',
        required: true,
        description: 'The inline HTML fragment to render (markup, style, and script; no <!doctype>, <html>, <head>, or <body>).',
      },
      title: {
        type: 'string',
        description: 'Concise card title. Defaults to "OpenMAIC 课堂".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          sizeBytes: { type: 'integer', required: true },
          fragment: { type: 'string', required: true },
        },
      },
      // Model-facing text stays a one-line confirmation; the fragment is the
      // model's own argument and re-echoing it would double its context cost.
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered "${value.title}" inline (${value.sizeBytes} bytes). The user sees the interactive card in the conversation.`,
      }],
      // Project the fragment into persisted meta so the card survives replay:
      // the canonical value is not on the wire, only content + meta are.
      presentationMeta: (_args, value) => ({
        kind: 'openmaic-render',
        fragment: value.fragment,
        title: value.title,
      }),
    },
    // Pure validation; concurrent sibling calls cannot conflict.
    isConcurrencySafe: () => true,
    async execute(args) {
      const sizeBytes = validateFragment(args.fragment, MAX_FRAGMENT_BYTES)
      const title = args.title?.trim() || 'OpenMAIC 课堂'
      return { title, sizeBytes, fragment: args.fragment }
    },
    presentCall: () => ({
      card: 'generic',
      title: 'OpenMAIC',
      kind: 'other',
    }),
    // The completed title derives from persisted meta, not args, so replay of
    // a defaulted title still shows the resolved one. A malformed or absent
    // meta declines to the generic fallback.
    presentResult(_args, result) {
      if (result.isError) return undefined
      const meta = openmaicMetaFrom(result.meta)
      if (meta === undefined) return undefined
      return { card: 'generic', title: `OpenMAIC · ${meta.title}` }
    },
  })
}
