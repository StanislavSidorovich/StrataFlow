// Appearance ("Aa" in the top bar): the canvas background and the panels' background, chosen from
// a few pale tints or any colour, kept separately for the light and the dark theme (a pale panel
// picked in light mode must not end up behind light text in dark mode). Same swatches and storage
// shape as StrataSQL's Appearance (model.quaera.app) and Quaera Lab's, so the Quaera apps match.

export type Theme = 'light' | 'dark'
export type LookPart = 'canvas' | 'panels'

export interface Look {
  canvas: Partial<Record<Theme, string>>
  panels: Partial<Record<Theme, string>>
}

export const NO_LOOK: Look = { canvas: {}, panels: {} }

/** First swatch = the theme's own colour (src/index.css); then warm, green, blue, violet, rose, grey. */
export const SWATCHES: Record<LookPart, Record<Theme, string[]>> = {
  canvas: {
    light: ['#fbfbfc', '#f8f4ea', '#edf6f0', '#edf3fb', '#f3effa', '#fbeff0', '#e9ecf0'],
    dark: ['#171a21', '#1d1b16', '#14201b', '#131b27', '#1d1826', '#0e1014', '#262a31'],
  },
  panels: {
    light: ['#ffffff', '#f6f1e4', '#e8f3ec', '#e7eff9', '#efe9f8', '#f9eaec', '#eceef2'],
    dark: ['#1b1f27', '#24211b', '#18251f', '#18212e', '#231d2d', '#121418', '#2b3038'],
  },
}

const HEX = /^#[0-9a-f]{6}$/

/** `#RRGGBB` in lower case, or undefined for anything else (it goes into CSS). */
export function normalColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const c = v.trim().toLowerCase()
  return HEX.test(c) ? c : undefined
}

function part(v: unknown): Partial<Record<Theme, string>> {
  const out: Partial<Record<Theme, string>> = {}
  if (v && typeof v === 'object') {
    for (const t of ['light', 'dark'] as const) {
      const c = normalColor((v as Record<string, unknown>)[t])
      if (c) out[t] = c
    }
  }
  return out
}

/** The stored look (JSON from localStorage); anything broken or unknown is dropped. */
export function parseLook(json: string | null): Look {
  try {
    const v = JSON.parse(json ?? '{}') as Record<string, unknown>
    return { canvas: part(v?.canvas), panels: part(v?.panels) }
  } catch {
    return { canvas: {}, panels: {} }
  }
}

/** The look with one colour changed; undefined (or the theme's own colour) goes back to the default. */
export function setLookColor(look: Look, which: LookPart, theme: Theme, color: string | undefined): Look {
  const c = normalColor(color)
  const next = { ...look[which] }
  if (!c || c === SWATCHES[which][theme][0]) delete next[theme]
  else next[theme] = c
  return { ...look, [which]: next }
}

/** The colour shown for a part: the chosen one, or the theme's own. */
export function lookColor(look: Look, which: LookPart, theme: Theme): string {
  return look[which][theme] ?? SWATCHES[which][theme][0]
}

/** The CSS variables to set on the page for the current theme; undefined = the stylesheet's own value. */
export function lookVars(look: Look, theme: Theme): Record<string, string | undefined> {
  return { '--canvas-bg': look.canvas[theme], '--panel-bg': look.panels[theme] }
}
