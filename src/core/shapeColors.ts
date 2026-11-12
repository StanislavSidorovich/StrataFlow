// Colour shapes ("Shapes" in the Aa menu): off (default) keeps the monochrome look; on tints start events green,
// end events red and gateways amber, so decisions and the ends of a process stand out. The colours live in CSS
// (`data-shape-colour="on"` on <html>, src/index.css), so the canvas and the PNG / SVG export, which reads the
// computed styles, always agree. Kept in this browser only; index.html sets the attribute before the first paint.

export const SHAPE_COLOUR_KEY = 'strataflow.shapeColour'

export function readShapeColour(): boolean {
  try {
    return localStorage.getItem(SHAPE_COLOUR_KEY) === 'on'
  } catch {
    return false
  }
}

/** Sets the attribute on <html> and remembers the choice; off (the default) removes both. */
export function applyShapeColour(on: boolean): void {
  const el = document.documentElement
  if (on) el.setAttribute('data-shape-colour', 'on')
  else el.removeAttribute('data-shape-colour')
  try {
    if (on) localStorage.setItem(SHAPE_COLOUR_KEY, 'on')
    else localStorage.removeItem(SHAPE_COLOUR_KEY)
  } catch {
    /* private mode: the choice is not remembered */
  }
}
