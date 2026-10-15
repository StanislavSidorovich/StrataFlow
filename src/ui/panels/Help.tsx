// Help cards in the right column: the list of cards (with a search) or one card. A "?" next to a field
// or a shape opens the card for it; "Back" returns to Properties.
import { useMemo, useState } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import { caseRefs } from '../../data/caseRefs'
import { cardById, HELP_CARDS, type HelpCard } from '../../data/help'
import { useEditor } from '../store'
import { useTrainer } from '../trainer/trainerStore'

/** A small "?" that opens a help card. */
export function HelpQ({ card, label }: { card: string; label?: string }) {
  return (
    <button
      type="button"
      className="help-q"
      title={`Help: ${label ?? cardById(card)?.title ?? card}`}
      aria-label={`Help: ${label ?? cardById(card)?.title ?? card}`}
      data-testid={`help:${card}`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        useEditor.getState().openHelp(card)
      }}
    >
      ?
    </button>
  )
}

export function HelpPanel({ id }: { id: string }) {
  const card = id === 'index' ? undefined : cardById(id)
  const close = () => useEditor.getState().openHelp(null)
  return (
    <aside className="side-panel help-panel" aria-label="Help" data-testid="help-panel">
      <div className="help-nav">
        {card ? (
          <button className="btn" onClick={() => useEditor.getState().openHelp('index')} data-testid="help-index">
            <ArrowLeft size={14} /> All cards
          </button>
        ) : (
          <strong>Help cards</strong>
        )}
        <button className="btn icon" onClick={close} title="Close help (back to Properties)" aria-label="Close help" data-testid="help-close">
          <X size={14} />
        </button>
      </div>
      {card ? <CardView card={card} /> : <CardIndex />}
    </aside>
  )
}

function CardIndex() {
  const [q, setQ] = useState('')
  const found = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return HELP_CARDS
    return HELP_CARDS.filter((c) => [c.title, c.oneLiner, ...c.whenToUse].some((s) => s.toLowerCase().includes(t)))
  }, [q])
  return (
    <>
      <label className="help-search">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: gateway, timer, lane…" autoFocus data-testid="help-search" />
      </label>
      <ul className="help-list">
        {found.map((c) => (
          <li key={c.id}>
            <button onClick={() => useEditor.getState().openHelp(c.id)} data-testid={`card:${c.id}`}>
              <strong>{c.title}</strong>
              <span className="muted">{c.oneLiner}</span>
            </button>
          </li>
        ))}
        {!found.length && <li className="muted">No card mentions "{q}".</li>}
      </ul>
    </>
  )
}

