// The "Aa" button in the top bar: light or dark theme, the diagram's text size (S / M / L / XL), and the
// background of the canvas and of the panels, each from a few pale tints or any colour, as in StrataSQL and
// Quaera Lab. Rules and swatches in src/core/look.ts.
import { Moon, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { applyBorders, readBorders, type Borders } from '../core/borders'
import { CONTRAST_KEY, CONTRASTS, contrastVars, parseContrast, parseUiSize, UI_SIZE_KEY, UI_SIZES, uiScale, type Contrast, type UiSize } from '../core/readability'
import { LABEL_SIZES, LABELS_KEY, labelScale, lookColor, lookVars, NO_LOOK, parseLabelSize, parseLook, setLookColor, SWATCHES, type LabelSize, type Look, type LookPart } from '../core/look'

const LOOK_KEY = 'strataflow.look'

function readUiSize(): UiSize {
  try {
    return parseUiSize(localStorage.getItem(UI_SIZE_KEY))
  } catch {
    return 'M'
  }
}

function readContrast(): Contrast {
  try {
    return parseContrast(localStorage.getItem(CONTRAST_KEY))
  } catch {
    return 0
  }
}

function readLabelSize(): LabelSize {
  try {
    return parseLabelSize(localStorage.getItem(LABELS_KEY))
  } catch {
    return 'M'
  }
}

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
  const [borders, setBorders] = useState<Borders>(readBorders)
  const [labels, setLabels] = useState<LabelSize>(readLabelSize)
  const [uiSize, setUiSize] = useState<UiSize>(readUiSize)
  const [contrast, setContrast] = useState<Contrast>(readContrast)
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

  useEffect(() => applyBorders(borders), [borders])

  useEffect(() => {
    const style = document.documentElement.style
    if (uiSize === 'M') style.removeProperty('--ui-zoom')
    else style.setProperty('--ui-zoom', String(uiScale(uiSize)))
    try {
      if (uiSize === 'M') localStorage.removeItem(UI_SIZE_KEY)
      else localStorage.setItem(UI_SIZE_KEY, uiSize)
    } catch {
      /* private mode: the size is not remembered */
    }
  }, [uiSize])

  useEffect(() => {
    const style = document.documentElement.style
    const vars = contrastVars(contrast, theme)
    // After the look effect above, so the contrast wins over the panel tint's text colours.
    for (const name of ['--text', '--muted', '--ui-weight'] as const) {
      if (vars[name]) style.setProperty(name, vars[name]!)
      else style.removeProperty(name)
    }
    try {
      if (contrast === 0) localStorage.removeItem(CONTRAST_KEY)
      else localStorage.setItem(CONTRAST_KEY, String(contrast))
    } catch {
      /* private mode: the contrast is not remembered */
    }
  }, [contrast, theme])

  useEffect(() => {
    // On the root, so the exported picture and the canvas both read it; index.html sets it before the first paint.
    if (labels === 'M') document.documentElement.style.removeProperty('--label-scale')
    else document.documentElement.style.setProperty('--label-scale', String(labelScale(labels)))
    try {
      if (labels === 'M') localStorage.removeItem(LABELS_KEY)
      else localStorage.setItem(LABELS_KEY, labels)
    } catch {
      /* private mode: the size is not remembered */
    }
  }, [labels])

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
          <div className="look-row">
            <div className="look-label">Borders</div>
            <div className="look-theme" role="radiogroup" aria-label="Borders">
              {(['strong', 'soft'] as const).map((b) => (
                <button key={b} type="button" role="radio" aria-checked={borders === b} className={borders === b ? 'on' : ''} onClick={() => setBorders(b)}>
                  {b === 'strong' ? 'Strong' : 'Soft'}
                </button>
              ))}
            </div>
          </div>
          <div className="look-row">
            <div className="look-label">Diagram text</div>
            <div className="look-theme" role="radiogroup" aria-label="Diagram text size">
              {LABEL_SIZES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={labels === s.id} className={labels === s.id ? 'on' : ''} title={`${s.label}: names of shapes, flows and lanes`} data-testid={`label-size-${s.id}`} onClick={() => setLabels(s.id)}>
                  {s.id}
                </button>
              ))}
            </div>
          </div>
          <div className="look-row">
            <div className="look-label">Interface text</div>
            <div className="look-theme" role="radiogroup" aria-label="Interface text size">
              {UI_SIZES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={uiSize === s.id} className={uiSize === s.id ? 'on' : ''} title={`${s.label}: top bar, trainer, side columns, panels`} data-testid={`ui-size-${s.id}`} onClick={() => setUiSize(s.id)}>
                  {s.id}
                </button>
              ))}
            </div>
          </div>
          <div className="look-row">
            <div className="look-label">Text contrast</div>
            <div className="look-theme" role="radiogroup" aria-label="Text contrast">
              {CONTRASTS.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={contrast === c.id} className={contrast === c.id ? 'on' : ''} title={dark ? 'Brighter text' : 'Darker text'} data-testid={`contrast-${c.id}`} onClick={() => setContrast(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {colorRow('canvas', 'Canvas')}
          {colorRow('panels', 'Panels (top bar, side columns)')}
          <div className="look-hint">Colours are kept separately for the light and dark theme, in this browser.</div>
          <button type="button" className="btn look-reset" onClick={() => {
              setLook(NO_LOOK)
              setBorders('strong')
              setLabels('M')
              setUiSize('M')
              setContrast(0)
            }}>
            Reset to default
          </button>
        </div>
      )}
    </div>
  )
}
