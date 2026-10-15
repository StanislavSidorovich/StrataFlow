// The editor's state: the model with undo/redo history, the selection and the active drawing tool.
// Same pattern as StrataSQL's store: every edit is an op from core/ops run on an immer draft.
import { produce } from 'immer'
import { create } from 'zustand'
import type { FlowModel, Point } from '../core/metamodel'
import { ModelError, type NodeSpec } from '../core/ops'
import { ModelFormatError, parseModel, serializeModel } from '../core/serialize'

const HISTORY_LIMIT = 200
const COALESCE_MS = 1000
const STORAGE_KEY = 'strataflow.model'
/** The trainer's working model; the user's own model stays under STORAGE_KEY meanwhile. */
export const TRAINER_MODEL_KEY = 'strataflow.trainer.model'

/** What a click on the empty canvas does: select (and pan), or place a new element. */
export type Tool = { id: string; spec: NodeSpec } | { id: 'pool' } | { id: 'select' }

/**
 * The open context menu: where on screen, for what (no ids = the empty canvas at `at`, model coordinates),
 * and whether it is the whole right-click menu or only the "change type" entries (the pad's wrench).
 */
export interface ContextMenuState {
  x: number
  y: number
  ids: string[]
  at: Point
  kind: 'full' | 'type'
}

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
  /** The collapsed sub-process whose page the canvas shows (null = the main process). */
  page: string | null
  /** Shows a collapsed sub-process's page (null = back to the main process). */
  openPage: (id: string | null) => void
  /** The help card shown in the right column ('index' = the list of cards, null = Properties). */
  help: string | null
  openHelp: (id: string | null) => void
  /** The Check panel under the canvas is open: issues listed and marked on the shapes. */
  checkOpen: boolean
  setCheckOpen: (open: boolean) => void
  menu: ContextMenuState | null
  /** The user's own model while a trainer task runs on the canvas (null = no task). */
  backup: FlowModel | null
  openMenu: (menu: ContextMenuState | null) => void

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
  page: null,
  help: null,
  checkOpen: false,
  menu: null,
  backup: null,

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
    const { model: current, past, doc, backup } = get()
    // Loading is undoable too: Open by mistake loses nothing. During a trainer task, New / Open end the task:
    // Undo then brings back the user's own model, not the task's.
    set({ model, doc: doc + 1, backup: null, past: backup ? [backup] : [...past, current].slice(-HISTORY_LIMIT), future: [], selection: [], lastEdit: null, error: null, tool: { id: 'select' }, page: null })
  },

  openPage: (page) => set((s) => ({ page, selection: [], tool: { id: 'select' }, fit: s.fit + 1 })),
  openHelp: (help) => set({ help }),
  setCheckOpen: (checkOpen) => set({ checkOpen }),
  openMenu: (menu) => set({ menu }),
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

export function loadStoredModel(key = STORAGE_KEY): FlowModel | null {
  try {
    const text = globalThis.localStorage?.getItem(key)
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
    const { model, backup } = useEditor.getState()
    localStorage.setItem(backup ? TRAINER_MODEL_KEY : STORAGE_KEY, serializeModel(model))
    useEditor.setState({ savedAt: Date.now() })
  } catch {
    // Storage full or unavailable: saving to a file still works.
  }
}
// A page whose sub-process is gone or expanded (an undo, a delete) is left for the main process.
useEditor.subscribe((state) => {
  const p = state.page
  if (p && !state.model.nodes.some((n) => n.id === p && n.type === 'subProcess' && n.collapsed)) useEditor.setState({ page: null })
})
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
