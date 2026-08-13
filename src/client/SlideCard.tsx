/**
 * The `openmaic_slide` toolview: renders one OpenMAIC slide with
 * `@openmaic/renderer`'s SlideCanvas (charts, formulas, code, images, shapes,
 * tables, and video all supported). The slide JSON comes from the persisted
 * meta; the canvas auto-fits a fixed-height container, and an expand button
 * opens a large overlay.
 *
 * @module @openmaic/dsh-openmaic/client/SlideCard
 */

import { useState, type CSSProperties } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { SlideCanvas } from '@openmaic/renderer'
import type { Slide } from '@openmaic/dsl'
import { slideMetaFrom } from '../slide-meta.ts'

const SLIDE_HEIGHT = 480

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  fontSize: 12,
  opacity: 0.65,
  margin: '2px 0 6px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
}

const canvasWrapStyle: CSSProperties = {
  width: '100%',
  height: SLIDE_HEIGHT,
  overflow: 'hidden',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2, rgba(0 0 0 / 10%))',
  background: 'var(--dsw-alias-bg-layer-1, transparent)',
}

const expandBtnStyle: CSSProperties = {
  appearance: 'none',
  marginLeft: 'auto',
  border: '1px solid var(--dsw-alias-border-l2, rgba(0 0 0 / 15%))',
  borderRadius: 6,
  padding: '1px 8px',
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--dsw-alias-bg-layer-1, rgba(13 13 13 / 96%))',
  color: 'var(--dsw-alias-label-primary, inherit)',
  padding: 12,
}

const overlayBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 14,
  marginBottom: 8,
}

const overlayCanvasStyle: CSSProperties = {
  flex: 1,
  width: '100%',
  minHeight: 0,
  overflow: 'hidden',
}

const closeBtnStyle: CSSProperties = {
  appearance: 'none',
  marginLeft: 'auto',
  border: '1px solid var(--dsw-alias-border-l2, rgba(255 255 255 / 15%))',
  borderRadius: 6,
  padding: '2px 10px',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
}

/** First text line of the durable result content, for the error row. */
function firstResultLine(content: readonly { type: string; text?: string }[]): string {
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
      const newline = block.text.indexOf('\n')
      return newline === -1 ? block.text : block.text.slice(0, newline)
    }
  }
  return 'slide failed'
}

function Frame({ slide, title }: { slide: Slide; title: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <div style={headerStyle}>
        <span style={{ fontWeight: 500 }}>{title}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>OpenMAIC · slide</span>
        <button type="button" style={expandBtnStyle} onClick={() => setExpanded(true)}>⛶ 展开</button>
      </div>
      <div style={canvasWrapStyle}>
        <SlideCanvas slide={slide} />
      </div>
      {expanded ? (
        <div style={overlayStyle}>
          <div style={overlayBarStyle}>
            <span style={{ fontWeight: 500 }}>{title}</span>
            <span style={{ opacity: 0.6 }}>OpenMAIC · slide</span>
            <button type="button" style={closeBtnStyle} onClick={() => setExpanded(false)}>关闭</button>
          </div>
          <div style={overlayCanvasStyle}>
            <SlideCanvas slide={slide} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Keyed toolview for the `openmaic_slide` tool. Running calls and malformed
 * or failed results stay quiet single lines; only a well-formed persisted meta
 * mounts the canvas.
 */
export function SlideCard({ block }: ToolCallViewProps) {
  if (!('kind' in block)) {
    return <div style={headerStyle}>OpenMAIC · rendering slide…</div>
  }
  if (block.isError) {
    return <div style={headerStyle}>OpenMAIC · {firstResultLine(block.content)}</div>
  }
  const meta = slideMetaFrom(block.meta)
  if (meta === undefined) {
    return <div style={headerStyle}>{firstResultLine(block.content)}</div>
  }
  return <Frame slide={meta.slide as Slide} title={meta.title} />
}
