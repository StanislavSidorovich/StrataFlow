// Actions shared by the top bar, Properties, the context menu and the keys: group into / ungroup sub-process
// (Ctrl+G, Ctrl+Shift+G), rename (F2), auto layout.
import { groupIntoSubprocess, NeedsGatewaysError, nodeOf, setCollapsed, ungroupSubprocess } from '../core/ops'
import { layoutModel } from './files'
import { useEditor } from './store'

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
