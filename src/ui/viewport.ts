// Screen size and touch. Below NARROW px the right column (Properties / Help) lies over the canvas and is
// closed until asked for; on a phone a notice says the app is made for a laptop or a tablet. The app's
// height follows the visual viewport, so a tablet's on-screen keyboard does not cover the field being typed in.
import { create } from 'zustand'
import { useEditor } from './store'

export const NARROW = 1000
const PHONE_OK_KEY = 'strataflow.phone-ok'

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
  setSide: (side: boolean) => void
  continueOnPhone: () => void
}

export const useLayout = create<Layout>((set) => ({
  narrow: isNarrow(),
  phone: isPhone(),
  side: !isNarrow(),
  phoneOk: phoneOk(),
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
