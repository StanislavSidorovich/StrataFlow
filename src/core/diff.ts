// What changed between two versions of a process: a classmate's draft and the corrected copy, an AS-IS and
// its TO-BE, an earlier and a later version (Word's "compare documents" for BPMN). Same idea as Quaera Model's
// changes.ts: each added, changed or removed element gets a number in the order the process reads, so the
// list and the diagram point at each other, and each number can carry a note.
//
// Matching: a copy made in Flow keeps its ids, so ids pair the elements exactly. Two models drawn apart (or
// ids that only look alike, `Task_3` in both) are paired the way the trainer pairs a student's model with a
// reference (compare.ts: names, then the place between the same neighbours), gateways by their neighbours.
// Sequence flows are not listed one by one: a step that now comes after another step is one change of that
// step ("now after Transfer funds, was after Approve claim"); flows to an added step come with that step.
import { compareModels, nameSimilarity } from './compare'
import { isArtifact, type EventTrigger, type Flow, type FlowModel, type FlowNode, type GatewayKind, type LoopKind, type TaskKind } from './metamodel'

export type ChangeStatus = 'added' | 'removed' | 'changed' | 'comment'
export type ChangeKind = 'pool' | 'lane' | 'node' | 'flow'

export interface Change {
  /** `r:<id>` for an element of the revised model, `b:<id>` for one only in the base: notes are kept by it. */
  key: string
  status: ChangeStatus
  kind: ChangeKind
  /** The element in the revised model (absent when removed). */
  id?: string
  /** The element in the base (absent when added). */
  baseId?: string
  /** “Validate claim”, Exclusive gateway, Message “Send invoice” → “Customer”. */
  label: string
  /** What differs, one short line each. */
  details: string[]
  /** Paired with the base by its place only and named otherwise: the same step in other words, or not? */
  uncertain?: boolean
  /** 1, 2, 3… in the order the process reads. */
  n: number
}

export interface ModelDiff {
  changes: Change[]
  /** Base id → revised id. */
  map: Record<string, string>
  /** The revised model is a copy of the base (ids pair them): the base's coordinates are this drawing's too. */
  sameDrawing: boolean
  counts: Record<'added' | 'removed' | 'changed', number>
  /** Elements of the base still there unchanged. */
  kept: number
}

export interface DiffOptions {
  /** Revised ids that must not be paired by place (the user said: not the same). */
  unpair?: string[]
  /** Element ids (revised: `r:`, base: `b:`) with a note: an unchanged one is listed as a comment. */
  notes?: Iterable<string>
}

// ---------------------------------------------------------------- words

const TASK_WORD: Record<TaskKind, string> = {
  task: 'task',
  user: 'user task',
  service: 'service task',
  manual: 'manual task',
  send: 'send task',
  receive: 'receive task',
  script: 'script task',
  businessRule: 'business rule task',
}
const GATEWAY_WORD: Record<GatewayKind, string> = {
  exclusive: 'exclusive (X)',
  parallel: 'parallel (+)',
  inclusive: 'inclusive (O)',
  eventBased: 'event-based',
  complex: 'complex',
}
const LOOP_WORD: Record<LoopKind, string> = { standard: 'loop', parallel: 'parallel multi-instance', sequential: 'sequential multi-instance' }
const triggerWord = (t: EventTrigger) => (t === 'none' ? 'plain' : t)

