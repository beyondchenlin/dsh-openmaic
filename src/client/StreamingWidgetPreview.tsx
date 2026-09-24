/**
 * Live streaming code preview docked under the composer: while the model is
 * still generating an `openmaic_widget` call, the accumulated `html` argument
 * stream is decoded and shown as monospace code in a card. Once the call
 * settles, this unmounts and the transcript's WidgetCard renders the document.
 *
 * @module @openmaic/dsh-openmaic/client/StreamingWidgetPreview
 */

import { useEffect, useRef, type CSSProperties } from 'react'
import type { UseConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { extractStreamingWidget, OPENMAIC_WIDGET_TOOL_NAME } from '../widget-meta.ts'

type StreamingWidgetPreviewProps = { useConversation: UseConversation }

const wrapStyle: CSSProperties = { margin: '6px auto 2px', maxWidth: 760, width: '100%' }

const labelStyle: CSSProperties = {
  fontSize: 12,
  opacity: 0.65,
  margin: '0 0 4px',
}

const codeStyle: CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  maxHeight: 200,
  overflow: 'auto',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2, rgba(0 0 0 / 10%))',
  background: 'var(--dsw-alias-bg-layer-1, transparent)',
  color: 'var(--dsw-alias-label-primary, inherit)',
  font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

/**
 * Dock entry: mounts exactly while the streaming partial carries an
 * `openmaic_widget` tool-call block, and shows the widget HTML as it streams.
 */
export function StreamingWidgetPreview({ useConversation }: StreamingWidgetPreviewProps) {
  const blocks = useConversation(snapshot => {
    const views = snapshot.views as { get(target: string): ChatSnapshot | undefined }
    return views.get('chat')?.legacy.partial?.blocks
  })
  if (blocks === undefined) return null
  let argsRaw: string | undefined
  for (const block of blocks) {
    if (block.kind === 'tool-call' && block.name === OPENMAIC_WIDGET_TOOL_NAME) argsRaw = block.argsRaw
  }
  if (argsRaw === undefined) return null
  const html = extractStreamingWidget(argsRaw)
  if (html === undefined || html.trim() === '') return null

  return <Preview html={html} />
}

function Preview({ html }: { html: string }) {
  const preRef = useRef<HTMLPreElement | null>(null)
  useEffect(() => {
    const el = preRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [html])
  return (
    <div style={wrapStyle}>
      <div style={labelStyle}>OpenMAIC · generating widget…</div>
      <pre ref={preRef} style={codeStyle}>{html}</pre>
    </div>
  )
}
