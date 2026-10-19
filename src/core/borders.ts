// Panel borders ("Borders" in the Aa menu): Soft is the family's --q-line, Strong is a darker line
// (data-borders="strong" on <html>, defined in src/family/tokens.css). Kept in this browser only;
// index.html sets the attribute before the first paint so the page does not flash.

export type Borders = 'soft' | 'strong'

export const BORDERS_KEY = 'strataflow.borders'

export function readBorders(): Borders {
  try {
    return localStorage.getItem(BORDERS_KEY) === 'strong' ? 'strong' : 'soft'
  } catch {
    return 'soft'
  }
}

/** Sets the attribute on <html> and remembers the choice; Soft removes both. */
export function applyBorders(b: Borders): void {
  const el = document.documentElement
  if (b === 'strong') el.setAttribute('data-borders', 'strong')
  else el.removeAttribute('data-borders')
  try {
    if (b === 'strong') localStorage.setItem(BORDERS_KEY, 'strong')
    else localStorage.removeItem(BORDERS_KEY)
  } catch {
    /* private mode: the choice is not remembered */
  }
}
