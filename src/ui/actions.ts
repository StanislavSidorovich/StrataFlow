// Actions shared by the top bar, Properties, the context menu and the keys: group into / ungroup sub-process
// (Ctrl+G, Ctrl+Shift+G), rename (F2), auto layout, copy / cut / paste / duplicate (Ctrl+C, X, V, D).
import type { Point } from '../core/metamodel'
import { copyElements, deleteElements, groupIntoSubprocess, NeedsGatewaysError, nodeOf, pasteClip, pasteOffset, setCollapsed, ungroupSubprocess, type Clip } from '../core/ops'
import { layoutModel } from './files'
import { useEditor } from './store'

// The clipboard is the app's own (not the system one): kept in memory and in the browser, so a copy
// pastes into another tab of the app and into another browser tab of it too.
export const CLIP_KEY = 'strataflow.clipboard'
let clipText: string | null = null
/** How many times the clip on the clipboard has been pasted: each paste lands one step further. */
let pastes = 0

function readClip(): Clip | null {
  try {
    const stored = globalThis.localStorage?.getItem(CLIP_KEY)
    if (stored && stored !== clipText) {
      clipText = stored
      pastes = 1
    }
  } catch {
    /* private mode: the copy in memory serves this tab */
  }
  try {
    return clipText ? (JSON.parse(clipText) as Clip) : null
  } catch {
    return null
  }
}

function keepClip(clip: Clip, pasted: number) {
  clipText = JSON.stringify(clip)
  pastes = pasted
  try {
    localStorage.setItem(CLIP_KEY, clipText)
  } catch {
    /* private mode or full: the copy stays in memory */
  }
}

export const canPaste = () => readClip() !== null

/** Copies the selected shapes and the flows between them. False when nothing in the selection can be copied. */
export function copySelection(): boolean {
  const { model, selection } = useEditor.getState()
  const clip = copyElements(model, selection)
  if (!clip) return false
  keepClip(clip, 1)
  return true
}

/** Copy, then delete (one undo step); the first paste puts them back where they were. */
export function cutSelection(): boolean {
  const { model, selection, apply } = useEditor.getState()
  const clip = copyElements(model, selection)
  if (!clip) return false
  keepClip(clip, 0)
  apply((m) => deleteElements(m, selection))
  return true
}

/** Pastes the clipboard: shifted from where it was copied (keeping the lane when it fits), or centred on `at`. */
export function pasteClipboard(at?: Point): boolean {
  const clip = readClip()
  if (!clip) return false
  const { page, apply } = useEditor.getState()
  let ids: string[] = []
  const ok = apply((m) => void (ids = pasteClip(m, clip, at ? { at, page: page ?? undefined } : { offset: pasteOffset(m, clip, pastes), page: page ?? undefined })))
  if (!ok) return true
  if (!at) pastes++
  useEditor.setState({ selection: ids })
  return true
}

/** A copy of the selection next to it, without touching the clipboard. */
export function duplicateSelection(): boolean {
  const { model, selection, page, apply } = useEditor.getState()
  const clip = copyElements(model, selection)
  if (!clip) return false
  let ids: string[] = []
  if (apply((m) => void (ids = pasteClip(m, clip, { offset: pasteOffset(m, clip), page: page ?? undefined })))) useEditor.setState({ selection: ids })
  return true
}

export function groupSelection() {
  const { apply, selection, model } = useEditor.getState()
  let id: string | null = null
  try {
    // A dry run on a copy: several ways in or out need the user's yes before gateways are added.
    groupIntoSubprocess(structuredClone(model), selection)
  } catch (e) {
    if (e instanceof NeedsGatewaysError) {
      if (!confirm(`${e.message}\n\nOK adds exclusive gateways (change them to parallel if the paths run at the same time). Cancel leaves the process as it is.`)) return
      if (apply((m) => void (id = group(m, selection, true))) && id) done(id)
      return
    }
  }
  if (apply((m) => void (id = group(m, selection, false))) && id) done(id)
}

/** As in Bizagi: the new sub-process is collapsed, its steps on a page of their own (double-click opens it). */
function group(m: Parameters<typeof groupIntoSubprocess>[0], ids: string[], gateways: boolean): string {
  const id = groupIntoSubprocess(m, ids, { gateways }).id
  setCollapsed(m, id, true)
  return id
}

function done(id: string) {
  useEditor.setState({ selection: [id], focusName: id })
  useEditor.getState().say('Grouped into a sub-process: name it. Double-click it to see its steps; Ungroup (Ctrl+Shift+G) or Undo puts them back.')
}

export function ungroupSelection() {
  const { apply, selection, model } = useEditor.getState()
  const sp = selection.length === 1 ? nodeOf(model, selection[0]) : undefined
  if (sp?.type !== 'subProcess') return void useEditor.getState().showError('Select one sub-process to ungroup')
  const kids = model.nodes.filter((n) => n.parentId === sp.id).map((n) => n.id)
  if (apply((m) => ungroupSubprocess(m, sp.id))) useEditor.getState().select(kids.filter((k) => nodeOf(useEditor.getState().model, k)))
}

/** Can the selection be grouped: at least one step that is not a pool, lane, flow or artifact. */
export function canGroup(ids: string[]) {
  const m = useEditor.getState().model
  return ids.some((id) => {
    const n = nodeOf(m, id)
    return n && !['dataObject', 'dataStore', 'annotation'].includes(n.type)
  })
}

/** Selects the element and puts the cursor in its name field (Properties). */
export function renameElement(id: string) {
  useEditor.setState({ selection: [id], focusName: id, help: null })
}

export async function layoutNow() {
  try {
    useEditor.getState().say(await layoutModel())
  } catch (e) {
    useEditor.getState().showError(`Not laid out: ${(e as Error).message}`)
  }
}
