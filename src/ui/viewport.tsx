// Screen size and touch. Below NARROW px the right column (Properties / Help) lies over the canvas and is
// closed until asked for; on a phone a notice says the app is made for a laptop or a tablet. The app's
// height follows the visual viewport, so a tablet's on-screen keyboard does not cover the field being typed in.
// The trainer column is resized by dragging its edge.
import { create } from 'zustand'
import { useEditor } from './store'

export const NARROW = 1000
const PHONE_OK_KEY = 'strataflow.phone-ok'
const TRAINER_W_KEY = 'strataflow.trainer.width'
const SIDE_W_KEY = 'strataflow.side.width'
const TRAINER_W = 340
/** The right column's width: 240 to 640 px, and the canvas keeps at least 320 px. null = the default of each panel. */
export const clampSideWidth = (w: number) => Math.round(Math.max(240, Math.min(w, 640, window.innerWidth - 320)))
const readSideWidth = (): number | null => {
  try {
    const w = Number(localStorage.getItem(SIDE_W_KEY))
    return w ? clampSideWidth(w) : null
  } catch {
    return null
  }
}

// Not yet dragged: 340 px, or half the window on a narrow one (a tablet in portrait), so the canvas shows too.
const defaultWidth = () => Math.min(TRAINER_W, Math.round(window.innerWidth / 2))
const readWidth = () => {
  try {
    return Number(localStorage.getItem(TRAINER_W_KEY)) || defaultWidth()
  } catch {
    return defaultWidth()
  }
}
/** The trainer column's width: at least 240 px, and the canvas keeps at least 160 px. */
export const clampTrainerWidth = (w: number) => Math.round(Math.max(240, Math.min(w, window.innerWidth - 160)))

const isNarrow = () => window.innerWidth < NARROW
// A phone: a screen whose short side is under 480 CSS px (phones are 360–440; a 10" tablet such as the
// Huawei MatePad 10.4 is 500 and, in landscape with the browser bar, only ~430 high, so the window's
// height cannot tell them apart), or a desktop window as narrow as a phone.
const isPhone = () => Math.min(screen.width, screen.height) < 480 || window.innerWidth < 480

const phoneOk = () => {
  try {
    return localStorage.getItem(PHONE_OK_KEY) === '1'
  } catch {
    return false
  }
}

type Layout = {
  narrow: boolean
  phone: boolean
  /** The right column is shown (on a narrow screen: over the canvas). */
  side: boolean
  /** The phone notice was answered with Continue (kept in this browser). */
  phoneOk: boolean
  /** The trainer column's width (dragged by its edge, kept in this browser). */
  trainerW: number
  setTrainerW: (w: number, keep?: boolean) => void
  /** The right column's width (dragged by its left edge, kept in this browser); null = default. */
  sideW: number | null
  setSideW: (w: number | null, keep?: boolean) => void
  setSide: (side: boolean) => void
  continueOnPhone: () => void
}

export const useLayout = create<Layout>((set) => ({
  narrow: isNarrow(),
  phone: isPhone(),
  side: !isNarrow(),
  phoneOk: phoneOk(),
  trainerW: readWidth(),
  sideW: readSideWidth(),
  setSideW: (w, keep) => {
    const sideW = w === null ? null : clampSideWidth(w)
    if (keep)
      try {
        if (sideW === null) localStorage.removeItem(SIDE_W_KEY)
        else localStorage.setItem(SIDE_W_KEY, String(sideW))
      } catch {
        // the width is back to the default next time
      }
    set({ sideW })
  },
  setTrainerW: (w, keep) => {
    const trainerW = clampTrainerWidth(w)
    if (keep)
      try {
        localStorage.setItem(TRAINER_W_KEY, String(trainerW))
      } catch {
        // the width is back to the default next time
      }
    set({ trainerW })
  },
  setSide: (side) => set({ side }),
  continueOnPhone: () => {
    try {
      localStorage.setItem(PHONE_OK_KEY, '1')
    } catch {
      // asked again next time
    }
    set({ phoneOk: true })
  },
}))

