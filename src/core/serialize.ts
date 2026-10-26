// `*.flow.json`: the model as JSON (SPEC §10). Reading checks the shape and every reference, so a
// hand-written or generated file that would break the canvas is refused with a clear message.
import type { FlowModel, Review, ReviewFix, ReviewNote } from './metamodel'

export const FILE_EXTENSION = '.flow.json'

export class ModelFormatError extends Error {}

export function serializeModel(m: FlowModel): string {
  return JSON.stringify(m, null, 2) + '\n'
}

const NODE_TYPES = ['task', 'subProcess', 'event', 'gateway', 'dataObject', 'dataStore', 'annotation']
const FLOW_KINDS = ['sequence', 'message', 'association', 'data']

export function parseModel(text: string): FlowModel {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new ModelFormatError(`Not JSON: ${(e as Error).message}`)
  }
  const m = raw as FlowModel
  const fail = (msg: string): never => {
    throw new ModelFormatError(msg)
  }
  if (!m || typeof m !== 'object' || m.format !== 'strata-flow') fail('Not a Quaera Flow model (format must be "strata-flow")')
  if (m.version !== 1) fail(`Unknown version ${String(m.version)}`)
  for (const key of ['participants', 'lanes', 'nodes', 'flows'] as const) if (!Array.isArray(m[key])) fail(`"${key}" must be a list`)
  m.name = typeof m.name === 'string' ? m.name : ''
  m.diagram ??= { shapes: {}, edges: {} }
  m.diagram.shapes ??= {}
  m.diagram.edges ??= {}

  const ids = new Set<string>()
  const add = (id: unknown, what: string) => {
    if (typeof id !== 'string' || !id) fail(`A ${what} has no id`)
    if (ids.has(id as string)) fail(`Duplicate id ${String(id)}`)
    ids.add(id as string)
  }
  for (const p of m.participants) add(p.id, 'pool')
  for (const l of m.lanes) add(l.id, 'lane')
  for (const n of m.nodes) {
    add(n.id, 'node')
    if (!NODE_TYPES.includes(n.type)) fail(`${n.id}: unknown type "${n.type}"`)
  }
  for (const f of m.flows) {
    add(f.id, 'flow')
    if (!FLOW_KINDS.includes(f.kind)) fail(`${f.id}: unknown flow kind "${f.kind}"`)
  }
  const pools = new Set(m.participants.map((p) => p.id))
  const lanes = new Set(m.lanes.map((l) => l.id))
  const nodes = new Set(m.nodes.map((n) => n.id))
  for (const l of m.lanes) {
    if (l.participantId && !pools.has(l.participantId)) fail(`Lane ${l.id}: no pool ${l.participantId}`)
    if (l.parentLaneId && !lanes.has(l.parentLaneId)) fail(`Lane ${l.id}: no lane ${l.parentLaneId}`)
  }
  for (const n of m.nodes) {
    n.name ??= ''
    if (n.participantId && !pools.has(n.participantId)) fail(`${n.id}: no pool ${n.participantId}`)
    if (n.laneId && !lanes.has(n.laneId)) fail(`${n.id}: no lane ${n.laneId}`)
    if (n.parentId && !nodes.has(n.parentId)) fail(`${n.id}: no sub-process ${n.parentId}`)
    if (n.type === 'event' && n.attachedTo && !nodes.has(n.attachedTo)) fail(`${n.id}: no activity ${n.attachedTo}`)
  }
  for (const f of m.flows) {
    f.name ??= ''
    for (const end of [f.source, f.target]) if (!nodes.has(end) && !pools.has(end)) fail(`Flow ${f.id}: no element ${end}`)
  }
  if (m.review !== undefined) m.review = parseReview(m.review, fail)
  return m
}

function parseReview(r: unknown, fail: (msg: string) => never): Review {
  const x = r as Review
  if (!x || typeof x !== 'object' || !x.base) fail('"review" must have the earlier version as "base"')
  let base: FlowModel
  try {
    base = parseModel(JSON.stringify(x.base))
  } catch (e) {
    return fail(`The earlier version in "review": ${(e as Error).message}`)
  }
  delete base.review
  const notes: Record<string, ReviewNote> = {}
  for (const [k, v] of Object.entries(x.notes ?? {})) {
    if (!v || typeof v !== 'object') continue
    const note: ReviewNote = {}
    if (typeof v.text === 'string' && v.text) note.text = v.text
    if (typeof v.quote === 'string' && v.quote) note.quote = v.quote
    if (note.text || note.quote) notes[k] = note
  }
  const out: Review = { base, notes: notes.general ? { general: notes.general } : {} }
  const fixes: ReviewFix[] = []
  if (Array.isArray(x.fixes))
    for (const f of x.fixes) {
      if (!f || typeof f !== 'object' || typeof f.id !== 'string' || !Array.isArray(f.keys)) continue
      const fix: ReviewFix = { id: f.id, keys: f.keys.filter((k) => typeof k === 'string') }
      if (typeof f.text === 'string' && f.text) fix.text = f.text
      if (typeof f.quote === 'string' && f.quote) fix.quote = f.quote
      fixes.push(fix)
    }
  // Before v0.7 a note belonged to one change: each becomes a fix of that change, in the order they were written.
  for (const [k, n] of Object.entries(notes)) {
    if (k === 'general' || fixes.some((f) => f.keys.includes(k))) continue
    let i = fixes.length + 1
    while (fixes.some((f) => f.id === `fix${i}`)) i++
    fixes.push({ id: `fix${i}`, keys: [k], ...n })
  }
  if (fixes.length) out.fixes = fixes
  if (Array.isArray(x.unpair) && x.unpair.length) out.unpair = x.unpair.filter((u) => typeof u === 'string')
  return out
}
