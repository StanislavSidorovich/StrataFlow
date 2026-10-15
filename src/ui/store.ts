// The editor's state: the model with undo/redo history, the selection and the active drawing tool.
// Same pattern as StrataSQL's store: every edit is an op from core/ops run on an immer draft.
import { produce } from 'immer'
import { create } from 'zustand'
import type { FlowModel } from '../core/metamodel'
import { ModelError, type NodeSpec } from '../core/ops'
import { ModelFormatError, parseModel, serializeModel } from '../core/serialize'

const HISTORY_LIMIT = 200
const COALESCE_MS = 1000
const STORAGE_KEY = 'strataflow.model'

/** What a click on the empty canvas does: select (and pan), or place a new element. */
export type Tool = { id: string; spec: NodeSpec } | { id: 'pool' } | { id: 'select' }

interface ApplyOptions {
  /** Consecutive edits with the same key within 1 s form one undo step (typing in a field). */
  coalesce?: string
}

interface EditorState {
  model: FlowModel
  past: FlowModel[]
  future: FlowModel[]
  /** Ids of selected nodes, pools, lanes and flows. */
  selection: string[]
  tool: Tool
  error: string | null
  /** A short note for the user (saved, opened…), cleared by the next one. */
  message: string | null
  lastEdit: { key: string; at: number } | null
  /** An element whose name field should take the focus (type the name right away). */
  focusName: string | null
  /** Goes up on every load (New, Open, example): the canvas fits the view again, a "Save as" file belongs to one document. */
  doc: number
  /** When autosave last wrote the model to the browser (0 = not in this visit). */
  savedAt: number
  /** Goes up when the whole drawing moved (auto layout): the canvas fits the view again. */
  fit: number

  /** Runs an edit on a draft; on ModelError the model is untouched and the message is shown. */
  apply: (edit: (m: FlowModel) => void, opts?: ApplyOptions) => boolean
  undo: () => void
  redo: () => void
  load: (model: FlowModel) => void
  select: (ids: string[]) => void
  setTool: (tool: Tool) => void
  showError: (message: string | null) => void
  say: (message: string | null) => void
}

export const useEditor = create<EditorState>()((set, get) => ({
  model: loadStoredModel() ?? { format: 'strata-flow', version: 1, name: '', participants: [], lanes: [], nodes: [], flows: [], diagram: { shapes: {}, edges: {} } },
  past: [],
  future: [],
  selection: [],
  tool: { id: 'select' },
  error: null,
  message: null,
  lastEdit: null,
  focusName: null,
  doc: 0,
  savedAt: 0,
  fit: 0,

  apply(edit, opts = {}) {
    const { model, past, lastEdit } = get()
    let next: FlowModel
    try {
      next = produce(model, (draft) => {
        edit(draft) // ops may return the created element; immer must not see it
      })
    } catch (e) {
      if (e instanceof ModelError) {
        set({ error: e.message })
        return false
      }
      throw e
    }
    if (next === model) return true
    const now = Date.now()
    const merge = opts.coalesce !== undefined && lastEdit?.key === opts.coalesce && now - lastEdit.at < COALESCE_MS
    set({
      model: next,
      past: merge ? past : [...past, model].slice(-HISTORY_LIMIT),
      future: [],
      error: null,
      lastEdit: opts.coalesce !== undefined ? { key: opts.coalesce, at: now } : null,
      selection: validSelection(next, get().selection),
    })
    return true
  },

  undo() {
    const { past, model, future, selection } = get()
    const prev = past.at(-1)
    if (!prev) return
    set({ model: prev, past: past.slice(0, -1), future: [model, ...future], lastEdit: null, error: null, selection: validSelection(prev, selection) })
  },

  redo() {
    const { past, model, future, selection } = get()
    const next = future[0]
    if (!next) return
    set({ model: next, past: [...past, model], future: future.slice(1), lastEdit: null, error: null, selection: validSelection(next, selection) })
  },

  load(model) {
    const { model: current, past, doc } = get()
    // Loading is undoable too: Open by mistake loses nothing.
    set({ model, doc: doc + 1, past: [...past, current].slice(-HISTORY_LIMIT), future: [], selection: [], lastEdit: null, error: null, tool: { id: 'select' } })
  },

  select: (selection) => set((s) => (same(s.selection, selection) ? s : { selection })),
  setTool: (tool) => set({ tool }),
  showError: (error) => set({ error }),
  say: (message) => set({ message }),
}))

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

function validSelection(m: FlowModel, ids: string[]): string[] {
  const all = new Set([...m.nodes, ...m.participants, ...m.lanes, ...m.flows].map((x) => x.id))
  const kept = ids.filter((id) => all.has(id))
  return kept.length === ids.length ? ids : kept
}

// ---------------------------------------------------------------- autosave (localStorage)

export function loadStoredModel(): FlowModel | null {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY)
    return text ? parseModel(text) : null
  } catch (e) {
    if (e instanceof ModelFormatError) console.warn('Ignoring stored model:', e.message)
    return null
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function saveNow() {
  clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    localStorage.setItem(STORAGE_KEY, serializeModel(useEditor.getState().model))
    useEditor.setState({ savedAt: Date.now() })
  } catch {
    // Storage full or unavailable: saving to a file still works.
  }
}
useEditor.subscribe((state, prev) => {
  if (state.model === prev.model || typeof localStorage === 'undefined') return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 300)
})
// Closing the tab within the 300 ms window must not lose the last edit.
if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => {
    if (saveTimer !== undefined) saveNow()
  })

/** Was anything stored in this browser before this visit? */
export const hadStoredModel = loadStoredModel() !== null
