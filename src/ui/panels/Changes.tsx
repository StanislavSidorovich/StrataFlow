// The Changes panel under the canvas: what changed since the earlier version (File → Review this model, or
// Compare with), numbered as on the canvas, each with a note (what to change and why) and a quote from the
// task text. Clicking a change shows its element; selecting an element opens its change. Notes live in the
// model's review, so they are saved with the file, undone with Ctrl+Z and printed on the review sheet.
import { useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { GitCompareArrows, Printer, X } from 'lucide-react'
import { endReview, reviewDiff, setReviewNote, toggleUnpair, type Change, type ModelDiff } from '../../core/diff'
import type { FlowModel } from '../../core/metamodel'
import { nodeOf, pageOf } from '../../core/ops'
import { printReview, useReviewUi } from '../review'
import { useEditor } from '../store'

export { useReviewUi }

let cache: { model: FlowModel | null; diff: ModelDiff | null } = { model: null, diff: null }

/** The changes of the current model against its earlier version (null when it is not compared), once per model version. */
export function useDiff(): ModelDiff | null {
  const model = useEditor((s) => s.model)
  if (cache.model !== model) cache = { model, diff: reviewDiff(model) }
  return cache.diff
}

export const STATUS_WORD: Record<Change['status'], string> = { added: 'added', changed: 'changed', removed: 'removed', comment: 'comment' }

/** "3 added · 4 changed · 2 removed", for the panel and the button. */
export function diffSummary(d: ModelDiff): string {
  const parts = (['added', 'changed', 'removed'] as const).filter((s) => d.counts[s]).map((s) => `${d.counts[s]} ${s}`)
  return parts.length ? parts.join(' · ') : 'No changes yet'
}

/** The id an element of a change has on the canvas: its own, or its ghost's when it was removed. */
export const canvasId = (c: Change) => (c.id ? c.id : c.kind === 'node' ? `ghost:${c.baseId}` : null)

/** The top bar button: shown while the model is compared with an earlier version. */
export function ChangesButton() {
  const diff = useDiff()
  const open = useReviewUi((s) => s.open)
  if (!diff) return null
  const n = diff.counts.added + diff.counts.changed + diff.counts.removed
  return (
    <button className={`btn${open ? ' is-open' : ''}`} onClick={() => useReviewUi.setState({ open: !open })} title="Changes since the earlier version: numbered on the diagram, each with a note" data-testid="changes">
      <GitCompareArrows size={15} /> <span className="btn-label">Changes</span>
      <span className="count is-changes">{n}</span>
    </button>
  )
}

export function ChangesPanel() {
  const diff = useDiff()
  const review = useEditor((s) => s.model.review)
  const selection = useEditor((s) => s.selection)
  const { marks, focus } = useReviewUi()
  const flow = useReactFlow()
  const list = useRef<HTMLUListElement>(null)
  // Selecting an element on the canvas opens its change and brings it into view in the list.
  useEffect(() => {
    if (selection.length !== 1 || !diff) return
    const c = diff.changes.find((x) => x.id === selection[0])
    if (!c) return
    useReviewUi.setState({ focus: c.key })
    list.current?.querySelector(`[data-key="${CSS.escape(c.key)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selection, diff])
  if (!diff || !review) return null

  const show = (c: Change) => {
    useReviewUi.setState({ focus: c.key })
    const s = useEditor.getState()
    const m = s.model
    let page: string | null = null
    if (c.id) {
      const at = nodeOf(m, c.id)?.id ?? m.flows.find((f) => f.id === c.id)?.source
      page = at ? (pageOf(m, at) ?? null) : null
    } else if (c.baseId) {
      // A removed step is drawn on the page its sub-process now has.
      const bp = pageOf(review.base, c.baseId)
      page = bp ? (diff.map[bp] ?? null) : null
    }
    if (page !== s.page) s.openPage(page)
    if (c.id) s.select([c.id])
    else s.select([])
    const id = canvasId(c)
    const onCanvas = id && (nodeOf(m, id) || m.participants.some((p) => p.id === id) || m.lanes.some((l) => l.id === id) || id.startsWith('ghost:'))
    const flowEnds = !onCanvas && c.id ? m.flows.find((f) => f.id === c.id) : undefined
    const ids = onCanvas ? [id!] : flowEnds ? [flowEnds.source, flowEnds.target] : []
    if (ids.length) requestAnimationFrame(() => void flow.fitView({ nodes: ids.map((x) => ({ id: x })), maxZoom: 1.2, padding: 0.4, duration: 300 }))
  }
  // Only a click on "+ Note" takes the focus: selecting the element on the canvas must leave it there (typing a name).
  const focusNote = (key: string) => {
    useReviewUi.setState({ focus: key })
    requestAnimationFrame(() => list.current?.querySelector<HTMLTextAreaElement>(`[data-key="${CSS.escape(key)}"] textarea`)?.focus())
  }
  const note = (key: string, patch: { text?: string; quote?: string }) =>
    useEditor.getState().apply((m) => setReviewNote(m, key, patch), { coalesce: `note:${key}:${Object.keys(patch)[0]}` })

  return (
    <section className="check-panel changes-panel" aria-label="Changes" data-testid="changes-panel">
      <header>
        <strong>Changes</strong>
        <span className="muted">
          {diffSummary(diff)}
          {diff.kept ? ` · ${diff.kept} kept` : ''}, compared with “{review.base.name || 'the earlier version'}”
        </span>
        <label className="chg-toggle" title="Show the numbers and colours on the diagram">
          <input type="checkbox" checked={marks} onChange={(e) => useReviewUi.setState({ marks: e.target.checked })} data-testid="changes-marks" /> On the canvas
        </label>
        <button className="btn" onClick={() => void printReview()} title="The diagram with its numbers and the list of changes with your notes, to print or save as PDF" data-testid="changes-print">
          <Printer size={14} /> <span className="btn-label">Review sheet</span>
        </button>
        <button
          className="btn"
          onClick={() => {
            useEditor.getState().apply((m) => endReview(m))
            useReviewUi.setState({ open: false, focus: null })
            useEditor.getState().say('Stopped comparing: the earlier version and the notes are gone from this process (Undo brings them back).')
          }}
          title="Forget the earlier version and the notes (Undo brings them back)"
          data-testid="changes-stop"
        >
          Stop comparing
        </button>
        <button className="btn icon" onClick={() => useReviewUi.setState({ open: false })} aria-label="Close the changes" title="Close (the changes stay)">
          <X size={14} />
        </button>
      </header>
      <ul ref={list}>
        <li className="chg-general">
          <NoteField label="Overall" placeholder="Overall: what is already good, what to look at first" value={review.notes.general?.text ?? ''} onChange={(text) => note('general', { text })} testid="note-general" />
        </li>
        {diff.changes.length === 0 && (
          <li className="muted chg-empty">No changes yet. Edit the process, or select an element and write a comment on it here: its number appears on the diagram.</li>
        )}
        {diff.changes.map((c) => {
          const open = focus === c.key || !!review.notes[c.key]
          const split = c.id && review.unpair?.includes(c.id)
          return (
            <li key={c.key} data-key={c.key} className={`chg-row chg-row-${c.status}${focus === c.key ? ' is-focused' : ''}`} data-testid={`change:${c.n}`}>
              <div className="chg-head">
                <button className="chg-main" onClick={() => show(c)} title="Show it on the diagram">
                  <span className={`chg-badge chg-${c.status}${c.uncertain ? ' is-uncertain' : ''}`}>{c.n}</span>
                  <span className={`chg-word chg-word-${c.status}`}>{STATUS_WORD[c.status]}</span>
                  <span className="chg-label">{c.label}</span>
                  {c.details.length > 0 && <span className="chg-details">{c.details.join('; ')}</span>}
                </button>
                {(c.uncertain || split) && (
                  <button
                    className="btn chg-pair"
                    onClick={() => useEditor.getState().apply((m) => toggleUnpair(m, c.id!))}
                    title={split ? 'Pair it again with the element that stood here' : 'Paired by its place only. Not the same element? Then it is listed as added, the other one as removed.'}
                  >
                    {split ? 'Pair again' : 'Not the same'}
                  </button>
                )}
                {!open && (
                  <button className="btn chg-add-note" onClick={() => (show(c), focusNote(c.key))} title="Write what to change and why" data-testid={`add-note:${c.n}`}>
                    + Note
                  </button>
                )}
              </div>
              {open && (
                <div className="chg-notes">
                  <NoteField label="Note" placeholder="What to change, and why" value={review.notes[c.key]?.text ?? ''} onChange={(text) => note(c.key, { text })} testid={`note:${c.n}`} />
                  <NoteField label="The task says" placeholder="What the task text says (a quote)" value={review.notes[c.key]?.quote ?? ''} onChange={(quote) => note(c.key, { quote })} testid={`quote:${c.n}`} />
                </div>
              )}
            </li>
          )
        })}
        <CommentHint diff={diff} />
      </ul>
    </section>
  )
}

/** With one element selected that has no change and no note: offer a comment on it (praise, a question). */
function CommentHint({ diff }: { diff: ModelDiff }) {
  const selection = useEditor((s) => s.selection)
  const model = useEditor((s) => s.model)
  const id = selection.length === 1 ? selection[0] : null
  if (!id || diff.changes.some((c) => c.id === id)) return null
  const name = nodeOf(model, id)?.name || model.participants.find((p) => p.id === id)?.name || model.lanes.find((l) => l.id === id)?.name || 'the selected element'
  return (
    <li className="chg-comment-hint">
      <button
        className="btn"
        onClick={() => {
          useEditor.getState().apply((m) => setReviewNote(m, `r:${id}`, { text: ' ' }))
          useReviewUi.setState({ focus: `r:${id}` })
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`.changes-panel [data-key="${CSS.escape(`r:${id}`)}"] textarea`)?.focus())
        }}
        data-testid="comment-selected"
      >
        + Comment on “{name}”
      </button>
      <span className="muted"> unchanged, but worth a word (it gets a number)</span>
    </li>
  )
}

/** A text box that keeps its own text while typing (the model reaches it a render late) and grows with it. */
function NoteField({ label, placeholder, value, onChange, testid }: { label: string; placeholder: string; value: string; onChange: (v: string) => void; testid: string }) {
  const [text, setText] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  const typing = useRef(false)
  useEffect(() => {
    if (!typing.current) setText(value)
  }, [value])
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${t.scrollHeight + 2}px`
  }, [text])
  return (
    <label className="chg-field">
      <span className="chg-field-label">{label}</span>
      <textarea
        ref={ref}
        rows={1}
        value={text === ' ' ? '' : text}
        placeholder={placeholder}
        data-testid={testid}
        onFocus={() => (typing.current = true)}
        onBlur={() => (typing.current = false)}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setText(e.target.value)
          onChange(e.target.value)
        }}
      />
    </label>
  )
}
