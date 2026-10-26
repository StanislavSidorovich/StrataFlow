// Files: save the model as `*.flow.json`, open a `*.flow.json` or a BPMN 2.0 XML file (Bizagi export),
// export BPMN 2.0 XML for Bizagi Modeler and bpmn.io.
// Same pattern as StrataSQL's fileSave.ts: "Save as" picks the folder and name (Chrome, Edge), after which
// "Save" writes to that file until another document is loaded; other browsers download the file.
import { isCaseFile } from '../data/caseFile'
import { lintModel } from '../core/lint'
import type { FlowModel } from '../core/metamodel'
import { parseModel, serializeModel, FILE_EXTENSION } from '../core/serialize'
import { openProcess, useDocs } from './docs'
import { deleteHandle, getHandle, handleTabs, putHandle } from './fileStore'
import { PREPARE_TIMEOUT_MS, slowMessage, withTimeout, writePrepared, type PreparedWritable } from './safeWrite'
import { useEditor } from './store'
import { useTrainer } from './trainer/trainerStore'

export interface WritableFile {
  name: string
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>
  createWritable: () => Promise<PreparedWritable>
  remove?: () => Promise<void>
}
type SavePicker = (opts: object) => Promise<WritableFile>

const picker = (): SavePicker | undefined => (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker

/** The file chosen with "Save as", and the document it belongs to. */
let current: { file: WritableFile; doc: number } | null = null

export type SavedFile = WritableFile

// After a reload the "Save as" files come back from IndexedDB (fileStore.ts). A tab's stored file belongs to
// its document only until another document is loaded into the tab, so the tab leaves `restorable` then.
const restorable = new Set<string>()
const ready = handleTabs().then((ids) => ids.forEach((id) => restorable.add(id)))
let switching = false

/** Runs a change of the canvas that only swaps the open tabs (their files stay with them). */
export function swappingTabs(f: () => void) {
  switching = true
  try {
    f()
  } finally {
    switching = false
  }
}

useEditor.subscribe((s, prev) => {
  if (s.doc === prev.doc || switching) return
  const tab = useDocs.getState().active
  restorable.delete(tab)
  void deleteHandle(tab)
})

function remember(file: WritableFile) {
  const tab = useDocs.getState().active
  restorable.add(tab)
  void putHandle(tab, file)
}

/** The stored file of the active tab, if the browser still lets this page write to it (asks once per visit). */
async function restoreFile(): Promise<WritableFile | null> {
  await ready
  const tab = useDocs.getState().active
  if (!restorable.has(tab)) return null
  const file = await getHandle(tab)
  if (!file) return null
  try {
    const mode = { mode: 'readwrite' } as const
    if ((await file.queryPermission?.(mode)) !== 'granted' && (await file.requestPermission?.(mode)) !== 'granted') return null
    return file
  } catch {
    return null
  }
}

/** The "Save as" file of the process on the canvas (null if none): taken when its tab is parked. */
export function takeSavedFile(): SavedFile | null {
  return current && current.doc === useEditor.getState().doc ? current.file : null
}

/** Gives the process now on the canvas its "Save as" file back (or none). */
export function setSavedFile(file: SavedFile | null) {
  current = file ? { file, doc: useEditor.getState().doc } : null
  if (file) remember(file)
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

/** The rules Bizagi complains about when it opens a file: the export tells the owner before the file goes there. */
const BIZAGI_RULES = ['P05', 'P07', 'P10', 'P19']

/** Export: BPMN 2.0 XML with the diagram, saved beside the process's own file (a download where there is no file dialog). */
export async function exportBpmn(): Promise<{ note: string; problems: number } | null> {
  const { model } = useEditor.getState()
  let collapsed = 0
  // The dialog opens first (it needs the click), the writer loads while it is open.
  const name = await saveExport(`${fileBaseName(model.name)}.bpmn`, 'bpmn', async () => {
    const { writeBpmn } = await import('../core/bpmn/write')
    const { collapseForBizagi } = await import('../core/bpmn/pages')
    const copy = collapseForBizagi(model)
    collapsed = copy.collapsed
    return new Blob([await writeBpmn(copy.model)], { type: 'application/xml' })
  })
  if (!name) return null
  const problems = lintModel(model).filter((i) => BIZAGI_RULES.includes(i.rule)).length
  const pages = collapsed ? ` ${collapsed === 1 ? 'The sub-process is' : `${collapsed} sub-processes are`} saved collapsed, its steps on a page of its own: Bizagi draws an expanded one as a huge empty box. Your drawing here is unchanged.` : ''
  return { note: `Exported ${name}: BPMN 2.0 XML. In Bizagi Modeler use Import, BPMN; bpmn.io opens it directly.${pages}`, problems }
}

/** Export for Bizagi with reusable sub-processes (the course practice's style): one .bpmn per page, in a .zip. */
export async function exportBizagiProject(): Promise<{ note: string; problems: number } | null> {
  const { model } = useEditor.getState()
  let made = { files: 0, moved: 0, dropped: 0 }
  const name = await saveExport(`${fileBaseName(model.name)}-bizagi.zip`, 'zip', async () => {
    const { writeReusable } = await import('../core/bpmn/reusable')
    const { writeZip } = await import('../core/zip')
    const { files, split } = await writeReusable(model)
    made = { files: files.length, moved: split.moved, dropped: split.dropped }
    const enc = new TextEncoder()
    return new Blob([writeZip(files.map((f) => ({ name: f.name, data: enc.encode(f.xml) }))) as BlobPart], { type: 'application/zip' })
  })
  if (!name) return null
  const problems = lintModel(model).filter((i) => BIZAGI_RULES.includes(i.rule)).length
  const what =
    made.files > 1
      ? `${made.files} BPMN files: Diagram 1 is the main process, each sub-process a call activity with its page in a file of its own (same pool, only the sub-process's lane).`
      : 'one BPMN file: the process has no sub-process, so Export BPMN gives the same.'
  const one = made.moved === 1
  const moved = made.moved ? ` ${made.moved} ${one ? 'step' : 'steps'} in another lane than ${one ? 'its' : 'their'} sub-process ${one ? 'is' : 'are'} drawn in the sub-process's lane on the page (Check, P20).` : ''
  const dropped = made.dropped ? ` ${made.dropped} data ${made.dropped === 1 ? 'association joins two files and is' : 'associations join two files and are'} left out.` : ''
  return { note: `Exported ${name}, ${what} Unzip it and import the files in Bizagi Modeler.${moved}${dropped} Your drawing here is unchanged.`, problems }
}

/**
 * Several files picked at once, or a .zip: one Bizagi project with reusable sub-processes (Diagram 1..N),
 * read into one model with pages. Null for a single plain file (opened as before).
 */
export async function readProjectFiles(files: File[]): Promise<{ model: FlowModel; warnings: string[]; pages: number; label: string } | null> {
  const zipped = (f: File) => /\.zip$/i.test(f.name)
  if (files.length < 2 && !files.some(zipped)) return null
  const texts: { name: string; text: string }[] = []
  for (const f of files) {
    if (!zipped(f)) {
      texts.push({ name: f.name, text: await f.text() })
      continue
    }
    const { readZip } = await import('../core/zip')
    for (const e of await readZip(new Uint8Array(await f.arrayBuffer())))
      if (/\.(bpmn|xml)$/i.test(e.name) && !e.name.startsWith('__MACOSX/')) texts.push({ name: e.name.split('/').pop()!, text: new TextDecoder().decode(e.data) })
  }
  if (!texts.length) throw new Error('no .bpmn files in it')
  if (texts.some((t) => !t.text.trimStart().startsWith('<'))) throw new Error('several files at once are read as one Bizagi project: pick only its .bpmn files')
  const { readProject } = await import('../core/bpmn/reusable')
  const r = await readProject(texts)
  return { model: r.model, warnings: r.warnings, pages: r.pages, label: files.length === 1 ? files[0].name : `${texts.length} files` }
}

/** Opens what the Open dialog gave: one file as before, several files or a .zip as one Bizagi project. */
export async function openFiles(files: File[]): Promise<void> {
  if (!files.length) return
  const { showError, say } = useEditor.getState()
  try {
    const project = await readProjectFiles(files)
    if (!project) return await openText(await files[0].text(), files[0].name)
    openProcess(project.model)
    const { warnings: w, pages } = project
    const linked = pages ? `${pages} ${pages === 1 ? 'sub-process' : 'sub-processes'} with ${pages === 1 ? 'its page' : 'their pages'} (double-click one to open it)` : 'no page was linked'
    say(`Opened ${project.label}: ${linked}.${w.length ? ` Note: ${w.slice(0, 3).join('; ')}${w.length > 3 ? '…' : ''}` : ''}`)
  } catch (e) {
    showError(`${files.length === 1 ? files[0].name : 'The files'} could not be opened: ${(e as Error).message}`)
  }
}

const IMAGE_KINDS = {
  png: { description: 'PNG image', accept: { 'image/png': ['.png'] } },
  svg: { description: 'SVG image', accept: { 'image/svg+xml': ['.svg'] } },
  bpmn: { description: 'BPMN 2.0 XML', accept: { 'application/xml': ['.bpmn'] } },
  zip: { description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } },
}

/**
 * Save a generated file: the dialog opens first (Chrome, Edge) and the content is made after it, since a slow
 * image would otherwise lose the click the browser requires. Others download. Returns the name, or null if cancelled.
 */
export async function saveExport(name: string, kind: keyof typeof IMAGE_KINDS, make: () => Promise<Blob>): Promise<string | null> {
  const show = picker()
  if (!show) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await withTimeout(make(), PREPARE_TIMEOUT_MS, slowMessage(name, PREPARE_TIMEOUT_MS)))
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    return name
  }
  let file: WritableFile
  try {
    // The dialog opens in the folder of the process's own file, so the exports end up together with it.
    const beside = await ownFile()
    file = await show({ suggestedName: name, types: [IMAGE_KINDS[kind]], id: 'flow-export', ...(beside ? { startIn: beside } : {}) })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null
    throw e
  }
  await writePrepared(file, make)
  return file.name
}

/** The file this process was saved to or opened from, without asking the browser for write access. */
async function ownFile(): Promise<WritableFile | null> {
  const { doc } = useEditor.getState()
  if (current && current.doc === doc) return current.file
  await ready
  const tab = useDocs.getState().active
  return restorable.has(tab) ? ((await getHandle(tab)) ?? null) : null
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
  const back = await restoreFile()
  if (back && useEditor.getState().doc === doc) {
    await write(back)
    current = { file: back, doc }
    return `Saved to ${back.name}`
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
  remember(file)
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
