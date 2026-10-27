// The Changes panel under the canvas: what changed since the earlier version (File → Review this model, or
// Compare with), numbered as on the canvas. The reviewer gathers changes into fixes (one number, one note on
// what to change and why, one quote from the task text), in the order of their choice; changes in no fix follow.
// Clicking a change shows its element; selecting an element opens its change. Fixes live in the model's review,
// so they are saved with the file, undone with Ctrl+Z and printed on the review sheet.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ArrowDown, ArrowUp, GitCompareArrows, Play, Printer, Share2, Trash2, X } from 'lucide-react'
import { playReview } from '../story/present'
import { shareNow } from '../share'
import { addToFix, deleteFix, endReview, makeFix, moveFix, removeFromFix, reviewDiff, setFixNote, setReviewNote, toggleUnpair, type Change, type DiffFix, type ModelDiff } from '../../core/diff'
import type { FlowModel } from '../../core/metamodel'
import { nodeOf, pageOf } from '../../core/ops'
import { printReview, setEmphasis, useReviewUi, type Emphasis } from '../review'
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
  const { marks, focus, emphasis } = useReviewUi()
  const flow = useReactFlow()
  const list = useRef<HTMLUListElement>(null)
  // Changes ticked to gather into a fix.
  const [picked, setPicked] = useState<string[]>([])
  // Selecting an element on the canvas opens its change and brings it into view in the list.
  useEffect(() => {
    if (selection.length !== 1 || !diff) return
    const c = diff.changes.find((x) => x.id === selection[0])
    if (!c) return
    useReviewUi.setState({ focus: c.fix ? `fix:${c.fix}` : c.key })
    list.current?.querySelector(`[data-key="${CSS.escape(c.key)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selection, diff])
  // A change that is gone is no longer ticked.
  useEffect(() => {
    if (diff) setPicked((p) => (p.every((k) => diff.changes.some((c) => c.key === k)) ? p : p.filter((k) => diff.changes.some((c) => c.key === k))))
  }, [diff])
  if (!diff || !review) return null

  const show = (c: Change) => {
    useReviewUi.setState({ focus: c.fix ? `fix:${c.fix}` : c.key })
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
      // A removed flow is drawn on the page of the steps it joined.
      const bf = c.kind === 'flow' ? review.base.flows.find((f) => f.id === c.baseId) : undefined
      const at = bf && diff.map[bf.source]
      if (at) page = pageOf(m, at) ?? null
    }
    if (page !== s.page) s.openPage(page)
    if (c.id) s.select([c.id])
    else s.select([])
    const id = canvasId(c)
    const onCanvas = id && (nodeOf(m, id) || m.participants.some((p) => p.id === id) || m.lanes.some((l) => l.id === id) || id.startsWith('ghost:'))
    const flowEnds = !onCanvas && c.id ? m.flows.find((f) => f.id === c.id) : undefined
    const goneFlow = !c.id && c.kind === 'flow' ? review.base.flows.find((f) => f.id === c.baseId) : undefined
    const ids = onCanvas ? [id!] : flowEnds ? [flowEnds.source, flowEnds.target] : goneFlow ? [diff.map[goneFlow.source], diff.map[goneFlow.target]].filter(Boolean) : []
    if (ids.length) requestAnimationFrame(() => void flow.fitView({ nodes: ids.map((x) => ({ id: x })), maxZoom: 1.2, padding: 0.4, duration: 300 }))
  }
  const apply = useEditor.getState().apply
  /** Opens a fix and puts the caret in its note. */
  const focusFix = (id: string) => {
    useReviewUi.setState({ focus: `fix:${id}` })
    requestAnimationFrame(() => list.current?.querySelector<HTMLTextAreaElement>(`[data-key="${CSS.escape(`fix:${id}`)}"] textarea`)?.focus())
  }
  const gather = (into?: string) => {
    let id: string | null = into ?? null
    if (apply((m) => (into ? addToFix(m, into, picked) : void (id = makeFix(m, picked))))) {
      setPicked([])
      if (id) focusFix(id)
    }
  }
  const tick = (key: string, on: boolean) => setPicked((p) => (on ? [...p, key] : p.filter((k) => k !== key)))
  const others = diff.changes.filter((c) => !c.fix)

  return (
    <section className="check-panel changes-panel" aria-label="Changes" data-testid="changes-panel">
      <header>
        <strong>Changes</strong>
        <span className="muted">
          {diffSummary(diff)}
          {diff.kept ? ` · ${diff.kept} kept` : ''}
          {diff.fixes.length ? ` · ${diff.fixes.length} fix${diff.fixes.length === 1 ? '' : 'es'}` : ''}, compared with “{review.base.name || 'the earlier version'}”
        </span>
        <label className="chg-toggle" title="Show the numbers and colours on the diagram">
          <input type="checkbox" checked={marks} onChange={(e) => useReviewUi.setState({ marks: e.target.checked })} data-testid="changes-marks" /> On the canvas
        </label>
        <label className="chg-toggle" title="Names of added and changed elements in bold (and larger), on the canvas and on the review sheet">
          Emphasis
          <select value={emphasis} onChange={(e) => setEmphasis(e.target.value as Emphasis)} data-testid="changes-emphasis">
            <option value="off">Off</option>
            <option value="bold">Bold</option>
            <option value="large">Bold + larger</option>
          </select>
        </label>
        <button className="btn" onClick={() => playReview()} title="Tell the review fix by fix: the draft first, then each fix with its note and quote, full screen with Present" data-testid="changes-play">
          <Play size={14} /> <span className="btn-label">Play review</span>
        </button>
        <button className="btn" onClick={() => void shareNow(false)} title="One .flow.html file to send: opening it lands in Quaera Flow with this process and its changes, ready for Play review. Nothing is uploaded" data-testid="changes-share">
          <Share2 size={14} /> <span className="btn-label">Share as file</span>
        </button>
        <button className="btn" onClick={() => void printReview()} title="The diagram with its numbers and the list of fixes with your notes, to print or save as PDF" data-testid="changes-print">
          <Printer size={14} /> <span className="btn-label">Review sheet</span>
        </button>
        <button
          className="btn"
          onClick={() => {
            apply((m) => endReview(m))
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
      {picked.length > 0 && (
        <div className="chg-gather" data-testid="changes-gather">
          <span>{picked.length} ticked: one fix, one number, one note</span>
          <button className="btn" onClick={() => gather()} data-testid="make-fix">
            Make one fix
          </button>
          {diff.fixes.length > 0 && (
            <select value="" onChange={(e) => e.target.value && gather(e.target.value)} aria-label="Add to a fix" data-testid="add-to-fix">
              <option value="">Add to fix…</option>
              {diff.fixes.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.n}. {fixTitle(f)}
                </option>
              ))}
            </select>
          )}
          <button className="btn" onClick={() => setPicked([])}>
            Untick
          </button>
        </div>
      )}
      <ul ref={list}>
        <li className="chg-general">
          <NoteField label="Overall" placeholder="Overall: what is already good, what to look at first" value={review.notes.general?.text ?? ''} onChange={(text) => apply((m) => setReviewNote(m, 'general', { text }), { coalesce: 'note:general:text' })} testid="note-general" />
        </li>
        {diff.changes.length === 0 && diff.fixes.length === 0 && (
          <li className="muted chg-empty">No changes yet. Edit the process, or select an element and write a comment on it here: its number appears on the diagram.</li>
        )}
        {diff.fixes.map((f, i) => {
          const fix = review.fixes!.find((x) => x.id === f.id)!
          const note = (patch: { text?: string; quote?: string }) => apply((m) => setFixNote(m, f.id, patch), { coalesce: `fix:${f.id}:${Object.keys(patch)[0]}` })
          return (
            <li key={f.id} data-key={`fix:${f.id}`} className={`chg-fix${focus === `fix:${f.id}` ? ' is-focused' : ''}`} data-testid={`fix:${f.n}`}>
              <div className="chg-fix-head">
                <span className={`chg-badge chg-${fixStatus(f)}`}>{f.n}</span>
                <strong className="chg-fix-title">Fix {f.n}</strong>
                <span className="muted">
                  {f.changes.length ? `${f.changes.length} change${f.changes.length === 1 ? '' : 's'}` : 'nothing changed here now'}
                  {f.gone.length ? ` · ${f.gone.length} no longer changed` : ''}
                </span>
                <span className="chg-fix-tools">
                  <button className="btn icon" disabled={i === 0} onClick={() => apply((m) => moveFix(m, f.id, -1))} aria-label={`Move fix ${f.n} up`} title="Up: a lower number">
                    <ArrowUp size={13} />
                  </button>
                  <button className="btn icon" disabled={i === diff.fixes.length - 1} onClick={() => apply((m) => moveFix(m, f.id, 1))} aria-label={`Move fix ${f.n} down`} title="Down: a higher number">
                    <ArrowDown size={13} />
                  </button>
                  <button className="btn icon" onClick={() => apply((m) => deleteFix(m, f.id))} aria-label={`Remove fix ${f.n}`} title="Remove this fix and its note: its changes go back to the other changes (Undo brings it back)" data-testid={`remove-fix:${f.n}`}>
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
              <ul className="chg-fix-changes">
                {f.changes.map((c) => (
                  <ChangeRow key={c.key} c={c} focused={focus === c.key} picked={picked.includes(c.key)} onTick={tick} onShow={show} split={!!(c.id && review.unpair?.includes(c.id))}>
                    <button className="btn icon chg-out" onClick={() => apply((m) => removeFromFix(m, c.key))} aria-label="Take out of this fix" title="Take out of this fix">
                      <X size={13} />
                    </button>
                  </ChangeRow>
                ))}
              </ul>
              <div className="chg-notes">
                <NoteField label="Note" placeholder="What to change, and why" value={fix.text ?? ''} onChange={(text) => note({ text })} testid={`note:${f.n}`} />
                <NoteField label="The task says" placeholder="What the task text says (a quote)" value={fix.quote ?? ''} onChange={(quote) => note({ quote })} testid={`quote:${f.n}`} />
              </div>
            </li>
          )
        })}
        {diff.fixes.length > 0 && others.length > 0 && <li className="chg-others-head muted">Other changes: tick some to make a fix of them, or add a note to one</li>}
        {others.map((c) => (
          <ChangeRow key={c.key} c={c} focused={focus === c.key} picked={picked.includes(c.key)} onTick={tick} onShow={show} split={!!(c.id && review.unpair?.includes(c.id))}>
            <button
              className="btn chg-add-note"
              onClick={() => {
                let id: string | null = null
                show(c)
                if (apply((m) => void (id = makeFix(m, [c.key])))) focusFix(id!)
              }}
              title="Write what to change and why: the change becomes a fix with the next free number"
              data-testid={`add-note:${c.n}`}
            >
              + Note
            </button>
          </ChangeRow>
        ))}
        <CommentHint diff={diff} onFix={focusFix} />
      </ul>
    </section>
  )
}

/** A fix's colour: its changes' kind when they agree, else "changed". */
function fixStatus(f: DiffFix): Change['status'] {
  const kinds = new Set(f.changes.map((c) => c.status))
  return kinds.size === 1 ? [...kinds][0] : kinds.size ? 'changed' : 'comment'
}

/** A fix named by its first change, for the "Add to fix" list. */
const fixTitle = (f: DiffFix) => (f.changes.length ? `${f.changes[0].label}${f.changes.length > 1 ? ` +${f.changes.length - 1}` : ''}` : 'nothing changed now')

/** One change: its number, kind, element and what differs; a tick to gather it into a fix. */
function ChangeRow({ c, focused, picked, split, onTick, onShow, children }: { c: Change; focused: boolean; picked: boolean; split: boolean; onTick: (key: string, on: boolean) => void; onShow: (c: Change) => void; children?: ReactNode }) {
  return (
    <li data-key={c.key} className={`chg-row chg-row-${c.status}${focused ? ' is-focused' : ''}`} data-testid={`change:${c.key}`}>
      <div className="chg-head">
        <input type="checkbox" className="chg-tick" checked={picked} onChange={(e) => onTick(c.key, e.target.checked)} aria-label={`Tick ${c.label}`} title="Tick to gather into a fix" />
        <button className="chg-main" onClick={() => onShow(c)} title="Show it on the diagram">
          {!c.fix && <span className={`chg-badge chg-${c.status}${c.uncertain ? ' is-uncertain' : ''}`}>{c.n}</span>}
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
        {children}
      </div>
    </li>
  )
}

/** With one element selected that has no change and no note: offer a comment on it (praise, a question). */
function CommentHint({ diff, onFix }: { diff: ModelDiff; onFix: (id: string) => void }) {
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
          let fix: string | null = null
          if (useEditor.getState().apply((m) => void (fix = makeFix(m, [`r:${id}`])))) onFix(fix!)
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
