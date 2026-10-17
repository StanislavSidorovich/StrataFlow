import { describe, expect, it } from 'vitest'
import { lookColor, lookVars, NO_LOOK, normalColor, parseLook, setLookColor, SWATCHES } from '../src/core/look'

describe('appearance (canvas and panel colours)', () => {
  it('reads a stored look and drops anything that is not a #RRGGBB colour', () => {
    expect(parseLook(null)).toEqual(NO_LOOK)
    expect(parseLook('not json')).toEqual(NO_LOOK)
    expect(parseLook('{"canvas":{"light":"#F8F4EA","dark":"red"},"panels":{"dark":"#18212e;color:red"}}')).toEqual({
      canvas: { light: '#f8f4ea' },
      panels: {},
    })
    expect(normalColor(' #ABCDEF ')).toBe('#abcdef')
    expect(normalColor('#abc')).toBeUndefined()
  })

  it('keeps colours per theme; the default colour or none removes the choice', () => {
    let look = setLookColor(NO_LOOK, 'panels', 'light', '#f6f1e4')
    look = setLookColor(look, 'panels', 'dark', '#18212e')
    expect(look.panels).toEqual({ light: '#f6f1e4', dark: '#18212e' })
    expect(lookColor(look, 'canvas', 'dark')).toBe(SWATCHES.canvas.dark[0])
    expect(setLookColor(look, 'panels', 'light', SWATCHES.panels.light[0]).panels).toEqual({ dark: '#18212e' })
    expect(setLookColor(look, 'panels', 'dark', undefined).panels).toEqual({ light: '#f6f1e4' })
  })

  it('gives the CSS variables of the current theme only', () => {
    const look = { canvas: { light: '#edf6f0' }, panels: { dark: '#18212e' } }
    expect(lookVars(look, 'light')).toEqual({ '--canvas-bg': '#edf6f0', '--panel-bg': undefined })
    expect(lookVars(look, 'dark')).toEqual({ '--canvas-bg': undefined, '--panel-bg': '#18212e' })
  })

  it('offers the same tints as StrataSQL, the theme colour first', () => {
    for (const p of ['canvas', 'panels'] as const)
      for (const t of ['light', 'dark'] as const) {
        expect(SWATCHES[p][t]).toHaveLength(7)
        expect(new Set(SWATCHES[p][t]).size).toBe(7)
      }
    expect(SWATCHES.canvas.light[0]).toBe('#fbfbfc')
    expect(SWATCHES.panels.dark[0]).toBe('#1b1f27')
  })
})