/** What a node is, in a few words: “user task”, “timer start event”, “exclusive (X) gateway”. */
export function kindWords(n: FlowNode): string {
  switch (n.type) {
    case 'task':
      return TASK_WORD[n.kind]
    case 'subProcess':
      return 'sub-process'
    case 'event':
      return `${n.trigger === 'none' ? '' : `${n.trigger} `}${n.position}${n.position === 'intermediate' ? (n.throwing ? ' throwing' : ' catching') : ''} event`
    case 'gateway':
      return `${GATEWAY_WORD[n.kind]} gateway`
    case 'dataObject':
      return 'data object'
    case 'dataStore':
      return 'data store'
    case 'annotation':
      return 'annotation'
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const q = (s: string) => `“${s}”`
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const nodeLabel = (n: FlowNode) => (n.type === 'annotation' ? `Annotation ${q(short(n.name))}` : n.name.trim() ? q(norm(n.name)) : cap(kindWords(n)))
const short = (s: string) => (norm(s).length > 40 ? `${norm(s).slice(0, 38)}…` : norm(s))
const list = (names: string[]) => names.join(', ')
/** "Renamed from …", or only the capital letters changed (the course writes names with a capital first letter). */
const renamed = (was: string) => (now: string) => (norm(was).toLowerCase() === norm(now).toLowerCase() ? `Capital letters: was ${q(norm(was))}` : `Renamed from ${q(norm(was))}`)

// ---------------------------------------------------------------- matching

type Cat = 'node' | 'pool' | 'lane' | 'flow'

function elements(m: FlowModel): Map<string, { cat: Cat; name: string }> {
  const out = new Map<string, { cat: Cat; name: string }>()
  for (const p of m.participants) out.set(p.id, { cat: 'pool', name: p.name })
  for (const l of m.lanes) out.set(l.id, { cat: 'lane', name: l.name })
  for (const n of m.nodes) out.set(n.id, { cat: 'node', name: n.name })
  for (const f of m.flows) out.set(f.id, { cat: 'flow', name: f.name })
  return out
}

/** Do the shared ids mean the same elements (a copy), or only the same numbering (`Task_3` in two drawings)? */
function isCopy(base: FlowModel, rev: FlowModel): boolean {
  const B = elements(base)
  const R = elements(rev)
  let common = 0
  let named = 0
  let agree = 0
  for (const [id, b] of B) {
    const r = R.get(id)
    if (!r || r.cat !== b.cat) continue
    common++
    if (b.cat === 'flow' || !b.name.trim() || !r.name.trim()) continue
    named++
    if (norm(b.name) === norm(r.name) || nameSimilarity(b.name, r.name) >= 0.5) agree++
  }
  if (!common) return false
  return named ? agree >= named / 2 : common >= Math.min(B.size, R.size) / 2
}

class Links {
  readonly byId = new Map<string, FlowNode>()
  readonly out = new Map<string, Flow[]>()
  readonly inc = new Map<string, Flow[]>()
  constructor(readonly m: FlowModel) {
    for (const n of m.nodes) this.byId.set(n.id, n)
    for (const f of m.flows) {
      if (f.kind !== 'sequence') continue
      ;(this.out.get(f.source) ?? this.out.set(f.source, []).get(f.source)!).push(f)
      ;(this.inc.get(f.target) ?? this.inc.set(f.target, []).get(f.target)!).push(f)
    }
  }
  /** The steps right before a node, looking through gateways and through the nodes in `through`. */
  before(id: string, through: Set<string>): Set<string> {
    const found = new Set<string>()
    const seen = new Set<string>([id])
    const walk = (from: string) => {
      if (seen.has(from)) return
      seen.add(from)
      const n = this.byId.get(from)
      if (!n) return
      if (n.type === 'gateway' || through.has(from)) for (const f of this.inc.get(from) ?? []) walk(f.source)
      else found.add(from)
    }
    for (const f of this.inc.get(id) ?? []) walk(f.source)
    return found
  }
  /** Reading order: breadth first from the start events, boundary events after their host, the rest after. */
  order(): Map<string, number> {
    const order = new Map<string, number>()
    const take = (id: string) => !order.has(id) && (order.set(id, order.size), true)
    const queue = this.m.nodes.filter((n) => n.type === 'event' && n.position === 'start' && !n.parentId).map((n) => n.id)
    queue.push(...this.m.nodes.filter((n) => n.type === 'event' && n.position === 'start' && n.parentId).map((n) => n.id))
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]
      take(id)
      // A sub-process's content reads right after it.
      for (const c of this.m.nodes) if (c.parentId === id && c.type === 'event' && c.position === 'start' && take(c.id)) queue.splice(i + 1, 0, c.id)
      for (const f of this.out.get(id) ?? []) if (take(f.target)) queue.push(f.target)
      for (const b of this.m.nodes) if (b.type === 'event' && b.attachedTo === id && take(b.id)) queue.push(b.id)
    }
    for (const n of this.m.nodes) take(n.id)
    return order
  }
}

// ---------------------------------------------------------------- the diff

