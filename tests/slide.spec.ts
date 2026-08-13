/** Unit tests for the openmaic_slide meta contract (pure, no I/O). */

import { describe, expect, it } from 'vitest'
import { OPENMAIC_SLIDE_TOOL_NAME, slideMetaFrom } from '../src/slide-meta.ts'

describe('slideMetaFrom', () => {
  it('narrows a well-formed slide meta', () => {
    const slide = { viewportSize: 1280, viewportRatio: 1.77, elements: [] }
    expect(slideMetaFrom({ kind: 'openmaic-slide', slide, title: 't' }))
      .toEqual({ kind: 'openmaic-slide', slide, title: 't' })
  })

  it('rejects a foreign or malformed meta', () => {
    expect(slideMetaFrom(undefined)).toBeUndefined()
    expect(slideMetaFrom({ kind: 'openmaic-widget' })).toBeUndefined()
    expect(slideMetaFrom({ kind: 'openmaic-slide', slide: 'not-an-object', title: 't' })).toBeUndefined()
    expect(slideMetaFrom({ kind: 'openmaic-slide', slide: [], title: 't' })).toBeUndefined()
    expect(slideMetaFrom({ kind: 'openmaic-slide', slide: {}, title: 1 })).toBeUndefined()
  })
})

it('exposes the wire tool name', () => {
  expect(OPENMAIC_SLIDE_TOOL_NAME).toBe('openmaic_slide')
})
