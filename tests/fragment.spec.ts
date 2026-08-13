/** Unit tests for the openmaic_render fragment contract (pure, no I/O). */

import { describe, expect, it } from 'vitest'
import { byteLength, openmaicMetaFrom, validateFragment, OPENMAIC_RENDER_TOOL_NAME } from '../src/fragment.ts'

describe('validateFragment', () => {
  it('accepts a plain inline fragment and returns its UTF-8 byte size', () => {
    expect(validateFragment('<div class="card">hi</div>', 1024)).toBeGreaterThan(0)
  })

  it('rejects an empty fragment', () => {
    expect(() => validateFragment('   ', 1024)).toThrow(/empty/)
  })

  it('rejects a document-skeleton tag', () => {
    expect(() => validateFragment('<!doctype html><p>x</p>', 1024)).toThrow(/document-skeleton/)
    expect(() => validateFragment('<html></html>', 1024)).toThrow(/document-skeleton/)
    expect(() => validateFragment('<body>hi</body>', 1024)).toThrow(/document-skeleton/)
  })

  it('rejects an oversized fragment', () => {
    expect(() => validateFragment('x'.repeat(300), 100)).toThrow(/bytes/)
  })
})

describe('openmaicMetaFrom', () => {
  it('narrows a well-formed meta', () => {
    expect(openmaicMetaFrom({ kind: 'openmaic-render', fragment: '<p>x</p>', title: 't' }))
      .toEqual({ kind: 'openmaic-render', fragment: '<p>x</p>', title: 't' })
  })

  it('rejects a foreign or malformed meta', () => {
    expect(openmaicMetaFrom(undefined)).toBeUndefined()
    expect(openmaicMetaFrom(null)).toBeUndefined()
    expect(openmaicMetaFrom({ kind: 'other' })).toBeUndefined()
    expect(openmaicMetaFrom({ kind: 'openmaic-render', fragment: 1, title: 't' })).toBeUndefined()
    expect(openmaicMetaFrom({ kind: 'openmaic-render', fragment: '<p>x</p>' })).toBeUndefined()
  })
})

describe('byteLength', () => {
  it('counts UTF-8 bytes', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('你好')).toBe(6)
  })
})

it('exposes the wire tool name', () => {
  expect(OPENMAIC_RENDER_TOOL_NAME).toBe('openmaic_render')
})