export function diffModels(base: FlowModel, rev: FlowModel, opts: DiffOptions = {}): ModelDiff {
  const unpair = new Set(opts.unpair ?? [])
  const map = new Map<string, string>() // base → revised
  const back = new Map<string, string>() // revised → base
  const uncertain = new Set<string>() // revised ids
  const pair = (b: string, r: string) => {
    if (map.has(b) || back.has(r) || unpair.has(r)) return false
    map.set(b, r)
    back.set(r, b)
    return true
  }
  const B = new Links(base)
  const R = new Links(rev)
  const bNode = (id: string) => B.byId.get(id)
  const rNode = (id: string) => R.byId.get(id)

  // 1. Ids, when the revised model is a copy of the base.
  const sameDrawing = isCopy(base, rev)
  if (sameDrawing) {
    const R2 = elements(rev)
    for (const [id, b] of elements(base)) if (R2.get(id)?.cat === b.cat) pair(id, id)
  }

  // 2. The trainer's matching for the rest: pools, lanes, steps and data by name, then by place.
  const cmp = compareModels(base, rev)
  for (const [b, r] of Object.entries(cmp.map)) {
    const bn = bNode(b)
    const rn = rNode(r)
    if (bn && rn && bn.type !== 'gateway' && rn.type === 'gateway') continue
    if (!pair(b, r)) continue
    if (bn && rn && bn.name.trim() && rn.name.trim() && norm(bn.name) !== norm(rn.name) && nameSimilarity(bn.name, rn.name) < 0.5) uncertain.add(r)
  }

  // 3. Gateways (and annotations) the comparison leaves: by name, then by the neighbours they join.
  const freeB = (pred: (n: FlowNode) => boolean) => base.nodes.filter((n) => pred(n) && !map.has(n.id))
  const freeR = (pred: (n: FlowNode) => boolean) => rev.nodes.filter((n) => pred(n) && !back.has(n.id) && !unpair.has(n.id))
  const byName = (pred: (n: FlowNode) => boolean) => {
    const pairs: [number, string, string][] = []
    for (const b of freeB(pred)) for (const r of freeR(pred)) {
      if (!b.name.trim() || !r.name.trim()) continue
      const s = norm(b.name) === norm(r.name) ? 2 : nameSimilarity(b.name, r.name)
      if (s >= 0.5) pairs.push([s, b.id, r.id])
    }
    pairs.sort((x, y) => y[0] - x[0])
    for (const [, b, r] of pairs) pair(b, r)
  }
  const isGateway = (n: FlowNode) => n.type === 'gateway'
  byName(isGateway)
  byName((n) => n.type === 'annotation')
  for (let pass = 0; pass < 3; pass++) {
    let changed = false
    for (const b of freeB(isGateway)) {
      const ins = new Set((B.inc.get(b.id) ?? []).map((f) => map.get(f.source)).filter(Boolean))
      const outs = new Set((B.out.get(b.id) ?? []).map((f) => map.get(f.target)).filter(Boolean))
      let best: { id: string; score: number } | undefined
      for (const r of freeR(isGateway)) {
        const score = (R.inc.get(r.id) ?? []).filter((f) => ins.has(f.source)).length + (R.out.get(r.id) ?? []).filter((f) => outs.has(f.target)).length
        if (score && (!best || score > best.score)) best = { id: r.id, score }
      }
      if (best && pair(b.id, best.id)) changed = true
    }
    if (!changed) break
  }

  // 4. Flows: by their ends (a message to a pool may now touch a step in it), of the same kind.
  const poolOf = (m: Links, id: string) => m.byId.get(id)?.participantId
  for (const kind of ['sequence', 'message', 'data', 'association'] as const) {
    const bs = base.flows.filter((f) => f.kind === kind && !map.has(f.id))
    const rs = rev.flows.filter((f) => f.kind === kind && !back.has(f.id))
    const fits = (b: string, r: string) => map.get(b) === r || (kind === 'message' && (map.get(b) === poolOf(R, r) || map.get(poolOf(B, b) ?? '') === r))
    for (const strict of [true, false])
      for (const b of bs) {
        if (map.has(b.id)) continue
        const r = rs.find((x) => !back.has(x.id) && (strict ? map.get(b.source) === x.source && map.get(b.target) === x.target : fits(b.source, x.source) && fits(b.target, x.target)))
        if (r) pair(b.id, r.id)
      }
    // A message drawn the other way round.
    if (kind === 'message')
      for (const b of bs) {
        if (map.has(b.id)) continue
        const r = rs.find((x) => !back.has(x.id) && fits(b.source, x.target) && fits(b.target, x.source))
        if (r) pair(b.id, r.id)
      }
  }

  // ---------------------------------------------------------------- what changed
  const added = new Set(rev.nodes.filter((n) => !back.has(n.id)).map((n) => n.id))
  const removed = new Set(base.nodes.filter((n) => !map.has(n.id)).map((n) => n.id))
  const changes: Omit<Change, 'n'>[] = []
  const byKey = new Map<string, Omit<Change, 'n'>>()
  const put = (c: Omit<Change, 'n'>) => {
    const had = byKey.get(c.key)
    if (had) return void had.details.push(...c.details)
    changes.push(c)
    byKey.set(c.key, c)
  }
  /** Details that ride along with an added or removed node's change (its flows, messages, data links). */
  const along = (key: string, line: string) => byKey.get(key)?.details.push(line)
  const unit = rev.sim?.unit ?? base.sim?.unit ?? 'h'
  const laneName = (m: FlowModel, id?: string) => (id ? m.lanes.find((l) => l.id === id)?.name : undefined)
  const poolName = (m: FlowModel, id?: string) => (id ? m.participants.find((p) => p.id === id)?.name : undefined)
  const endName = (m: FlowModel, id: string) => {
    const n = m.nodes.find((x) => x.id === id)
    if (n) return nodeLabel(n)
    const p = m.participants.find((x) => x.id === id)
    return p ? `pool ${q(p.name || 'without a name')}` : '?'
  }
  const where = (m: FlowModel, n: FlowNode) => {
    const lane = laneName(m, n.laneId)
    const pool = poolName(m, n.participantId)
    const parent = n.parentId ? m.nodes.find((x) => x.id === n.parentId) : undefined
    return [lane ? `lane ${q(lane)}` : pool ? `pool ${q(pool)}` : '', parent ? `inside ${nodeLabel(parent)}` : ''].filter(Boolean).join(', ')
  }

  // --- pools and lanes
  for (const p of rev.participants) {
    const b = back.get(p.id)
    const bp = b ? base.participants.find((x) => x.id === b) : undefined
    if (!bp) put({ key: `r:${p.id}`, status: 'added', kind: 'pool', id: p.id, label: `Pool ${q(p.name || 'without a name')}`, details: [p.processId && rev.nodes.some((n) => n.participantId === p.id) ? 'A new participant with its steps' : 'A new participant (black box: only its messages are drawn)'] })
    else if (norm(bp.name) !== norm(p.name)) put({ key: `r:${p.id}`, status: 'changed', kind: 'pool', id: p.id, baseId: bp.id, label: `Pool ${q(p.name)}`, details: [renamed(bp.name)(p.name)] })
  }
  for (const p of base.participants) if (!map.has(p.id)) put({ key: `b:${p.id}`, status: 'removed', kind: 'pool', baseId: p.id, label: `Pool ${q(p.name || 'without a name')}`, details: ['No longer drawn'] })
  for (const l of rev.lanes) {
    const b = back.get(l.id)
    const bl = b ? base.lanes.find((x) => x.id === b) : undefined
    if (!bl) {
      put({ key: `r:${l.id}`, status: 'added', kind: 'lane', id: l.id, label: `Lane ${q(l.name || 'without a name')}`, details: [`A new role${l.participantId ? ` in pool ${q(poolName(rev, l.participantId) ?? '')}` : ''}`] })
      continue
    }
    const d: string[] = []
    if (norm(bl.name) !== norm(l.name)) d.push(renamed(bl.name)(l.name))
    if ((bl.capacity ?? 1) !== (l.capacity ?? 1)) d.push(`Capacity ${bl.capacity ?? 1} → ${l.capacity ?? 1}`)
    if (d.length) put({ key: `r:${l.id}`, status: 'changed', kind: 'lane', id: l.id, baseId: bl.id, label: `Lane ${q(l.name)}`, details: d })
  }
  for (const l of base.lanes) if (!map.has(l.id)) put({ key: `b:${l.id}`, status: 'removed', kind: 'lane', baseId: l.id, label: `Lane ${q(l.name || 'without a name')}`, details: ['No longer drawn'] })

  // --- nodes
  const stepsBefore = (m: Links, id: string, through: Set<string>) => [...m.before(id, through)]
  for (const r of rev.nodes) {
    const key = `r:${r.id}`
    if (added.has(r.id)) {
      const before = stepsBefore(R, r.id, added).map((x) => nodeLabel(rNode(x)!))
      const host = r.type === 'event' && r.attachedTo ? rNode(r.attachedTo) : undefined
      const at = [where(rev, r), host ? `on ${nodeLabel(host)}` : before.length ? `after ${list(before)}` : ''].filter(Boolean).join(', ')
      put({ key, status: 'added', kind: 'node', id: r.id, label: nodeLabel(r), details: [`${cap(kindWords(r))}${at ? ` in ${at}` : ''}`.replace(' in on ', ' on ').replace(' in after ', ' after ')] })
      continue
    }
    const b = bNode(back.get(r.id)!)!
    const d = nodeDetails(b, r)
    // Where it sits.
    const wantLane = b.laneId ? map.get(b.laneId) : undefined
    if ((b.laneId || r.laneId) && wantLane !== r.laneId) d.push(`Moved from lane ${q(laneName(base, b.laneId) ?? '?')} to ${r.laneId ? q(laneName(rev, r.laneId) ?? '?') : 'no lane'}`)
    else if (!b.laneId && !r.laneId && (b.participantId ? map.get(b.participantId) : undefined) !== r.participantId)
      d.push(`Moved from pool ${q(poolName(base, b.participantId) ?? '?')} to ${q(poolName(rev, r.participantId) ?? '?')}`)
    const wantParent = b.parentId ? map.get(b.parentId) : undefined
    if (wantParent !== r.parentId)
      d.push(r.parentId ? `Moved into ${nodeLabel(rNode(r.parentId)!)}` : `Moved out of ${nodeLabel(bNode(b.parentId!)!)}`)
    if (b.type === 'event' && r.type === 'event' && (b.attachedTo ? map.get(b.attachedTo) : undefined) !== r.attachedTo)
      d.push(r.attachedTo ? `Now on ${nodeLabel(rNode(r.attachedTo)!)}${b.attachedTo ? ` (was on ${nodeLabel(bNode(b.attachedTo)!)})` : ''}` : 'No longer on the border of an activity')
    // What comes before it: the order of the steps.
    if (!isArtifact(r) && r.type !== 'gateway' && !(r.type === 'event' && r.attachedTo)) {
      const was = stepsBefore(B, b.id, removed)
      const now = stepsBefore(R, r.id, added)
      const wasMapped = new Set(was.map((x) => map.get(x) ?? `b:${x}`))
      if (was.length !== now.length || now.some((x) => !wasMapped.has(x))) {
        const nowNames = now.map((x) => nodeLabel(rNode(x)!))
        const wasNames = was.map((x) => nodeLabel(bNode(x)!))
        d.push(now.length ? `Now after ${list(nowNames)}${was.length ? ` (was after ${list(wasNames)})` : ''}` : `Nothing leads to it now (was after ${list(wasNames)})`)
      }
    }
    const fig = figureDetails(b, r, unit)
    d.push(...fig)
    if (d.length) put({ key, status: 'changed', kind: 'node', id: r.id, baseId: b.id, label: nodeLabel(r), details: d, ...(uncertain.has(r.id) ? { uncertain: true } : {}) })
  }
  for (const b of base.nodes) {
    if (!removed.has(b.id)) continue
    const before = stepsBefore(B, b.id, removed).map((x) => nodeLabel(bNode(x)!))
    const host = b.type === 'event' && b.attachedTo ? bNode(b.attachedTo) : undefined
    const at = [where(base, b), host ? `on ${nodeLabel(host)}` : before.length ? `after ${list(before)}` : ''].filter(Boolean).join(', ')
    put({ key: `b:${b.id}`, status: 'removed', kind: 'node', baseId: b.id, label: nodeLabel(b), details: [`${cap(kindWords(b))}${at ? ` (was in ${at})` : ''}`.replace('was in on ', 'was on ').replace('was in after ', 'was after ')] })
  }

  // --- flows: labels, conditions, defaults, shares; messages; data links
  const endFits = (b: string, r: string) => map.get(b) === r || map.get(b) === poolOf(R, r) || map.get(poolOf(B, b) ?? '') === r
  const defaultOf = (m: Links, f: Flow) => {
    const s = m.byId.get(f.source)
    return s?.type === 'gateway' && s.defaultFlow === f.id
  }
  // A gateway of another kind drops its conditions and default (updateNode does): that is part of the kind change.
  const kindChanged = new Set(rev.nodes.filter((n) => n.type === 'gateway' && back.has(n.id) && (bNode(back.get(n.id)!) as FlowNode).type === 'gateway' && (bNode(back.get(n.id)!) as { kind: GatewayKind }).kind !== n.kind).map((n) => n.id))
  for (const f of rev.flows) {
    const b = back.get(f.id)
    const bf = b ? base.flows.find((x) => x.id === b) : undefined
    const touchesAdded = added.has(f.source) || added.has(f.target)
    const label = `${f.kind === 'message' ? 'Message ' : ''}${endName(rev, f.source)} → ${endName(rev, f.target)}`
    if (!bf) {
      if (f.kind === 'sequence') continue // the order of the steps says it
      const ride = [f.source, f.target].find((x) => added.has(x))
      const other = ride === f.source ? endName(rev, f.target) : endName(rev, f.source)
      const line = f.kind === 'message' ? (ride === f.source ? `Sends a message to ${other}` : `Gets a message from ${other}`) : `Linked to ${other}`
      if (ride) along(`r:${ride}`, line)
      else if (f.kind === 'message') put({ key: `r:${f.id}`, status: 'added', kind: 'flow', id: f.id, label, details: [f.name ? `A new message flow ${q(f.name)}` : 'A new message flow'] })
      else {
        // A data link or a note's line between elements that were there: a change of the data or note.
        const art = [f.source, f.target].find((x) => rNode(x) && isArtifact(rNode(x)!)) ?? f.source
        const to = art === f.source ? f.target : f.source
        put({ key: `r:${art}`, status: 'changed', kind: 'node', id: art, baseId: back.get(art), label: nodeLabel(rNode(art)!), details: [`Now linked to ${endName(rev, to)}`] })
      }
      continue
    }
    if (touchesAdded) continue
    const d: string[] = []
    if (norm(bf.name) !== norm(f.name)) d.push(f.name.trim() ? (bf.name.trim() ? `Label ${q(norm(bf.name))} → ${q(norm(f.name))}` : `Labelled ${q(norm(f.name))}`) : `Label ${q(norm(bf.name))} removed`)
    const ownChange = !kindChanged.has(f.source)
    if (ownChange && norm(bf.condition ?? '') !== norm(f.condition ?? '')) d.push(f.condition ? `Condition ${q(f.condition)}${bf.condition ? ` (was ${q(bf.condition)})` : ''}` : 'Condition removed')
    if (ownChange && defaultOf(B, bf) !== defaultOf(R, f)) d.push(defaultOf(R, f) ? 'Now the default way' : 'No longer the default way')
    if (f.kind === 'message' && !(endFits(bf.source, f.source) && endFits(bf.target, f.target)) && endFits(bf.source, f.target)) d.push('Now goes the other way')
    if (bf.probability !== undefined || f.probability !== undefined)
      if (!near(bf.probability, f.probability)) d.push(`Share ${pct(bf.probability)} → ${pct(f.probability)}`)
    if (d.length) put({ key: `r:${f.id}`, status: 'changed', kind: 'flow', id: f.id, baseId: bf.id, label, details: d })
  }
  for (const f of base.flows) {
    if (map.has(f.id) || f.kind === 'sequence') continue
    const ride = [f.source, f.target].find((x) => removed.has(x))
    const other = ride === f.source ? endName(base, f.target) : endName(base, f.source)
    if (ride) along(`b:${ride}`, f.kind === 'message' ? (ride === f.source ? `Sent a message to ${other}` : `Got a message from ${other}`) : `Was linked to ${other}`)
    else if (f.kind === 'message') put({ key: `b:${f.id}`, status: 'removed', kind: 'flow', baseId: f.id, label: `Message ${endName(base, f.source)} → ${endName(base, f.target)}`, details: ['No longer drawn'] })
    else {
      const art = [f.source, f.target].find((x) => bNode(x) && isArtifact(bNode(x)!)) ?? f.source
      const to = art === f.source ? f.target : f.source
      const r = map.get(art)
      if (r) put({ key: `r:${r}`, status: 'changed', kind: 'node', id: r, baseId: art, label: nodeLabel(rNode(r)!), details: [`No longer linked to ${endName(base, to)}`] })
    }
  }

  // --- notes on elements that did not change: comments
  for (const k of opts.notes ?? []) {
    if (byKey.has(k) || !k.startsWith('r:')) continue
    const id = k.slice(2)
    const n = rNode(id)
    const p = rev.participants.find((x) => x.id === id)
    const l = rev.lanes.find((x) => x.id === id)
    const f = rev.flows.find((x) => x.id === id)
    const label = n ? nodeLabel(n) : p ? `Pool ${q(p.name)}` : l ? `Lane ${q(l.name)}` : f ? `${endName(rev, f.source)} → ${endName(rev, f.target)}` : null
    if (label) put({ key: k, status: 'comment', kind: n ? 'node' : p ? 'pool' : l ? 'lane' : 'flow', id, baseId: back.get(id), label, details: [] })
  }

  // ---------------------------------------------------------------- numbers in reading order
  const rOrder = R.order()
  const bOrder = B.order()
  const rank = (c: Omit<Change, 'n'>): number => {
    if (c.kind === 'pool') return -2000 + (c.id ? rev.participants.findIndex((p) => p.id === c.id) : 500)
    if (c.kind === 'lane') return -1000 + (c.id ? rev.lanes.findIndex((l) => l.id === c.id) : 500)
    const nodeRank = (id: string | undefined): number | undefined => (id && rOrder.has(id) ? rOrder.get(id)! : undefined)
    const baseRank = (id: string): number => {
      // A base element sits right after the nearest element before it that is still there.
      const at = bOrder.get(id) ?? 1e6
      let best = -0.5
      for (const [bid, o] of bOrder) if (o < at && map.has(bid) && rOrder.has(map.get(bid)!)) best = Math.max(best, rOrder.get(map.get(bid)!)!)
      return best + 0.5
    }
    if (c.kind === 'flow') {
      const f = c.id ? rev.flows.find((x) => x.id === c.id) : undefined
      if (f) return Math.min(nodeRank(f.source) ?? 1e6, nodeRank(f.target) ?? 1e6) + 0.3
      const bf = base.flows.find((x) => x.id === c.baseId)
      return bf ? Math.min(...[bf.source, bf.target].map((x) => (map.has(x) ? (nodeRank(map.get(x)) ?? 1e6) : baseRank(x)))) + 0.3 : 1e6
    }
    return c.id ? (nodeRank(c.id) ?? 1e6) : baseRank(c.baseId!)
  }
  const ranked = changes.map((c, i) => ({ c, r: rank(c), i })).sort((x, y) => x.r - y.r || x.i - y.i)
  const numbered = ranked.map(({ c }, i) => ({ ...c, n: i + 1 }))
  const counts = { added: 0, removed: 0, changed: 0 }
  for (const c of numbered) if (c.status !== 'comment') counts[c.status]++
  const touched = new Set(numbered.filter((c) => c.status !== 'comment' && c.baseId).map((c) => c.baseId))
  const kept = [...base.nodes, ...base.participants, ...base.lanes].filter((x) => map.has(x.id) && !touched.has(x.id)).length
  return { changes: numbered, map: Object.fromEntries(map), sameDrawing, counts, kept }
}

