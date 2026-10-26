// Comparing two versions of a process (core/diff.ts) from the File menu: review a model (a copy to correct, in
// a new tab), compare the open process with a file or another tab, and the review sheet to print or save as PDF.
import { reviewCopy, reviewDiff, startReview, type Change } from '../core/diff'
import type { FlowModel } from '../core/metamodel'
import { parseModel } from '../core/serialize'
import { isCaseFile } from '../data/caseFile'
import { openProcess, useDocs } from './docs'
import { prepareImage } from './exportImage'
import { create } from 'zustand'
import { PREPARE_TIMEOUT_MS, withTimeout } from './safeWrite'
import { useEditor } from './store'

interface ReviewUi {
  /** The Changes panel is open. */
  open: boolean
  /** The numbers and colours are drawn on the canvas (off: the plain diagram). */
  marks: boolean
  /** The change (its key) or fix (`fix:<id>`) in focus. */
  focus: string | null
  /** Names of added and changed elements drawn in bold, or bold and larger (a view setting, kept per browser). */
  emphasis: Emphasis
}

export type Emphasis = 'off' | 'bold' | 'large'
const EMPHASIS_KEY = 'strataflow.review.emphasis'

function storedEmphasis(): Emphasis {
  try {
    const v = localStorage.getItem(EMPHASIS_KEY)
    return v === 'bold' || v === 'large' ? v : 'off'
  } catch {
    return 'off'
  }
}

export const useReviewUi = create<ReviewUi>(() => ({ open: false, marks: true, focus: null, emphasis: storedEmphasis() }))

export function setEmphasis(emphasis: Emphasis) {
  useReviewUi.setState({ emphasis })
  try {
    localStorage.setItem(EMPHASIS_KEY, emphasis)
  } catch {
    // A private window: it lasts until the page is closed.
  }
}

const inTask = () => useEditor.getState().backup !== null
const TASK_NOTE = 'A trainer task is on the canvas: leave the task first (your own processes wait in their tabs).'

/** Review this model: a copy to correct opens in a new tab, the model itself stays as it was in its own tab. */
export function reviewThisModel() {
  const { model, say } = useEditor.getState()
  if (inTask()) return say(TASK_NOTE)
  if (!model.nodes.length && !model.participants.length) return say('Open the model to review first (File → Open: a .flow.json, or a .bpmn exported from Bizagi).')
  if (!openProcess(reviewCopy(model))) return
  useReviewUi.setState({ open: true, marks: true, focus: null })
  say('Correct this copy: each change gets a number on the diagram and a line in the Changes panel, with room for a note. The original stays in its tab.')
}

/** Compare the open process with an earlier version: the one given is "before", the open one "after". */
export function compareWith(base: FlowModel, what: string) {
  const { apply, say } = useEditor.getState()
  if (inTask()) return say(TASK_NOTE)
  if (!apply((m) => startReview(m, base))) return
  useReviewUi.setState({ open: true, marks: true, focus: null })
  const d = reviewDiff(useEditor.getState().model)
  const n = d ? d.counts.added + d.counts.changed + d.counts.removed : 0
  say(`Compared with ${what}: ${n ? `${n} change${n === 1 ? '' : 's'}, numbered on the diagram` : 'no changes'}. Stop comparing in the Changes panel forgets it.`)
}

/** Compare with a file: a `.flow.json` or a BPMN file (a Bizagi export). */
export async function compareWithText(text: string, fileName: string) {
  const { showError } = useEditor.getState()
  try {
    let base: FlowModel
    if (text.trimStart().startsWith('<')) {
      const { readBpmn } = await import('../core/bpmn/read')
      base = (await readBpmn(text)).model
      if (!base.name) base.name = fileName.replace(/\.(bpmn|xml)$/i, '')
    } else if (isCaseFile(text)) throw new Error('this is a case file of the trainer, not a process')
    else base = parseModel(text)
    compareWith(base, `“${fileName}”`)
  } catch (e) {
    showError(`Not compared with ${fileName}: ${(e as Error).message}`)
  }
}

/** The other open tabs, to compare with (name and model). */
export function otherTabs(): { id: string; name: string; model: FlowModel }[] {
  const { tabs, parked } = useDocs.getState()
  return tabs.filter((t) => parked[t.id]).map((t) => ({ id: t.id, name: parked[t.id].model.name || 'Untitled process', model: parked[t.id].model }))
}

// ---------------------------------------------------------------- the review sheet

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const para = (s: string) => esc(s.trim()).replace(/\n/g, '<br>')

const SHEET_CSS = `
@page { size: A4 landscape; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 24px; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b2230; background: #fff; }
h1 { font-size: 20px; margin: 0 0 2px; }
.sub { color: #5b6577; margin: 0 0 14px; }
.bar { display: flex; gap: 8px; margin-bottom: 14px; }
.bar button { font: inherit; padding: 6px 12px; border: 1px solid #c6ccd8; border-radius: 6px; background: #f4f6fa; cursor: pointer; }
.diagram { display: block; width: auto; max-width: 100%; max-height: 165mm; margin: 0 auto; border: 1px solid #dfe3ea; border-radius: 6px; }
.picture { break-after: page; }
.wait { padding: 40px; text-align: center; color: #5b6577; border: 1px dashed #c6ccd8; border-radius: 6px; }
.overall { margin: 14px 0 0; padding: 10px 12px; border-left: 4px solid #15803d; background: #e3f6e9; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th { text-align: left; color: #5b6577; font-weight: 600; padding: 6px 8px; border-bottom: 2px solid #dfe3ea; }
td { vertical-align: top; padding: 8px; border-bottom: 1px solid #e6e9ef; }
tr { break-inside: avoid; }
.n { width: 34px; }
.badge { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px; color: #fff; font-weight: 700; font-size: 12px; background: #7c3aed; }
.badge.added { background: #15803d; } .badge.removed { background: #6b7385; } .badge.comment { background: #0d9488; }
.word { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #7c3aed; font-weight: 600; }
.word.added { color: #15803d; } .word.removed { color: #6b7385; } .word.comment { color: #0d9488; }
.label { font-weight: 600; }
.change + .change { margin-top: 5px; }
.part th { padding-top: 14px; }
.details { color: #4b5568; }
.quote { color: #4b5568; font-style: italic; }
.foot { margin-top: 18px; color: #8a94a6; font-size: 11px; }
@media print { .bar { display: none; } body { margin: 0; } }
`

