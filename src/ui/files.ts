// Files: save the model as `*.flow.json`, open a `*.flow.json` or a BPMN 2.0 XML file (Bizagi export),
// export BPMN 2.0 XML for Bizagi Modeler and bpmn.io.
// Same pattern as StrataSQL's fileSave.ts: "Save as" picks the folder and name (Chrome, Edge), after which
// "Save" writes to that file until another document is loaded; other browsers download the file.
import { isCaseFile } from '../data/caseFile'
import { parseModel, serializeModel, FILE_EXTENSION } from '../core/serialize'
import { openProcess } from './docs'
import { useEditor } from './store'
import { useTrainer } from './trainer/trainerStore'

export interface WritableFile {
  name: string
  createWritable: () => Promise<{ write: (data: string | Blob) => Promise<void>; close: () => Promise<void> }>
}
type SavePicker = (opts: object) => Promise<WritableFile>

const picker = (): SavePicker | undefined => (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker

/** The file chosen with "Save as", and the document it belongs to. */
let current: { file: WritableFile; doc: number } | null = null

export type SavedFile = WritableFile

/** The "Save as" file of the process on the canvas (null if none): taken when its tab is parked. */
export function takeSavedFile(): SavedFile | null {
  return current && current.doc === useEditor.getState().doc ? current.file : null
}

/** Gives the process now on the canvas its "Save as" file back (or none). */
export function setSavedFile(file: SavedFile | null) {
  current = file ? { file, doc: useEditor.getState().doc } : null
}

export function fileBaseName(name: string): string {
  return (name.trim() || 'process').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').toLowerCase()
}

function downloadText(name: string, text: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function download(): string {
  const { model } = useEditor.getState()
  const name = `${fileBaseName(model.name)}${FILE_EXTENSION}`
  downloadText(name, serializeModel(model), 'application/json')
  return name
}

/** Export: BPMN 2.0 XML with the diagram, as a download (the writer loads on first use). */
export async function exportBpmn(): Promise<string> {
  const { writeBpmn } = await import('../core/bpmn/write')
  const { model } = useEditor.getState()
  const name = `${fileBaseName(model.name)}.bpmn`
  downloadText(name, await writeBpmn(model), 'application/xml')
  return `Exported ${name}: BPMN 2.0 XML. In Bizagi Modeler use Import, BPMN; bpmn.io opens it directly.`
}

const IMAGE_KINDS = {
  png: { description: 'PNG image', accept: { 'image/png': ['.png'] } },
  svg: { description: 'SVG image', accept: { 'image/svg+xml': ['.svg'] } },
}

/**
 * Save a generated file: the dialog opens first (Chrome, Edge) and the content is made after it, since a slow
 * image would otherwise lose the click the browser requires. Others download. Returns the name, or null if cancelled.
 */
export async function saveExport(name: string, kind: keyof typeof IMAGE_KINDS, make: () => Promise<Blob>): Promise<string | null> {
  const show = picker()
  if (!show) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await make())
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    return name
  }
  let file: WritableFile
  try {
    file = await show({ suggestedName: name, types: [IMAGE_KINDS[kind]] })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null
    throw e
  }
  const out = await file.createWritable()
  await out.write(await make())
  await out.close()
  return file.name
}

async function write(file: WritableFile) {
  const out = await file.createWritable()
  await out.write(serializeModel(useEditor.getState().model))
  await out.close()
}

/** Save: to this document's "Save as" file if there is one, else a download. Returns a note for the user. */
export async function saveModel(): Promise<string> {
  const { doc } = useEditor.getState()
  if (current && current.doc === doc) {
    await write(current.file)
    return `Saved to ${current.file.name}`
  }
  const name = download()
  return picker() ? `Downloaded ${name}. Save as picks a folder; Ctrl+S then saves there.` : `Downloaded ${name}`
}

/** Save as: pick a folder and a name. Returns a note for the user, or null when cancelled. */
export async function saveModelAs(): Promise<string | null> {
  const show = picker()
  if (!show) return `Saved as ${download()} in your downloads folder (to choose the folder, use Chrome or Edge).`
  const { model, doc } = useEditor.getState()
  let file: WritableFile
  try {
    file = await show({
      suggestedName: `${fileBaseName(model.name)}${FILE_EXTENSION}`,
      types: [{ description: 'Quaera Flow process', accept: { 'application/json': ['.json'] } }],
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null
    throw e
  }
  await write(file)
  current = { file, doc }
  return `Saved to ${file.name}. Ctrl+S now saves to this file.`
}

/** Opens a file by its content: JSON is our model, XML is BPMN (the reader loads on first use). */
export async function openText(text: string, fileName: string): Promise<void> {
  const { showError, say } = useEditor.getState()
  try {
    if (text.trimStart().startsWith('<')) {
      const { readBpmn } = await import('../core/bpmn/read')
      const { model, warnings } = await readBpmn(text)
      if (!model.name) model.name = fileName.replace(/\.(bpmn|xml)$/i, '')
      openProcess(model)
      say(warnings.length ? `Opened ${fileName}. Not shown yet: ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? '…' : ''}` : `Opened ${fileName}`)
    } else if (isCaseFile(text)) {
      // A case file joins the trainer and starts its walkthrough; the user's own model waits meanwhile.
      const c = useTrainer.getState().openCaseFile(text)
      say(`Opened the case “${c.title}”: watch it built, then try its levels. Leave task brings your own process back.`)
    } else {
      openProcess(parseModel(text))
      say(`Opened ${fileName}`)
    }
  } catch (e) {
    showError(`${fileName} could not be opened: ${(e as Error).message}`)
  }
}

/** Auto layout: planned off the store (elkjs is async and loads on first use), applied as one undo step. */
export async function layoutModel(): Promise<string | null> {
  const before = useEditor.getState().model
  const { planLayout, applyLayout } = await import('../core/layout')
  const plan = await planLayout(before)
  // An edit made while elkjs worked wins: the plan was for the old drawing.
  if (useEditor.getState().model !== before) return null
  useEditor.getState().apply((m) => applyLayout(m, plan))
  useEditor.setState((s) => ({ fit: s.fit + 1 }))
  return 'Laid out left to right, lanes kept. Undo puts everything back.'
}
