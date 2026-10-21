// Several processes open at once. The editor store (store.ts) still holds exactly one process, the active
// one, so every edit, check and export works as before. The other open processes are parked here with their
// own undo history, selection and page; switching parks the active one and brings the chosen one back.
// The active process is kept in the browser by the editor's autosave, the parked ones under DOCS_KEY.
import { create } from 'zustand'
import { emptyModel, type FlowModel } from '../core/metamodel'
import { ModelFormatError, parseModel, serializeModel } from '../core/serialize'
import { takeSavedFile, setSavedFile, type SavedFile } from './files'
import { useEditor } from './store'

export const DOCS_KEY = 'strataflow.docs'
export const MAX_TABS = 12
const CLOSED_KEPT = 5

/** A process that is not on the canvas: its model and everything that belongs to it. */
export interface Parked {
  model: FlowModel
  past: FlowModel[]
  future: FlowModel[]
  page: string | null
  /** The file chosen with "Save as" for this process, if any. */
  file: SavedFile | null
}

export interface Tab {
  id: string
}

interface DocsState {
  tabs: Tab[]
  active: string
  /** The open processes that are not on the canvas, by tab id. */
  parked: Record<string, Parked>
  /** Recently closed processes, newest last: File → Reopen closed process. */
  closed: Parked[]
}

export const hasContent = (m: FlowModel) => m.nodes.length + m.participants.length > 0

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

function stored(): { tabs: Tab[]; active: string; parked: Record<string, Parked> } {
  const none = { tabs: [{ id: 't0' }], active: 't0', parked: {} }
  try {
    const raw = globalThis.localStorage?.getItem(DOCS_KEY)
    if (!raw) return none
    const data = JSON.parse(raw) as { tabs: string[]; active: string; parked: Record<string, string> }
    if (!Array.isArray(data.tabs) || !data.tabs.includes(data.active)) return none
    const parked: Record<string, Parked> = {}
    const tabs: Tab[] = []
    for (const id of data.tabs) {
      if (id === data.active) {
        tabs.push({ id })
      } else if (typeof data.parked?.[id] === 'string') {
        parked[id] = { model: parseModel(data.parked[id]), past: [], future: [], page: null, file: null }
        tabs.push({ id })
      }
    }
    return { tabs, active: data.active, parked }
  } catch (e) {
    if (!(e instanceof ModelFormatError)) console.warn('Ignoring stored tabs:', e)
    return none
  }
}

export const useDocs = create<DocsState>()(() => ({ ...stored(), closed: [] }))

/** Takes the active process off the canvas. */
function park(): Parked {
  const { model, past, future, page } = useEditor.getState()
  return { model, past, future, page, file: takeSavedFile() }
}

/** Puts a process on the canvas as the active one (a new document for the canvas, so the view fits again). */
function show(p: Parked) {
  useEditor.setState((s) => ({
    model: p.model,
    past: p.past,
    future: p.future,
    page: p.page,
    doc: s.doc + 1,
    selection: [],
    tool: { id: 'select' },
    linkFrom: null,
    menu: null,
    focusName: null,
    lastEdit: null,
    error: null,
  }))
  setSavedFile(p.file)
}

/** A task of the trainer has the canvas: the tabs wait until it ends (the user's own process is its backup). */
const inTask = () => useEditor.getState().backup !== null

/** Opens a process in a new tab; an empty untouched tab is reused. During a trainer task it ends the task, as before. */
export function openProcess(model: FlowModel): boolean {
  const ed = useEditor.getState()
  if (ed.backup || (!hasContent(ed.model) && ed.past.length === 0)) {
    ed.load(model)
    return true
  }
  if (useDocs.getState().tabs.length >= MAX_TABS) {
    ed.say(`${MAX_TABS} processes are open: close one first.`)
    return false
  }
  addTab({ model, past: [], future: [], page: null, file: null })
  return true
}

function addTab(next: Parked) {
  const { tabs, active, parked } = useDocs.getState()
  const id = newId()
  const at = tabs.findIndex((t) => t.id === active) + 1
  useDocs.setState({ tabs: [...tabs.slice(0, at), { id }, ...tabs.slice(at)], active: id, parked: { ...parked, [active]: park() } })
  show(next)
}

export function newProcess(): boolean {
  return openProcess(emptyModel())
}

export function switchTo(id: string) {
  const { active, parked } = useDocs.getState()
  const target = parked[id]
  if (id === active || !target || inTask()) return
  const { [id]: _taken, ...rest } = parked
  useDocs.setState({ active: id, parked: { ...rest, [active]: park() } })
  show(target)
}

/** Closes a tab. The last one left becomes an empty process (Undo brings the closed one back). */
export function closeTab(id: string) {
  const { tabs, active, parked, closed } = useDocs.getState()
  if (inTask()) return
  if (tabs.length === 1) {
    useEditor.getState().load(emptyModel())
    return
  }
  const i = tabs.findIndex((t) => t.id === id)
  if (i < 0) return
  const rest = tabs.filter((t) => t.id !== id)
  if (id !== active) {
    const { [id]: gone, ...others } = parked
    useDocs.setState({ tabs: rest, parked: others, closed: [...closed, gone].slice(-CLOSED_KEPT) })
    return
  }
  const nextId = (rest[i] ?? rest[i - 1]).id
  const { [nextId]: next, ...others } = parked
  useDocs.setState({ tabs: rest, active: nextId, parked: others, closed: [...closed, park()].slice(-CLOSED_KEPT) })
  show(next)
}

export function reopenClosed(): boolean {
  const { closed } = useDocs.getState()
  const last = closed.at(-1)
  if (!last || inTask()) return false
  const ed = useEditor.getState()
  if (useDocs.getState().tabs.length >= MAX_TABS) {
    ed.say(`${MAX_TABS} processes are open: close one first.`)
    return false
  }
  useDocs.setState({ closed: closed.slice(0, -1) })
  addTab(last)
  return true
}

// ---------------------------------------------------------------- the parked processes in the browser

function saveDocs() {
  try {
    const { tabs, active, parked } = useDocs.getState()
    if (tabs.length === 1) {
      localStorage.removeItem(DOCS_KEY)
      return
    }
    const models: Record<string, string> = {}
    for (const [id, p] of Object.entries(parked)) models[id] = serializeModel(p.model)
    localStorage.setItem(DOCS_KEY, JSON.stringify({ tabs: tabs.map((t) => t.id), active, parked: models }))
  } catch {
    // Storage full or unavailable: the open process is still saved by the editor, and Save keeps a file.
  }
}

useDocs.subscribe((s, prev) => {
  if (typeof localStorage === 'undefined') return
  if (s.tabs !== prev.tabs || s.active !== prev.active || s.parked !== prev.parked) saveDocs()
})
