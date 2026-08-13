/** Unit tests for the openmaic_widget meta contract (pure, no I/O). */

import { describe, expect, it } from 'vitest'
import { SUPPORTED_WIDGET_TYPES, widgetMetaFrom, extractStreamingWidget, OPENMAIC_WIDGET_TOOL_NAME } from '../src/widget-meta.ts'

describe('widgetMetaFrom', () => {
  it('narrows a well-formed widget meta', () => {
    expect(widgetMetaFrom({ kind: 'openmaic-widget', html: '<!doctype html>', title: 't', widgetType: 'simulation' }))
      .toEqual({ kind: 'openmaic-widget', html: '<!doctype html>', title: 't', widgetType: 'simulation' })
  })

  it('rejects a foreign or malformed meta', () => {
    expect(widgetMetaFrom(undefined)).toBeUndefined()
    expect(widgetMetaFrom(null)).toBeUndefined()
    expect(widgetMetaFrom({ kind: 'openmaic-render' })).toBeUndefined()
    expect(widgetMetaFrom({ kind: 'openmaic-widget', html: 1, title: 't', widgetType: 'game' })).toBeUndefined()
    // unsupported widget type (diagram is not wired up in v0.3)
    expect(widgetMetaFrom({ kind: 'openmaic-widget', html: '<p>x</p>', title: 't', widgetType: 'diagram' })).toBeUndefined()
  })
})

describe('SUPPORTED_WIDGET_TYPES', () => {
  it('wires up simulation, game, and code', () => {
    expect([...SUPPORTED_WIDGET_TYPES].sort()).toEqual(['code', 'game', 'simulation'])
  })
})

it('exposes the wire tool name', () => {
  expect(OPENMAIC_WIDGET_TOOL_NAME).toBe('openmaic_widget')
})

describe('extractStreamingWidget', () => {
  it('decodes a complete html argument', () => {
    expect(extractStreamingWidget('{"html":"<!doctype html><p>hi</p>","widgetType":"game"}'))
      .toBe('<!doctype html><p>hi</p>')
  })

  it('decodes a partial prefix without the closing quote', () => {
    expect(extractStreamingWidget('{"html":"<!doctype html><div>')).toBe('<!doctype html><div>')
  })

  it('returns undefined before the html opener streams in', () => {
    expect(extractStreamingWidget('{"title":"x"')).toBeUndefined()
  })
})
