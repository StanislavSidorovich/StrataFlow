// Trainer tasks (SPEC §9): the model each level starts from, the progress record and the hint ladder.
import { compareModels, type CompareItem, type CompareResult } from '../core/compare'
import { emptyModel, type FlowModel } from '../core/metamodel'
import { spanRanges, type TagSpan, type TrainerCase } from './cases'

export type Level = 0 | 1 | 2 | 3

export const LEVELS: { level: Level; title: string; task: string }[] = [
  { level: 0, title: 'Worked example', task: 'Read the text next to the finished model. Click a highlighted phrase to see the element it became and why.' },
  { level: 1, title: 'Tag the text', task: 'Click each underlined phrase and say what it becomes in the model. The model stays veiled until every phrase is tagged.' },
  { level: 2, title: 'Complete the process', task: 'The pools, lanes and tasks are given. Add the events, gateways and flows, then press Check. Stuck? Next hint.' },
  { level: 3, title: 'Build it yourself', task: 'Draw the whole process from the text, then press Check. Stuck? Next hint shows what to add next.' },
]

/** Level 0–1: the reference. Level 2: pools, lanes and activities only. Level 3: an empty canvas. */
export function levelStartModel(c: TrainerCase, level: Level): FlowModel {
  const ref = c.reference()
  if (level < 2) return ref
  if (level === 3) return emptyModel(`${c.title}: my model`)
  const keep = new Set(ref.nodes.filter((n) => n.type === 'task' || n.type === 'subProcess').map((n) => n.id))
  for (const p of ref.participants) keep.add(p.id)
  for (const l of ref.lanes) keep.add(l.id)
  return {
    ...ref,
    name: c.title,
    nodes: ref.nodes.filter((n) => keep.has(n.id)),
    flows: [],
    diagram: { shapes: Object.fromEntries(Object.entries(ref.diagram.shapes).filter(([id]) => keep.has(id))), edges: {} },
  }
}

export function compareWithCase(c: TrainerCase, mine: FlowModel): CompareResult {
  return compareModels(c.reference(), mine, { synonyms: c.synonyms, groups: c.groups })
}

/** Best score per `caseId:level`, 0–100 (level 0: 100 once read). */
export type Progress = Record<string, number>
export const progressKey = (caseId: string, level: Level) => `${caseId}:${level}`
export function recordScore(p: Progress, caseId: string, level: Level, score: number): Progress {
  const k = progressKey(caseId, level)
  return score > (p[k] ?? -1) ? { ...p, [k]: score } : p
}
/** A level counts as done from this score ✱ (the best score stays visible). */
export const DONE_AT = 80

// ---------------------------------------------------------------- level 1 score

/** Level 1: share of phrases tagged right at the first try. */
export function taggingScore(c: TrainerCase, firstTry: Record<number, boolean>): number {
  const n = c.spans.length
  return n ? Math.round((100 * Object.values(firstTry).filter(Boolean).length) / n) : 100
}

// ---------------------------------------------------------------- hints (levels 2–3)

/** One rung of the ladder: what is missing → where in the text → why → the answer. */
export interface Hint {
  key: string
  /** The rungs, mildest first. */
  steps: string[]
  /** The phrase to mark in the text from the second rung on (index into `c.spans`). */
  span?: number
}

/**
 * The next thing to work on: the first missing or different item in reference order (pools and lanes,
 * then the steps along the flow), extras last.
 */
export function nextHint(c: TrainerCase, result: CompareResult): Hint | null {
  const todo = result.items.filter((i) => i.status === 'missing' || i.status === 'different')
  const item = todo[0] ?? result.items.find((i) => i.status === 'extra')
  if (!item) return null
  const ref = c.reference()
  const names = item.ref.map((id) => ref.nodes.find((n) => n.id === id)?.name || ref.participants.find((p) => p.id === id)?.name || ref.lanes.find((l) => l.id === id)?.name).filter((x): x is string => !!x)
  // For a flow, the phrase of where it goes; else the phrase of the element itself.
  const look = item.kind === 'link' ? names.slice(-1) : names
  const span = c.spans.findIndex((s) => s.target.some((t) => look.includes(t)))
  const s: TagSpan | undefined = c.spans[span]
  const steps = [what(item, ref)]
  if (s) steps.push(`Look at “${s.phrase}” in the text.`, s.why)
  steps.push(item.text)
  return { key: item.key, steps, span: span >= 0 ? span : undefined }
}

function what(item: CompareItem, ref: FlowModel): string {
  if (item.status === 'extra') return 'Everything in the reference is there. One element of yours is not in it: is it in the text?'
  const thing: Record<CompareItem['kind'], string> = {
    pool: 'a pool',
    lane: 'a lane (a role)',
    step: 'a step (a task or an event)',
    decision: 'a gateway (a split)',
    link: 'a sequence flow (what comes next)',
    message: 'a message flow between pools',
    data: 'a data object',
  }
  const n = item.kind === 'step' ? ref.nodes.find((x) => x.id === item.ref[0]) : undefined
  const it = n ? (n.type === 'event' ? `${n.position === 'boundary' ? 'a boundary' : n.position === 'intermediate' ? 'an intermediate' : `a${n.position === 'end' ? 'n' : ''} ${n.position}`} event` : 'a task') : thing[item.kind]
  return item.status === 'missing' ? `Not there yet: ${it}.` : `Almost: ${it} needs a change.`
}

/** The text cut into plain parts and span parts, for drawing one paragraph. */
export function paragraphParts(c: TrainerCase, p: number): { text: string; span?: number }[] {
  const ranges = spanRanges(c)
    .map((r, i) => ({ ...r, i }))
    .filter((r) => c.spans[r.i].p === p && r.start >= 0)
    .sort((a, b) => a.start - b.start)
  const text = c.text[p]
  const parts: { text: string; span?: number }[] = []
  let at = 0
  for (const r of ranges) {
    if (r.start < at) continue // overlapping spans: the first wins
    if (r.start > at) parts.push({ text: text.slice(at, r.start) })
    parts.push({ text: text.slice(r.start, r.end), span: r.i })
    at = r.end
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}
