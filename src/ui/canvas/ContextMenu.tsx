// The context menu: right-click on the canvas (as in Bizagi) or the wrench of the context pad (bpmn.io's
// "Change type"). Its entries come from menu.ts; each edit is one undo step through the store, and a change
// the ops refuse is shown in the notice bar. Keys: arrows, Enter, Esc. Closes on a click outside, a scroll
// or a zoom, and stays inside the window.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight } from 'lucide-react'
import { canPaste, copySelection, cutSelection, duplicateSelection, groupSelection, layoutNow, pasteClipboard, renameElement, ungroupSelection } from '../actions'
import { useEditor, type ContextMenuState } from '../store'
import { helpCardFor, menuFor, typeEntries, type MenuEntry, type MenuItem } from './menu'

export function ContextMenu() {
  const state = useEditor((s) => s.menu)
  const model = useEditor((s) => s.model)
  const page = useEditor((s) => s.page)
  const box = useRef<HTMLDivElement>(null)
  const close = () => useEditor.getState().openMenu(null)

  useEffect(() => {
    if (!state) return
    const away = (e: Event) => !box.current?.contains(e.target as Node) && close()
    const gone = () => close()
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('wheel', away, { capture: true, passive: true })
    document.addEventListener('scroll', away, true)
    window.addEventListener('resize', gone)
    window.addEventListener('blur', gone)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('wheel', away, true)
      document.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', gone)
      window.removeEventListener('blur', gone)
    }
  }, [state])

  if (!state) return null
  const items = state.kind === 'type' ? typeEntries(model, state.ids[0]) : menuFor(model, state.ids, state.at, page, canPaste())
  if (!items.length) return null
  return createPortal(
    <div ref={box} className="ctx-menu-root" data-testid="context-menu" onContextMenu={(e) => e.preventDefault()}>
      <MenuList key={`${state.x},${state.y}`} items={items} at={{ x: state.x, y: state.y }} level={0} onPick={(e) => pick(e, state)} onBack={close} />
    </div>,
    document.body,
  )
}

/** Runs an entry: an edit (one undo step; what it returns is selected) or a command. */
function pick(e: MenuEntry, state: ContextMenuState) {
  const s = useEditor.getState()
  s.openMenu(null)
  const id = state.ids[0]
  if (e.edit) {
    let created: string | void = undefined
    if (s.apply((m) => void (created = e.edit!(m))) && typeof created === 'string' && created)
      useEditor.setState(e.focusName ? { selection: [created], focusName: created, help: null } : { selection: [created] })
    return
  }
  switch (e.command) {
    case 'rename':
      return renameElement(id)
    case 'help':
      return s.openHelp(helpCardFor(s.model, id) ?? 'index')
    case 'group':
      return groupSelection()
    case 'ungroup':
      return ungroupSelection()
    case 'open-page':
      return s.openPage(id)
    case 'layout':
      return void layoutNow()
    case 'check':
      return s.setCheckOpen(true)
    case 'copy':
      return void copySelection()
    case 'cut':
      return void cutSelection()
    case 'duplicate':
      return void duplicateSelection()
    case 'paste':
      return void pasteClipboard(state.at)
    case 'connect':
      return useEditor.setState({ linkFrom: id, tool: { id: 'select' }, error: null, message: 'Message flow: click the shape to send it to (the empty canvas cancels).' })
  }
}

const isEntry = (it: MenuItem): it is MenuEntry => it !== 'sep'

/**
 * One list: the root at a screen point, a submenu next to its entry. Each list keeps the focus on one
 * entry; Right / Enter opens a submenu, Left / Esc closes it (Esc on the root closes the menu).
 */
function MenuList({ items, at, level, onPick, onBack }: { items: MenuItem[]; at?: { x: number; y: number }; level: number; onPick: (e: MenuEntry) => void; onBack: () => void }) {
  const list = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [pos, setPos] = useState<React.CSSProperties>(at ? { left: at.x, top: at.y, visibility: 'hidden' } : { left: '100%', top: -5, visibility: 'hidden' })

  // Keep it inside the window: the root moves left / up, a submenu opens on the left / moves up.
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const W = window.innerWidth
    const H = window.innerHeight
    if (at) setPos({ left: Math.max(4, Math.min(at.x, W - r.width - 4)), top: Math.max(4, Math.min(at.y, H - r.height - 4)) })
    else {
      const parent = el.parentElement!.getBoundingClientRect()
      const left = parent.right + r.width > W - 4 ? { right: '100%' } : { left: '100%' }
      setPos({ ...left, top: Math.min(-5, H - 4 - parent.top - r.height) })
    }
  }, [])
  // Once placed and visible, the first entry takes the focus, so the arrows work at once (in a submenu too).
  const placed = pos.visibility !== 'hidden'
  useEffect(() => {
    if (placed) focusAt(0)
  }, [placed])

  const enabled = items.map((it, i) => (isEntry(it) ? i : -1)).filter((i) => i >= 0)
  const focusAt = (k: number) => buttons.current[enabled[(k + enabled.length) % enabled.length]]?.focus()
  const current = () => enabled.indexOf(buttons.current.findIndex((b) => b === document.activeElement))

  const onKey = (e: React.KeyboardEvent) => {
    // The menu's keys stay in the menu: Esc must not also clear the selection, Del not delete.
    e.stopPropagation()
    const k = current()
    const it = k >= 0 ? (items[enabled[k]] as MenuEntry) : undefined
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        return focusAt(k + 1)
      case 'ArrowUp':
        e.preventDefault()
        return focusAt(k < 0 ? -1 : k - 1)
      case 'Home':
        e.preventDefault()
        return focusAt(0)
      case 'End':
        e.preventDefault()
        return focusAt(-1)
      case 'ArrowRight':
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (it?.items) setOpen(enabled[k])
        else if (it && e.key !== 'ArrowRight') onPick(it)
        return
      case 'ArrowLeft':
      case 'Escape':
        e.preventDefault()
        if (level > 0 || e.key === 'Escape') onBack()
        return
      case 'Tab':
        e.preventDefault()
        return focusAt(k + (e.shiftKey ? -1 : 1))
    }
  }

  return (
    <div ref={list} className="ctx-menu" role="menu" style={pos} onKeyDown={onKey}>
      {items.map((it, i) =>
        it === 'sep' ? (
          <hr key={i} />
        ) : (
          <div key={it.id} className="ctx-item">
            <button
              ref={(b) => void (buttons.current[i] = b)}
              role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={it.checked}
              aria-haspopup={it.items ? 'menu' : undefined}
              aria-expanded={it.items ? open === i : undefined}
              className={`${it.danger ? 'is-danger' : ''}${open === i ? ' is-open' : ''}`}
              title={it.title}
              data-testid={`cm-${it.id}`}
              onPointerEnter={() => setOpen(it.items ? i : null)}
              onClick={() => (it.items ? setOpen(i) : onPick(it))}
            >
              <span className="menu-icon">{it.checked && <Check size={14} />}</span>
              <span>{it.label}</span>
              {it.keys && <kbd>{it.keys}</kbd>}
              {it.items && <ChevronRight size={14} className="ctx-more" />}
            </button>
            {open === i && it.items && (
              <MenuList
                items={it.items}
                level={level + 1}
                onPick={onPick}
                onBack={() => {
                  setOpen(null)
                  buttons.current[i]?.focus()
                }}
              />
            )}
          </div>
        ),
      )}
    </div>
  )
}
