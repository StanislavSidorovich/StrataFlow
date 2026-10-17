// The "Aa" button in the top bar: light or dark theme, and the background of the canvas and of the panels,
// each from a few pale tints or any colour, as in StrataSQL and Quaera Lab. Rules and swatches in src/core/look.ts.
import { Moon, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { lookColor, lookVars, NO_LOOK, parseLook, setLookColor, SWATCHES, type Look, type LookPart } from '../core/look'

const LOOK_KEY = 'strataflow.look'

function readLook(): Look {
  try {
    return parseLook(localStorage.getItem(LOOK_KEY))
  } catch {
    return NO_LOOK
  }
}

export function AppearanceButton({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const theme = dark ? 'dark' : 'light'
  const [look, setLook] = useState(readLook)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const style = document.documentElement.style
    for (const [name, value] of Object.entries(lookVars(look, theme))) {
      if (value) style.setProperty(name, value)
      else style.removeProperty(name)
    }
    try {
      localStorage.setItem(LOOK_KEY, JSON.stringify(look))
    } catch {
      /* private mode: the look is not remembered */
    }
  }, [look, theme])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const colorRow = (which: LookPart, label: string) => {
    const current = lookColor(look, which, theme)
    return (
      <div className="look-row">
        <div className="look-label">{label}</div>
        <div className="look-swatches">
          {SWATCHES[which][theme].map((c, i) => (
            <button
              key={c}
              type="button"
              className={`look-swatch${current === c ? ' on' : ''}`}
              style={{ background: c }}
              title={i === 0 ? 'Default' : c}
              aria-label={i === 0 ? `${label}: default` : `${label}: ${c}`}
              aria-pressed={current === c}
              onClick={() => setLook((l) => setLookColor(l, which, theme, c))}
            />
          ))}
          <label className="look-swatch look-custom" title="Any colour…" style={{ background: current }}>
            <span aria-hidden>+</span>
            <input type="color" aria-label={`${label}: any colour`} value={current} onChange={(e) => setLook((l) => setLookColor(l, which, theme, e.target.value))} />
          </label>
        </div>
      </div>
    )
  }

  return (
    <div className="menu" ref={root}>
      <button className={`btn icon look-button${open ? ' is-open' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label="Appearance" title="Appearance: light or dark theme, canvas and panel colours" data-testid="appearance">
        Aa
      </button>
      {open && (
        <div role="dialog" aria-label="Appearance" className="look-panel">
          <div className="look-row">
            <div className="look-label">Theme</div>
            <div className="look-theme" role="radiogroup" aria-label="Theme">
              {([false, true] as const).map((d) => (
                <button key={String(d)} type="button" role="radio" aria-checked={dark === d} className={dark === d ? 'on' : ''} onClick={() => dark !== d && onToggleTheme()}>
                  {d ? <Moon size={14} aria-hidden /> : <Sun size={14} aria-hidden />}
                  {d ? 'Dark' : 'Light'}
                </button>
              ))}
            </div>
          </div>
          {colorRow('canvas', 'Canvas')}
          {colorRow('panels', 'Panels (top bar, side columns)')}
          <div className="look-hint">Colours are kept separately for the light and dark theme, in this browser.</div>
          <button type="button" className="btn look-reset" onClick={() => setLook(NO_LOOK)}>
            Reset to default
          </button>
        </div>
      )}
    </div>
  )
}
