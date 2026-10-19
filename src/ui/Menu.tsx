// A drop-down menu for the top bar (File, Help). Closes on a pick, a click outside or Escape.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface MenuItem {
  label: string
  icon?: React.ReactNode
  /** Keyboard shortcut shown on the right. */
  keys?: string
  title?: string
  testid?: string
  onPick: () => void
}

export function Menu({ label, icon, items, testid }: { label: string; icon?: React.ReactNode; items: (MenuItem | 'sep')[]; testid?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation() // Escape closes the menu only, it does not also clear the selection
      setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="menu" ref={box}>
      <button className={`btn${open ? ' is-open' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} data-testid={testid}>
        {icon} {label && <span className="menu-label">{label}</span>} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((it, i) =>
            it === 'sep' ? (
              <hr key={i} />
            ) : (
              <button
                key={i}
                role="menuitem"
                title={it.title}
                data-testid={it.testid}
                onClick={() => {
                  setOpen(false)
                  it.onPick()
                }}
              >
                <span className="menu-icon">{it.icon}</span>
                <span>{it.label}</span>
                {it.keys && <kbd>{it.keys}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
