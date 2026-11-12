import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyShapeColour, readShapeColour, SHAPE_COLOUR_KEY } from '../src/core/shapeColors'

// No DOM in the test environment: a small stand-in for <html> and localStorage.
const attrs = new Map<string, string>()
const store = new Map<string, string>()

describe('colour shapes setting', () => {
  beforeEach(() => {
    attrs.clear()
    store.clear()
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
        getAttribute: (k: string) => attrs.get(k) ?? null,
      },
    })
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    })
  })

  it('is off by default', () => {
    expect(readShapeColour()).toBe(false)
  })

  it('on sets the attribute and is remembered; off clears both', () => {
    applyShapeColour(true)
    expect(attrs.get('data-shape-colour')).toBe('on')
    expect(store.get(SHAPE_COLOUR_KEY)).toBe('on')
    expect(readShapeColour()).toBe(true)
    applyShapeColour(false)
    expect(attrs.has('data-shape-colour')).toBe(false)
    expect(store.has(SHAPE_COLOUR_KEY)).toBe(false)
  })

  it('survives a blocked storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
    expect(readShapeColour()).toBe(false)
    expect(() => applyShapeColour(true)).not.toThrow()
  })
})
