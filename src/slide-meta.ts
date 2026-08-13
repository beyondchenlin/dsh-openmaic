/**
 * Pure shared contract for the `openmaic_slide` tool: the wire name and the
 * `tool/result` meta descriptor carrying one OpenMAIC slide (the
 * `@openmaic/dsl` Slide object). No I/O and no host-package value import, so
 * the node half, the browser half, and vitest all load it unchanged.
 *
 * @module @openmaic/dsh-openmaic/slide-meta
 */

/** Wire name of the tool and of the keyed toolview. */
export const OPENMAIC_SLIDE_TOOL_NAME = 'openmaic_slide'

/** The `tool/result` meta descriptor persisted for replay-stable rendering. */
export interface SlideMeta {
  kind: 'openmaic-slide'
  /** One OpenMAIC slide (PPTist-style Slide). */
  slide: unknown
  /** Concise human title shown in the card header. */
  title: string
}

/**
 * Narrow an opaque `tool/result` meta into a well-formed {@link SlideMeta}.
 * @param meta - the persisted meta value.
 * @returns the narrowed descriptor, or `undefined` on any mismatch.
 */
export function slideMetaFrom(meta: unknown): SlideMeta | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const m = meta as { kind?: unknown; slide?: unknown; title?: unknown }
  if (m.kind !== 'openmaic-slide') return undefined
  if (typeof m.title !== 'string') return undefined
  if (typeof m.slide !== 'object' || m.slide === null || Array.isArray(m.slide)) return undefined
  return { kind: 'openmaic-slide', slide: m.slide, title: m.title }
}
