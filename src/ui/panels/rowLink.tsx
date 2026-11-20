// Two small helpers of the Simulate panel (v0.19.0).
// 1. Rows and the canvas: pointing at a table row lights its element on the canvas, clicking selects it, and an element
//    selected on the canvas lights its row and scrolls the table to it.
// 2. The panel's height: a handle between canvas and panel, fold / maximise buttons, the height kept in localStorage.
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { create } from 'zustand'
import { useEditor } from '../store'

// ---------------------------------------------------------------- row <-> element

const useHover = create<{ id: string | null }>()(() => ({ id: null }))

/** Props for a table row that stands for an element: `<tr {...row(id)}>`. */
export function useRowLink() {
  const selection = useEditor((s) => s.selection)
  return (id: string, extra?: string) => ({
    'data-el': id,
    className: ['sim-row', selection.includes(id) ? 'is-selected' : '', extra ?? ''].filter(Boolean).join(' '),
    onMouseEnter: () => useHover.setState({ id }),
    onMouseLeave: () => useHover.setState((s) => (s.id === id ? { id: null } : s)),
    onClick: (e: { target: EventTarget }) => {
      // Typing in a field or pressing its picker is not a request to jump to the element.
      if ((e.target as HTMLElement).closest('input, select, button, a, label, textarea')) return
      useEditor.getState().select([id])
    },
  })
}

/** Lights the hovered row's element on the canvas, and scrolls the table to an element selected there. */
export function RowHighlight() {
  const id = useHover((s) => s.id)
  const selection = useEditor((s) => s.selection)
  const key = selection.join('|')
  useEffect(() => {
    // The ids are generated (no quotes), but a pasted file may carry anything: escape for the selector.
    for (const sel of selection) {
      const row = document.querySelector<HTMLElement>(`.sim-panel [data-el="${CSS.escape(sel)}"]`)
      if (row) {
        row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        break
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  // The panel closes or another tab opens while the pointer is on a row: no mouseleave comes, so clear on unmount.
  useEffect(() => () => useHover.setState({ id: null }), [])
  if (!id) return null
  return <style data-testid="row-highlight">{`.react-flow__node[data-id="${CSS.escape(id).replace(/"/g, '\\"')}"]{outline:3px solid var(--accent);outline-offset:3px;border-radius:6px;filter:drop-shadow(0 0 6px var(--accent));}`}</style>
}

// ---------------------------------------------------------------- panel height

const KEY = 'strataflow.sim.panel'
const MIN = 120

interface Saved {
  height?: number
  collapsed?: boolean
  maximised?: boolean
}
const load = (): Saved => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { height: typeof v.height === 'number' && v.height >= MIN ? v.height : undefined, collapsed: !!v.collapsed, maximised: !!v.maximised }
  } catch {
    return {}
  }
}
const store = (v: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* storage off: the height lasts for this visit */
  }
}

const useSize = create<Saved>()(() => load())

/** The tallest the panel may be: the window minus the toolbar and a strip of canvas. */
export const MAX_CSS = 'calc((100dvh - 150px) / var(--ui-zoom, 1))'
/** The panel is zoomed with the interface text size (Aa menu): a height typed in screen pixels is divided by it. */
const zoom = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1

export function usePanelHeight() {
  const s = useSize()
  const patch = (p: Saved) => {
    useSize.setState(p)
    store({ height: useSize.getState().height, collapsed: useSize.getState().collapsed, maximised: useSize.getState().maximised })
  }
  return {
    height: s.maximised ? MAX_CSS : s.height ? `${s.height}px` : undefined,
    collapsed: !!s.collapsed,
    maximised: !!s.maximised,
    px: s.height,
    /** `h` in screen pixels. */
    setHeight: (h: number) => patch({ height: Math.round(Math.max(MIN, Math.min(h, window.innerHeight - 150)) / zoom()), maximised: false, collapsed: false }),
    toggleCollapsed: () => patch({ collapsed: !s.collapsed }),
    toggleMax: () => patch({ maximised: !s.maximised, collapsed: false }),
  }
}
export type PanelSize = ReturnType<typeof usePanelHeight>

/** The strip on the panel's top edge: drag up to make the panel taller, arrow keys do the same. */
export function PanelResizer({ size }: { size: PanelSize }) {
  const start = useRef<{ y: number; h: number } | null>(null)
  const panelHeight = (el: HTMLElement) => el.closest('section')?.getBoundingClientRect().height ?? 300
  const down = (e: PointerEvent<HTMLDivElement>) => {
    start.current = { y: e.clientY, h: panelHeight(e.currentTarget) }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current) size.setHeight(start.current.h + (start.current.y - e.clientY))
  }
  const up = () => {
    start.current = null
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const h = panelHeight(e.currentTarget)
    if (e.key === 'ArrowUp') size.setHeight(h + 40)
    else if (e.key === 'ArrowDown') size.setHeight(h - 40)
    else return
    e.preventDefault()
  }
  if (size.collapsed) return null
  return (
    <div
      className="sim-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Panel height: drag, or use the arrow keys"
      tabIndex={0}
      title="Drag to change the height of this panel"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      data-testid="sim-resizer"
    />
  )
}