/** Shows the right column (Properties, or a help card). */
export const showSide = () => useLayout.getState().setSide(true)

function fit() {
  const s = useLayout.getState()
  const narrow = isNarrow()
  const phone = isPhone()
  // Crossing the width: a wide screen shows the column, a narrow one frees the canvas.
  if (narrow !== s.narrow) useLayout.setState({ narrow, side: !narrow })
  if (phone !== s.phone) useLayout.setState({ phone })
  // A turned tablet: the trainer column still leaves the canvas some room.
  if (s.trainerW !== clampTrainerWidth(s.trainerW)) s.setTrainerW(s.trainerW)
  const vv = window.visualViewport
  if (vv) {
    document.documentElement.style.setProperty('--app-h', `${Math.round(vv.height)}px`)
    // iOS pans the page up under the keyboard; the app is already fitted, so keep it at the top.
    if (window.scrollY) window.scrollTo(0, 0)
  }
}

export function installViewport() {
  fit()
  window.addEventListener('resize', fit)
  window.visualViewport?.addEventListener('resize', fit)
  // Opening a help card, or a name to type (a new step, F2, double-click), shows the column, also where it is closed.
  useEditor.subscribe((s, p) => {
    if ((s.help && s.help !== p.help) || (s.focusName && s.focusName !== p.focusName)) showSide()
    // Closing a help card over the canvas closes the column too (not Properties in its place).
    else if (!s.help && p.help && useLayout.getState().narrow) useLayout.getState().setSide(false)
  })
}

/**
 * The trainer column's edge: drag it (mouse, finger or pen) to give the text or the canvas more room;
 * double-click puts the default width back. Arrow keys move it too.
 */
export function PaneResizer() {
  const w = useLayout((s) => s.trainerW)
  const set = useLayout.getState().setTrainerW
  return (
    <div
      className="pane-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Trainer width"
      aria-valuenow={w}
      tabIndex={0}
      title="Drag to resize (double-click: default width)"
      data-testid="trainer-resizer"
      onPointerDown={(e) => {
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        const x0 = e.clientX
        const w0 = useLayout.getState().trainerW
        el.classList.add('is-dragging')
        const move = (ev: PointerEvent) => set(w0 + ev.clientX - x0)
        const up = (ev: PointerEvent) => {
          set(w0 + ev.clientX - x0, true)
          el.classList.remove('is-dragging')
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.removeEventListener('pointercancel', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      }}
      onDoubleClick={() => {
        try {
          localStorage.removeItem(TRAINER_W_KEY)
        } catch {
          // nothing kept
        }
        set(defaultWidth())
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          set(w + (e.key === 'ArrowLeft' ? -20 : 20), true)
        }
      }}
    />
  )
}

/** The right column's left edge: drag it to make Properties and the help cards wider or narrower; double-click: default. */
export function SideResizer() {
  const w = useLayout((s) => s.sideW)
  const set = useLayout.getState().setSideW
  const current = (el: HTMLElement) => w ?? el.nextElementSibling?.getBoundingClientRect().width ?? 280
  return (
    <div
      className="pane-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Properties width"
      tabIndex={0}
      title="Drag to resize (double-click: default width)"
      data-testid="side-resizer"
      onPointerDown={(e) => {
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        const x0 = e.clientX
        const w0 = current(el)
        el.classList.add('is-dragging')
        const move = (ev: PointerEvent) => set(w0 - (ev.clientX - x0))
        const up = (ev: PointerEvent) => {
          set(w0 - (ev.clientX - x0), true)
          el.classList.remove('is-dragging')
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.removeEventListener('pointercancel', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      }}
      onDoubleClick={() => set(null, true)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          set(current(e.currentTarget) + (e.key === 'ArrowLeft' ? 20 : -20), true)
        }
      }}
    />
  )
}
