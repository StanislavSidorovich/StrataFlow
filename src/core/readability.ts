// Readability settings in the Aa menu: the size of the interface text (top bar, side columns, panels; not
// the canvas, whose text has its own S / M / L / XL) and the text contrast. Kept in this browser only;
// index.html sets the size before the first paint.

export const UI_SIZE_KEY = 'strataflow.uiSize'
export const CONTRAST_KEY = 'strataflow.contrast'

export const UI_SIZES = [
  { id: 'S', scale: 0.92, label: 'Small' },
  { id: 'M', scale: 1, label: 'Medium (default)' },
  { id: 'M+', scale: 1.07, label: 'Medium plus' },
  { id: 'L', scale: 1.15, label: 'Large' },
  { id: 'XL', scale: 1.3, label: 'Extra large' },
] as const
export type UiSize = (typeof UI_SIZES)[number]['id']

export const parseUiSize = (v: string | null): UiSize => UI_SIZES.find((s) => s.id === v)?.id ?? 'M'
export const uiScale = (size: UiSize): number => UI_SIZES.find((s) => s.id === size)!.scale

export const CONTRASTS = [
  { id: 0, label: 'Normal' },
  { id: 1, label: 'Higher' },
  { id: 2, label: 'Highest' },
] as const
export type Contrast = (typeof CONTRASTS)[number]['id']

export const parseContrast = (v: string | null): Contrast => (v === '1' ? 1 : v === '2' ? 2 : 0)

/** The text colours for a contrast level: darker text on the light theme, brighter on the dark one. Level 0 sets nothing. */
export function contrastVars(level: Contrast, theme: 'light' | 'dark'): { '--text'?: string; '--muted'?: string; '--ui-weight'?: string } {
  if (level === 0) return {}
  const table = {
    // Level 2 also makes the text a little heavier (--ui-weight, read by the body): thin strokes are what tires the eye.
    light: [
      { '--text': '#000000', '--muted': '#323948' },
      { '--text': '#000000', '--muted': '#000000', '--ui-weight': '500' },
    ],
    dark: [
      { '--text': '#ffffff', '--muted': '#d0d5e1' },
      { '--text': '#ffffff', '--muted': '#ffffff', '--ui-weight': '500' },
    ],
  }
  return table[theme][level - 1]
}