function CardView({ card }: { card: HelpCard }) {
  const refs = useMemo(() => caseRefs(card.id), [card.id])
  return (
    <article className="help-card" data-testid="help-card">
      <h2>{card.title}</h2>
      <p className="help-one">{card.oneLiner}</p>
      {card.miniModel && <MiniModel spec={card.miniModel} />}
      {card.body.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <h3>Signals in a case text</h3>
      <ul className="tips">
        {card.whenToUse.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <h3>Typical mistake</h3>
      <p className="help-mistake">{card.typicalMistake}</p>
      <h3>See also</h3>
      <div className="help-chips">
        {card.seeAlso.map((s) => (
          <button key={s} className="chip" onClick={() => useEditor.getState().openHelp(s)}>
            {cardById(s)?.title ?? s}
          </button>
        ))}
      </div>
      {refs.length > 0 && (
        <>
          <h3>In the cases</h3>
          <div className="help-chips" data-testid="case-refs">
            {refs.map((r) => (
              <button
                key={r.caseId}
                className="chip"
                title="Watch the case built, from the step where this appears"
                onClick={() => {
                  if (useEditor.getState().backup && !useTrainer.getState().session) return
                  useTrainer.getState().start(r.caseId, 0, { walk: true })
                  useTrainer.getState().walkTo(r.step)
                }}
                data-testid={`case-ref:${r.caseId}`}
              >
                {r.title}
              </button>
            ))}
          </div>
        </>
      )}
    </article>
  )
}

// ---------------------------------------------------------------- mini model

type Part = { kind: string; label: string }
const KINDS = new Set(['start', 'end', 'task', 'sub', 'xor', 'and', 'or', 'evb', 'msg', 'msgEnd', 'timer', 'error', 'errEnd', 'terminate', 'data', 'store', 'note'])

/** "start > task:A | B > end" → columns of parts; a part without a kind takes the one before it. */
export function parseMini(spec: string): Part[][] {
  return spec.split(' > ').map((col) => {
    let last = 'task'
    return col.split(' | ').map((raw) => {
      const i = raw.indexOf(':')
      const head = i < 0 ? raw.trim() : raw.slice(0, i).trim()
      if (KINDS.has(head)) {
        last = head
        return { kind: head, label: i < 0 ? '' : raw.slice(i + 1).trim() }
      }
      return { kind: last, label: raw.trim() }
    })
  })
}

const COL = 84
const ROW = 64

function MiniModel({ spec }: { spec: string }) {
  const cols = parseMini(spec)
  const rows = Math.max(...cols.map((c) => c.length))
  const w = cols.length * COL
  const h = rows * ROW + 8
  const cy = (n: number, i: number) => 4 + (rows * ROW) / 2 + (i - (n - 1) / 2) * ROW - 8
  return (
    <div className="mini-model">
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="A small example">
      <defs>
        <marker id="mini-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 10 5 0 10z" fill="var(--edge)" />
        </marker>
      </defs>
      {cols.slice(1).map((col, c) =>
        col.map((p, i) =>
          cols[c].map((q, j) => {
            const x1 = c * COL + COL / 2 + half(q.kind)
            const x2 = (c + 1) * COL + COL / 2 - half(p.kind)
            return <line key={`${c}-${i}-${j}`} x1={x1} y1={cy(cols[c].length, j)} x2={x2} y2={cy(col.length, i)} stroke="var(--edge)" strokeWidth={1.2} markerEnd="url(#mini-arrow)" />
          }),
        ),
      )}
      {cols.map((col, c) => col.map((p, i) => <MiniShape key={`${c}-${i}`} part={p} x={c * COL + COL / 2} y={cy(col.length, i)} />))}
    </svg>
    </div>
  )
}

const half = (k: string) => (k === 'task' || k === 'sub' || k === 'note' ? 34 : k === 'data' || k === 'store' ? 12 : ['xor', 'and', 'or', 'evb'].includes(k) ? 15 : 12)

function MiniShape({ part, x, y }: { part: Part; x: number; y: number }) {
  const s = { fill: 'var(--shape-fill)', stroke: 'var(--shape-stroke)', strokeWidth: 1.4 }
  const text = (dy: number, t = part.label) =>
    t && (
      <text x={x} y={y + dy} textAnchor="middle" fontSize={9} fill="var(--text)">
        {t.length > 18 ? t.slice(0, 17) + '…' : t}
      </text>
    )
  const k = part.kind
  if (k === 'task' || k === 'sub')
    return (
      <g>
        <rect x={x - 34} y={y - 18} width={68} height={36} rx={6} {...s} />
        {wrap(part.label).map((line, i, all) => (
          <text key={i} x={x} y={y + 3 + (i - (all.length - 1) / 2) * 10} textAnchor="middle" fontSize={9} fill="var(--text)">
            {line}
          </text>
        ))}
        {k === 'sub' && <path d={`M${x - 5} ${y + 12}h10M${x} ${y + 7}v10`} stroke="var(--shape-stroke)" />}
      </g>
    )
  if (['xor', 'and', 'or', 'evb'].includes(k))
    return (
      <g>
        <path d={`M${x} ${y - 15}L${x + 15} ${y}L${x} ${y + 15}L${x - 15} ${y}Z`} {...s} />
        {k === 'xor' && <path d={`M${x - 5} ${y - 5}l10 10m0-10l-10 10`} stroke="var(--shape-stroke)" strokeWidth={2} />}
        {k === 'and' && <path d={`M${x - 6} ${y}h12M${x} ${y - 6}v12`} stroke="var(--shape-stroke)" strokeWidth={2} />}
        {k === 'or' && <circle cx={x} cy={y} r={6} fill="none" stroke="var(--shape-stroke)" strokeWidth={2} />}
        {k === 'evb' && <circle cx={x} cy={y} r={7} fill="none" stroke="var(--shape-stroke)" />}
        {text(27)}
      </g>
    )
  if (k === 'data')
    return (
      <g>
        <path d={`M${x - 10} ${y - 14}h14l6 6v22h-20Z`} {...s} />
        {text(28)}
      </g>
    )
  if (k === 'store')
    return (
      <g>
        <path d={`M${x - 12} ${y - 10}v20a12 4 0 0 0 24 0v-20`} {...s} />
        <ellipse cx={x} cy={y - 10} rx={12} ry={4} {...s} />
        {text(28)}
      </g>
    )
  if (k === 'note')
    return (
      <g>
        <path d={`M${x - 26} ${y - 16}h-6v32h6`} fill="none" stroke="var(--shape-stroke)" />
        {text(3)}
      </g>
    )
  // Events.
  const end = k === 'end' || k === 'msgEnd' || k === 'errEnd' || k === 'terminate'
  const inter = k === 'msg' || k === 'timer' || k === 'error'
  return (
    <g>
      <circle cx={x} cy={y} r={12} fill={end ? 'var(--event-end)' : k === 'start' ? 'var(--event-start)' : 'var(--shape-fill)'} stroke="var(--shape-stroke)" strokeWidth={end ? 3 : 1.4} />
      {inter && <circle cx={x} cy={y} r={9} fill="none" stroke="var(--shape-stroke)" />}
      {(k === 'msg' || k === 'msgEnd') && <path d={`M${x - 5} ${y - 3.5}h10v7h-10Zl5 4 5-4`} fill={k === 'msgEnd' ? 'var(--shape-stroke)' : 'none'} stroke={k === 'msgEnd' ? 'var(--shape-fill)' : 'var(--shape-stroke)'} strokeWidth={0.9} />}
      {k === 'timer' && <path d={`M${x} ${y - 4}v4h3`} fill="none" stroke="var(--shape-stroke)" />}
      {(k === 'error' || k === 'errEnd') && <path d={`M${x - 4} ${y + 4}l2-7 3 4 3-6-2 7-3-4Z`} fill={k === 'errEnd' ? 'var(--shape-stroke)' : 'none'} stroke="var(--shape-stroke)" strokeWidth={0.9} />}
      {k === 'terminate' && <circle cx={x} cy={y} r={6} fill="var(--shape-stroke)" />}
      {text(25)}
    </g>
  )
}

/** Up to three short lines for a task label. */
function wrap(s: string): string[] {
  const out: string[] = []
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const last = out.at(-1)
    if (last !== undefined && (last + ' ' + w).length <= 12) out[out.length - 1] = last + ' ' + w
    else out.push(w)
  }
  return out.slice(0, 3)
}