function nodeDetails(b: FlowNode, r: FlowNode): string[] {
  const d: string[] = []
  if (norm(b.name) !== norm(r.name))
    d.push(r.type === 'annotation' ? 'Text changed' : r.name.trim() ? (b.name.trim() ? renamed(b.name)(r.name) : 'Named') : `Name ${q(norm(b.name))} removed`)
  if (b.type !== r.type) {
    d.push(`${cap(kindWords(b))} → ${kindWords(r)}`)
    return d
  }
  if (b.type === 'task' && r.type === 'task' && b.kind !== r.kind) d.push(`${cap(TASK_WORD[b.kind])} → ${TASK_WORD[r.kind]}`)
  if (b.type === 'gateway' && r.type === 'gateway' && b.kind !== r.kind) d.push(`Gateway ${GATEWAY_WORD[b.kind]} → ${GATEWAY_WORD[r.kind]}`)
  if (b.type === 'event' && r.type === 'event') {
    if (b.position !== r.position) d.push(`${cap(b.position)} event → ${r.position} event`)
    if (b.trigger !== r.trigger) d.push(`Trigger ${triggerWord(b.trigger)} → ${triggerWord(r.trigger)}`)
    if (b.position === r.position && r.position === 'intermediate' && b.throwing !== r.throwing) d.push(r.throwing ? 'Now sends (throwing), was waiting (catching)' : 'Now waits (catching), was sending (throwing)')
    if (b.position === r.position && (b.interrupting ?? true) !== (r.interrupting ?? true)) d.push(r.interrupting === false ? 'Now non-interrupting (dashed)' : 'Now interrupting')
  }
  if ((b.type === 'task' || b.type === 'subProcess') && (r.type === 'task' || r.type === 'subProcess') && (b.loop ?? '') !== (r.loop ?? ''))
    d.push(r.loop ? `Repeats: ${LOOP_WORD[r.loop]}${b.loop ? ` (was ${LOOP_WORD[b.loop]})` : ''}` : `No longer repeats (was ${LOOP_WORD[b.loop!]})`)
  if (b.type === 'dataObject' && r.type === 'dataObject' && (b.state ?? '') !== (r.state ?? '')) d.push(`State ${q(b.state ?? '')} → ${q(r.state ?? '')}`)
  return d
}