/**
 * The review sheet: the diagram with its numbers and the table of changes with the notes, in a new window to
 * print or save as PDF (the browser's print dialog, no library). The window opens on the click, the picture follows.
 */
export function printReview() {
  const { model, showError } = useEditor.getState()
  const diff = reviewDiff(model)
  if (!diff || !model.review) return
  const w = window.open('', '_blank')
  if (!w) return showError('The review sheet opens in a new window: allow pop-ups for this site and try again.')
  const notes = model.review.notes
  const what = (c: Change) => `<div class="change"><span class="word ${c.status}">${c.status}</span> <span class="label">${esc(c.label)}</span>${c.details.length ? `<div class="details">${esc(c.details.join('; '))}</div>` : ''}</div>`
  // One row per fix (its changes, one note, one quote), then the changes in no fix.
  const fixRows = diff.fixes.map((f) => {
    const fix = model.review!.fixes!.find((x) => x.id === f.id)
    const kinds = new Set(f.changes.map((c) => c.status))
    const status = kinds.size === 1 ? [...kinds][0] : 'changed'
    return `<tr><td class="n"><span class="badge ${status}">${f.n}</span></td><td>${f.changes.map(what).join('') || '<div class="details">Nothing changed here now</div>'}</td><td>${fix?.text?.trim() ? para(fix.text) : ''}</td><td class="quote">${fix?.quote?.trim() ? para(fix.quote) : ''}</td></tr>`
  })
  const others = diff.changes.filter((c) => !c.fix).map((c) => `<tr><td class="n"><span class="badge ${c.status}">${c.n}</span></td><td>${what(c)}</td><td></td><td></td></tr>`)
  const rows = [...fixRows, ...(fixRows.length && others.length ? ['<tr class="part"><th colspan="4">Other changes</th></tr>'] : []), ...others].join('')
  const overall = notes.general?.text?.trim()
  // A review copy is named "X (review)": the sheet says it once.
  const title = `Review: ${(model.name || 'process').replace(/\s*\(review\)\s*$/i, '') || 'process'}`
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${SHEET_CSS}</style></head><body>
<div class="bar"><button onclick="window.print()">Print or save as PDF</button><button onclick="window.close()">Close</button></div>
<h1>${esc(title)}</h1>
<p class="sub">Compared with “${esc(model.review.base.name || 'the earlier version')}”: ${(['added', 'changed', 'removed'] as const).filter((s) => diff.counts[s]).map((s) => `${diff.counts[s]} ${s}`).join(', ') || 'no changes'}${diff.kept ? `, ${diff.kept} kept` : ''}${diff.fixes.length ? `; ${diff.fixes.length} fix${diff.fixes.length === 1 ? '' : 'es'}` : ''}. Green = added, violet = changed, grey dashed = removed; the numbers match the table.</p>
<div class="picture"><div id="diagram" class="wait">Drawing the diagram…</div></div>
${overall ? `<p class="overall">${para(overall)}</p>` : ''}
<table><thead><tr><th class="n">#</th><th>What changed</th><th>Note</th><th>What the task says</th></tr></thead><tbody>${rows || '<tr><td></td><td>No changes</td><td></td><td></td></tr>'}</tbody></table>
<p class="foot">Made with Quaera Flow, flow.quaera.app</p>
</body></html>`)
  w.document.close()
  // The numbers must be on the diagram for the picture.
  const marks = useReviewUi.getState().marks
  if (!marks) useReviewUi.setState({ marks: true })
  // Numbers that read on the printed page: about 16 px there, so the wider the diagram, the bigger on the canvas.
  const xs = Object.values(model.diagram.shapes)
  const span = xs.length ? Math.max(...xs.map((s) => s.x + s.width)) - Math.min(...xs.map((s) => s.x)) : 1000
  const root = document.documentElement
  root.style.setProperty('--sheet-badge', `${Math.round(Math.min(72, Math.max(20, (span / 1000) * 17)))}px`)
  root.classList.add('sheet-picture')
  void (async () => {
    const box = w.document.getElementById('diagram')
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const make = await prepareImage('png')
      const blob = await withTimeout(make(), PREPARE_TIMEOUT_MS, 'Drawing the diagram took too long: try Export PNG, or close other tabs.')
      const url = URL.createObjectURL(blob)
      if (box) box.outerHTML = `<img class="diagram" alt="The diagram with the numbered changes" src="${url}">`
      w.addEventListener('pagehide', () => URL.revokeObjectURL(url))
    } catch (e) {
      if (box) box.textContent = `The diagram could not be drawn: ${(e as Error).message}`
    } finally {
      root.classList.remove('sheet-picture')
      root.style.removeProperty('--sheet-badge')
      if (!marks) useReviewUi.setState({ marks: false })
    }
  })()
}
