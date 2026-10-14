// Stage 0: a read-only viewer that proves the two spikes, BPMN shapes on React Flow (D1)
// and BPMN XML from Bizagi parsed with bpmn-moddle (D2). The editor arrives in stage 1.
import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Moon, Sun, TriangleAlert } from 'lucide-react'
import { readBpmn } from '../core/bpmn/read'
import type { FlowModel } from '../core/metamodel'
import { Canvas } from './canvas/Canvas'
import sample from '../data/examples/library-loan.bpmn?raw'

export function App() {
  const [model, setModel] = useState<FlowModel | null>(null)
  const [fileName, setFileName] = useState('library-loan.bpmn')
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState('')
  // A new document remounts the canvas so it fits the view again.
  const [doc, setDoc] = useState(0)
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  useEffect(() => void open(sample, 'library-loan.bpmn'), [])

  async function open(xml: string, name: string) {
    try {
      const r = await readBpmn(xml)
      setModel(r.model)
      setDoc((d) => d + 1)
      setWarnings(r.warnings)
      setFileName(name)
      setError('')
    } catch (e) {
      setError(`${name} is not a BPMN 2.0 XML file the reader understands: ${(e as Error).message}`)
    }
  }

  const counts = model && {
    pools: model.participants.length,
    lanes: model.lanes.length,
    elements: model.nodes.length,
    flows: model.flows.length,
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="./icon.svg" alt="" width={22} height={22} />
          <strong>StrataFlow</strong>
          <span className="stage-pill">preview</span>
        </div>
        <button className="btn" onClick={() => input.current?.click()} title="Open a .bpmn file, for example one exported from Bizagi Modeler">
          <FolderOpen size={15} /> Open .bpmn
        </button>
        <input
          ref={input}
          type="file"
          accept=".bpmn,.xml"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) await open(await f.text(), f.name)
            e.target.value = ''
          }}
        />
        <div className="topbar-file" title={fileName}>
          {model?.name || fileName}
          {counts && (
            <span className="muted">
              {' '}
              · {counts.pools} pools · {counts.lanes} lanes · {counts.elements} elements · {counts.flows} flows
            </span>
          )}
        </div>
        <button className="btn icon" onClick={() => setDark((d) => !d)} title={dark ? 'Light theme' : 'Dark theme'} aria-label="Toggle theme">
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>
      {(error || warnings.length > 0) && (
        <div className="notice" role="status">
          <TriangleAlert size={14} />
          {error || `${warnings.length} part(s) not shown yet: ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? '…' : ''}`}
        </div>
      )}
      <main className="main">{model && <Canvas key={doc} model={model} />}</main>
      <footer className="statusbar">
        Stage 0 preview: opens BPMN 2.0 files (Bizagi exports included) and shows them; shapes can be moved. The editor comes in stage 1. Unofficial student project.
      </footer>
    </div>
  )
}