const FIGURES = [
  ['duration', 'Work'],
  ['wait', 'Waiting'],
  ['cost', 'Cost'],
  ['repeats', 'Runs per visit'],
] as const

function figureDetails(b: FlowNode, r: FlowNode, unit: string): string[] {
  const d: string[] = []
  for (const [k, word] of FIGURES) {
    const x = b.sim?.[k]
    const y = r.sim?.[k]
    if ((x !== undefined || y !== undefined) && !near(x, y)) d.push(`${word} ${num(x, k, unit)} → ${num(y, k, unit)}`)
  }
  return d
}

const near = (a: number | undefined, b: number | undefined) => a === b || (a !== undefined && b !== undefined && Math.abs(a - b) <= 0.005 + 0.005 * Math.abs(a))
const num = (v: number | undefined, k: string, unit: string) => (v === undefined ? 'not set' : `${Math.round(v * 100) / 100}${k === 'duration' || k === 'wait' ? ` ${unit}` : ''}`)
const pct = (p: number | undefined) => (p === undefined ? 'not set' : `${Math.round(p * 1000) / 10} %`)

// ---------------------------------------------------------------- the review kept in the model (edits, one undo step each)

/** The model without its review: what a review compares with its base, and what becomes the next base. */
export function withoutReview(m: FlowModel): FlowModel {
  const { review: _r, ...rest } = m
  return rest
}

