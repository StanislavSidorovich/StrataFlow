// Panel borders ("Borders" in the Aa menu): Strong (default) is the family's --q-line, Soft a paler line
// (data-borders="soft" on <html>, defined in src/family/tokens.css). Kept in this browser only;
// index.html sets the attribute before the first paint so the page does not flash.

export type Borders = 'soft' | 'strong'

export const BORDERS_KEY = 'strataflow.borders'

export function readBorders(): Borders {
  try {
    return localStorage.getItem(BORDERS_KEY) === 'soft' ? 'soft' : 'strong'
  } catch {
    return 'strong'
  }
}

/** Sets the attribute on <html> and remembers the choice; Strong (the default) removes both. */
export function applyBorders(b: Borders): void {
  const el = document.documentElement
  if (b === 'soft') el.setAttribute('data-borders', 'soft')
  else el.removeAttribute('data-borders')
  try {
    if (b === 'soft') localStorage.setItem(BORDERS_KEY, 'soft')
    else localStorage.removeItem(BORDERS_KEY)
  } catch {
    /* private mode: the choice is not remembered */
  }
}
