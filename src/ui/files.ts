// Files: save the model as `*.flow.json`, open a `*.flow.json` or a BPMN 2.0 XML file (Bizagi export).
// Same pattern as StrataSQL's fileSave.ts: "Save as" picks the folder and name (Chrome, Edge), after which
// "Save" writes to that file until another document is loaded; other browsers download the file.
import { parseModel, serializeModel, FILE_EXTENSION } from '../core/serialize'
import { useEditor } from './store'

interface WritableFile {
  name: string
  createWritable: () => Promise<{ write: (data: string | Blob) => Promise<void>; close: () => Promise<void> }>
}
type SavePicker = (opts: object) => Promise<WritableFile>

const picker = (): SavePicker | undefined => (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker

/** The file chosen with "Save as", and the document it belongs to. */
let current: { file: WritableFile; doc: number } | null = null

export function fileBaseName(name: string): string {
  return (name.trim() || 'process').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').toLowerCase()
}

function download(): string {
  const { model } = useEditor.getState()
  const name = `${fileBaseName(model.name)}${FILE_EXTENSION}`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([serializeModel(model)], { type: 'application/json' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  return name
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
      types: [{ description: 'StrataFlow process', accept: { 'application/json': ['.json'] } }],
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
  const { load, showError, say } = useEditor.getState()
  try {
    if (text.trimStart().startsWith('<')) {
      const { readBpmn } = await import('../core/bpmn/read')
      const { model, warnings } = await readBpmn(text)
      if (!model.name) model.name = fileName.replace(/\.(bpmn|xml)$/i, '')
      load(model)
      say(warnings.length ? `Opened ${fileName}. Not shown yet: ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? '…' : ''}` : `Opened ${fileName}`)
    } else {
      load(parseModel(text))
      say(`Opened ${fileName}`)
    }
  } catch (e) {
    showError(`${fileName} could not be opened: ${(e as Error).message}`)
  }
}
