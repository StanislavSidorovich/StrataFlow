// The editor. Top bar (files, example, theme), the canvas with its draw bar, and Properties.
import { useEffect, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { BookOpen, FileDown, LayoutDashboard, FilePlus2, FolderOpen, Moon, Save, Sun, TriangleAlert, X } from 'lucide-react'
import { emptyModel } from '../core/metamodel'
import { deleteElements } from '../core/ops'
import { parseModel } from '../core/serialize'
import { Canvas } from './canvas/Canvas'
import { TOOLS } from './canvas/Palette'
import { exportBpmn, layoutModel, openText, saveModel, saveModelAs } from './files'
import { Properties } from './panels/Properties'
import { hadStoredModel, useEditor } from './store'
import example from '../data/examples/library-loan.flow.json?raw'

// First visit: the example, so the canvas is not empty; later visits: what was there before.
if (!hadStoredModel) useEditor.setState({ model: parseModel(example) })

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

export function App() {
  const doc = useEditor((s) => s.doc)
  const name = useEditor((s) => s.model.name)
  const error = useEditor((s) => s.error)
  const message = useEditor((s) => s.message)
  const savedAt = useEditor((s) => s.savedAt)
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => useEditor.getState().say(null), 8000)
    return () => clearTimeout(t)
  }, [message])

  const save = async (as: boolean) => {
    try {
      const note = await (as ? saveModelAs() : saveModel())
      if (note) useEditor.getState().say(note)
    } catch (e) {
      useEditor.getState().showError(`Not saved: ${(e as Error).message}`)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 's') {
        e.preventDefault()
        void save(e.shiftKey)
        return
      }
      // In a text field the browser's own undo and keys apply.
      if (typing(e.target)) return
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        s.redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection.length) {
        e.preventDefault()
        s.apply((m) => deleteElements(m, s.selection))
      } else if (e.key === 'Escape') {
        s.setTool({ id: 'select' })
        s.select([])
      } else if (!mod && !e.altKey) {
        const t = TOOLS.find((x) => x.key.toLowerCase() === key)
        if (t) s.setTool(t.tool)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="./icon.svg" alt="" width={22} height={22} />
          <strong>StrataFlow</strong>
          <span className="stage-pill">preview</span>
        </div>
        <button className="btn" onClick={() => useEditor.getState().load(emptyModel())} title="Start an empty process (Undo brings the last one back)" data-testid="new">
          <FilePlus2 size={15} /> New
        </button>
        <button className="btn" onClick={() => input.current?.click()} title="Open a .flow.json file, or a .bpmn file (for example one exported from Bizagi Modeler)" data-testid="open">
          <FolderOpen size={15} /> Open
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,.bpmn,.xml"
          hidden
          data-testid="open-input"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) await openText(await f.text(), f.name)
            e.target.value = ''
          }}
        />
        <button className="btn" onClick={() => save(false)} title="Save as a .flow.json file (Ctrl+S)" data-testid="save">
          <Save size={15} /> Save
        </button>
        <button className="btn" onClick={() => save(true)} title="Choose where to save (Ctrl+Shift+S)">
          Save as
        </button>
        <button
          className="btn"
          onClick={async () => {
            try {
              useEditor.getState().say(await exportBpmn())
            } catch (e) {
              useEditor.getState().showError(`Not exported: ${(e as Error).message}`)
            }
          }}
          title="Export as BPMN 2.0 XML (.bpmn) for Bizagi Modeler, bpmn.io and other BPMN tools"
          data-testid="export-bpmn"
        >
          <FileDown size={15} /> Export BPMN
        </button>
        <button
          className="btn"
          onClick={async () => {
            try {
              useEditor.getState().say(await layoutModel())
            } catch (e) {
              useEditor.getState().showError(`Not laid out: ${(e as Error).message}`)
            }
          }}
          title="Auto layout: steps left to right, each in its own lane (Undo puts everything back)"
          data-testid="auto-layout"
        >
          <LayoutDashboard size={15} /> Auto layout
        </button>
        <button
          className="btn"
          onClick={() => {
            useEditor.getState().load(parseModel(example))
            useEditor.getState().say('Opened the example: a library lends a book. Undo brings your process back.')
          }}
          title="Open the example process"
          data-testid="example"
        >
          <BookOpen size={15} /> Example
        </button>
        <div className="topbar-file" title={name}>
          {name || 'Untitled process'}
          <span className="muted">{savedAt ? ' · kept in this browser' : ''}</span>
        </div>
        <button className="btn icon" onClick={() => setDark((d) => !d)} title={dark ? 'Light theme' : 'Dark theme'} aria-label="Toggle theme">
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>
      {(error || message) && (
        <div className={`notice${error ? ' is-error' : ''}`} role="status" data-testid="notice">
          {error && <TriangleAlert size={14} />}
          <span>{error || message}</span>
          <button className="notice-close" aria-label="Close" onClick={() => useEditor.setState({ error: null, message: null })}>
            <X size={14} />
          </button>
        </div>
      )}
      <main className="main">
        <ReactFlowProvider key={doc}>
          <Canvas />
        </ReactFlowProvider>
        <Properties />
      </main>
      <footer className="statusbar">
        Preview: draw, save and reopen BPMN processes; opens Bizagi .bpmn exports and exports BPMN 2.0 XML. One-click auto layout. The model check comes next. Unofficial student project.
      </footer>
    </div>
  )
}
