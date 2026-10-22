// Readability settings in the Aa menu: the size of the interface text (top bar, side columns, panels; not
// the canvas, whose text has its own S / M / L / XL) and the text contrast. Kept in this browser only;
// index.html sets the size before the first paint.

export const UI_SIZE_KEY = 'strataflow.uiSize'
export const CONTRAST_KEY = 'strataflow.contrast'

export const UI_SIZES = [
  { id: 'S', scale: 0.92, label: 'Small' },
  { id: 'M', scale: 1, label: 'Medium (default)' },
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
export function contrastVars(level: Contrast, theme: 'light' | 'dark'): { '--text'?: string; '--muted'?: string } {
  if (level === 0) return {}
  const table = {
    light: [
      { '--text': '#0b0f18', '--muted': '#454d5f' },
      { '--text': '#000000', '--muted': '#2c3342' },
    ],
    dark: [
      { '--text': '#f4f6fa', '--muted': '#b9c0d0' },
      { '--text': '#ffffff', '--muted': '#d4d9e5' },
    ],
  }
  return table[theme][level - 1]
}
