// The open processes as tabs under the top bar. Shown from two processes on; during a trainer task they wait.
import { Plus, X } from 'lucide-react'
import { newProcess, closeTab, switchTo, useDocs } from './docs'
import { useEditor } from './store'

export function Tabs() {
  const tabs = useDocs((s) => s.tabs)
  const active = useDocs((s) => s.active)
  const parked = useDocs((s) => s.parked)
  const liveName = useEditor((s) => s.model.name)
  const locked = useEditor((s) => s.backup !== null)
  if (tabs.length < 2) return null
  return (
    <div className="tabs" role="tablist" aria-label="Open processes" data-testid="tabs">
      {tabs.map((t) => {
        const name = (t.id === active ? liveName : parked[t.id]?.model.name) || 'Untitled process'
        const on = t.id === active
        return (
          <div key={t.id} className={`tab${on ? ' is-active' : ''}`} data-testid="tab">
            <button type="button" role="tab" aria-selected={on} className="tab-name" disabled={locked} onClick={() => switchTo(t.id)} title={name}>
              {name}
            </button>
            <button type="button" className="tab-close" disabled={locked} onClick={() => closeTab(t.id)} aria-label={`Close ${name}`} title="Close (File → Reopen closed process brings it back)">
              <X size={12} aria-hidden />
            </button>
          </div>
        )
      })}
      <button type="button" className="tab-new" disabled={locked} onClick={() => void newProcess()} aria-label="New process" title="A new process in a new tab" data-testid="tab-new">
        <Plus size={14} aria-hidden />
      </button>
      {locked && <span className="tabs-note muted">Trainer task: your processes wait</span>}
    </div>
  )
}