/** Compare this model with an earlier version from now on (it replaces an earlier comparison). */
export function startReview(m: FlowModel, base: FlowModel): void {
  m.review = { base: structuredClone(withoutReview(base)), notes: {} }
}

/** A copy of a model to correct, with the model as its base: a classmate's draft, reviewed. */
export function reviewCopy(m: FlowModel): FlowModel {
  const copy = structuredClone(withoutReview(m))
  copy.name = `${m.name || 'Process'} (review)`
  startReview(copy, m)
  return copy
}

/** Changes a note (empty texts remove it). */
export function setReviewNote(m: FlowModel, key: string, patch: { text?: string; quote?: string }): void {
  if (!m.review) return
  const note = { ...m.review.notes[key], ...patch }
  if (!note.text) delete note.text
  if (!note.quote) delete note.quote
  if (note.text || note.quote) m.review.notes[key] = note
  else delete m.review.notes[key]
}

/** "Not the same": an element paired by place only is listed as added, its partner as removed (and back). */
export function toggleUnpair(m: FlowModel, id: string): void {
  if (!m.review) return
  const set = new Set(m.review.unpair ?? [])
  if (set.has(id)) set.delete(id)
  else set.add(id)
  if (set.size) m.review.unpair = [...set]
  else delete m.review.unpair
}

export function endReview(m: FlowModel): void {
  delete m.review
}

/** The diff of a model with its review's base (null when it has none). */
export function reviewDiff(m: FlowModel): ModelDiff | null {
  if (!m.review) return null
  return diffModels(m.review.base, withoutReview(m), { unpair: m.review.unpair, notes: Object.keys(m.review.notes) })
}
