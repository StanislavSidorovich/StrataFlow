import { describe, expect, it } from 'vitest'
import { contrastVars, parseContrast, parseUiSize, uiScale } from '../src/core/readability'

describe('readability settings', () => {
  it('reads stored values, anything else is the default', () => {
    expect(parseUiSize('XL')).toBe('XL')
    expect(parseUiSize('M+')).toBe('M+')
    expect(uiScale('M+')).toBeGreaterThan(uiScale('M'))
    expect(parseUiSize('huge')).toBe('M')
    expect(parseUiSize(null)).toBe('M')
    expect(uiScale('M')).toBe(1)
    expect(parseContrast('2')).toBe(2)
    expect(parseContrast('x')).toBe(0)
  })

  it('normal contrast sets nothing; higher goes darker in light and brighter in dark', () => {
    expect(contrastVars(0, 'light')).toEqual({})
    expect(contrastVars(2, 'light')['--text']).toBe('#000000')
    expect(contrastVars(2, 'dark')['--text']).toBe('#ffffff')
    expect(contrastVars(1, 'light')['--muted']).not.toBe(contrastVars(2, 'light')['--muted'])
  })
})
