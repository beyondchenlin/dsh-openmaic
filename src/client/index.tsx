/**
 * dsh-openmaic, browser half: registers the settled teaching card under the
 * `openmaic_render` key of the atomic toolview hole. Clients without this half
 * degrade to the tool's generic result text by the documented toolview
 * fallback, so TUI and headless surfaces keep working.
 *
 * @module @openmaic/dsh-openmaic/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the `tool.call.toolview` and `conversation.input.dock` SlotMap declarations.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { OpenmaicCard } from './OpenmaicCard.tsx'
import { WidgetCard } from './WidgetCard.tsx'
import { SlideCard } from './SlideCard.tsx'
import { StreamingWidgetPreview } from './StreamingWidgetPreview.tsx'

export const name = 'dsh-openmaic'

export const inject = ['slots']

/**
 * Register the keyed toolviews and the streaming dock preview. Waiting on the
 * holes' declarations mirrors the official registrants: entry application
 * order is loader-driven, and a direct register racing the declaration fails
 * boot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'openmaic_render' },
    OpenmaicCard,
  ))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'openmaic_widget' },
    WidgetCard,
  ))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'openmaic_slide' },
    SlideCard,
  ))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'openmaic-widget-stream', order: 30 },
    StreamingWidgetPreview,
  ))
}
