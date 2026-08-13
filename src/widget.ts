/**
 * `openmaic_widget` tool: render a complete OpenMAIC widget document the model
 * wrote (following the bundled `openmaic-widget` skill) as a sandboxed card.
 * The model streams the HTML in its own output, so there is no tool-side LLM
 * call and no timeout; the tool just post-processes (LaTeX to KaTeX) and
 * projects the document into persisted meta for the browser half to render.
 *
 * @module @openmaic/dsh-openmaic/widget
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { postProcessInteractiveHtml } from '@openmaic/generation'
import {
  OPENMAIC_WIDGET_TOOL_NAME,
  SUPPORTED_WIDGET_TYPES,
  widgetMetaFrom,
  type SupportedWidgetType,
} from './widget-meta.js'

export {
  OPENMAIC_WIDGET_TOOL_NAME,
  SUPPORTED_WIDGET_TYPES,
  extractStreamingWidget,
  widgetMetaFrom,
} from './widget-meta.js'
export type { SupportedWidgetType, WidgetMeta } from './widget-meta.js'

const DESCRIPTION =
  'Render a complete OpenMAIC widget HTML document inline. Write the full ' +
  'document (with <!doctype>/<html>/<head>/<body>, an embedded widget-config ' +
  'JSON, and the postMessage listener) by following the openmaic-widget ' +
  'skill, then pass it in `html` with the `widgetType` and a short `title`.'

/**
 * Build the `openmaic_widget` tool definition.
 * @returns the tool definition to register on `ctx.tools`.
 */
export function openmaicWidgetTool(): ToolDefinition {
  return defineTool({
    name: OPENMAIC_WIDGET_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      html: {
        type: 'string',
        required: true,
        description: 'The complete widget HTML document (simulation, game, or code), written per the openmaic-widget skill contract.',
      },
      widgetType: {
        type: 'string',
        enum: [...SUPPORTED_WIDGET_TYPES],
        description: 'Widget kind: simulation, game, or code. Defaults to simulation.',
      },
      title: {
        type: 'string',
        description: 'Concise widget title. Defaults to "OpenMAIC 课堂".',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          html: { type: 'string', required: true },
          title: { type: 'string', required: true },
          widgetType: { type: 'string', required: true, enum: [...SUPPORTED_WIDGET_TYPES] },
        },
      },
      // Model-facing text stays a one-line confirmation; the HTML is already in
      // the model's own output and re-echoing it would blow up context.
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered the ${value.widgetType} widget "${value.title}" inline.`,
      }],
      presentationMeta: (_args, value) => ({
        kind: 'openmaic-widget',
        html: value.html,
        title: value.title,
        widgetType: value.widgetType,
      }),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const html = typeof args.html === 'string' ? args.html.trim() : ''
      if (html === '') throw new Error('openmaic_widget: html is required')
      const title = typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : 'OpenMAIC 课堂'
      const widgetType = (args.widgetType ?? 'simulation') as SupportedWidgetType
      return { html: postProcessInteractiveHtml(html), title, widgetType }
    },
    presentCall: () => ({ card: 'generic', title: 'OpenMAIC widget', kind: 'other' }),
    presentResult(_args, result) {
      if (result.isError) return undefined
      const meta = widgetMetaFrom(result.meta)
      if (meta === undefined) return undefined
      return { card: 'generic', title: `OpenMAIC · ${meta.title}` }
    },
  })
}
