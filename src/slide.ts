/**
 * `openmaic_slide` tool: render one OpenMAIC slide inline. The model writes
 * the slide JSON per the bundled `openmaic-slide` skill (which follows the
 * @openmaic/generation slide-content contract, outputting `{background,
 * elements}`). The tool normalizes it into a full PPTist Slide — it owns the
 * canvas size and ratio (1280 × 720, i.e. viewportRatio 9/16) so the model
 * cannot get the geometry wrong — and the browser half renders it with
 * `@openmaic/renderer`'s SlideCanvas.
 *
 * @module @openmaic/dsh-openmaic/slide
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { OPENMAIC_SLIDE_TOOL_NAME, slideMetaFrom } from './slide-meta.js'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export { OPENMAIC_SLIDE_TOOL_NAME, slideMetaFrom } from './slide-meta.js'
export type { SlideMeta } from './slide-meta.js'

const CANVAS_WIDTH = 1280
/** 9/16: the PPTist/renderer convention is height = width * viewportRatio. */
const CANVAS_RATIO = 0.5625

const DEFAULT_THEME = {
  backgroundColor: '#ffffff',
  themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4', '#70ad47'],
  fontColor: '#333333',
  fontName: 'Arial',
}

const DESCRIPTION =
  'Render one OpenMAIC slide inline. Write the slide JSON as an object with ' +
  'an `elements` array (and optional `background`) per the openmaic-slide ' +
  'skill, then pass it in `slide` with a short `title`.'

/** Normalize a model-authored slide into a full PPTist Slide. */
function normalizeSlide(input: Record<string, unknown>): Record<string, JsonValue> {
  const elements = Array.isArray(input.elements) ? input.elements : []
  return {
    id: typeof input.id === 'string' && input.id !== '' ? input.id : crypto.randomUUID(),
    viewportSize: typeof input.viewportSize === 'number' ? input.viewportSize : CANVAS_WIDTH,
    viewportRatio: typeof input.viewportRatio === 'number' ? input.viewportRatio : CANVAS_RATIO,
    theme: (input.theme && typeof input.theme === 'object') ? input.theme : DEFAULT_THEME,
    ...(input.background && typeof input.background === 'object' ? { background: input.background } : {}),
    elements,
  } as Record<string, JsonValue>
}

/**
 * Build the `openmaic_slide` tool definition.
 * @returns the tool definition to register on `ctx.tools`.
 */
export function openmaicSlideTool(): ToolDefinition {
  return defineTool({
    name: OPENMAIC_SLIDE_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      slide: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: 'The slide JSON: an object with an `elements` array (and optional `background`), per the openmaic-slide skill.',
      },
      title: {
        type: 'string',
        description: 'Concise slide title. Defaults to "OpenMAIC 幻灯片".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slide: { type: 'object', required: true, additionalProperties: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered the slide "${value.title}" inline.`,
      }],
      presentationMeta: (_args, value) => ({
        kind: 'openmaic-slide',
        slide: value.slide,
        title: value.title,
      }),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const raw = args.slide as Record<string, unknown>
      if (!Array.isArray(raw.elements) || raw.elements.length === 0) {
        throw new Error('openmaic_slide: slide must have a non-empty `elements` array')
      }
      const title = typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : 'OpenMAIC 幻灯片'
      return { slide: normalizeSlide(raw), title }
    },
    presentCall: () => ({ card: 'generic', title: 'OpenMAIC slide', kind: 'other' }),
    presentResult(_args, result) {
      if (result.isError) return undefined
      const meta = slideMetaFrom(result.meta)
      if (meta === undefined) return undefined
      return { card: 'generic', title: `OpenMAIC · ${meta.title}` }
    },
  })
}
