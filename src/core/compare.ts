// Comparison of a student's model with a reference model (SPEC §9, trainer levels 2–3).
// Steps are matched by name (stems, synonyms from the case), then by place (the step between the same
// neighbours). Order is compared as "links": which step comes right after which, looking through
// gateways, so an equivalent structure with other gateways counts as right; decisions are compared by
// what their branches lead to and by kind. Layout and gateway count do not matter.
import { isArtifact, type Flow, type FlowModel, type FlowNode, type GatewayKind, type LoopKind } from './metamodel'

export type ItemStatus = 'ok' | 'missing' | 'different' | 'extra'
export type ItemKind = 'pool' | 'lane' | 'step' | 'decision' | 'link' | 'message' | 'data' | 'figure'

export interface CompareItem {
  /** Stable key: `pool:Name`, `lane:Name`, `step:Name`, `decision:<ref id>`, `link:A>B`, `message:A>B`, `data:Name`; `extra:<id>` for extras. */
  key: string
  kind: ItemKind
  status: ItemStatus
  /** What the item says, for the student. */
  text: string
  /** Reference element ids this item is about (empty for extras). */
  ref: string[]
  /** The student's element ids (to select them). */
  mine: string[]
  /** Reference order: items about earlier steps come first. */
  order: number
}

export interface CompareResult {
  items: CompareItem[]
  /** 0–100: right items (half for different ones) minus a quarter per extra, of all reference items. */
  score: number
  /** Reference element id → the student's element id. */
  map: Record<string, string>
}

export interface CompareOptions {
  /** Reference name → other accepted names (also for pools and lanes). */
  synonyms?: Record<string, string[]>
  /** A coarser step that stands for several reference steps: name → the reference step names it covers. */
  groups?: Record<string, string[]>
  /** Also compare the figures of the time analysis (durations, waits, costs, branch shares): the redesign level. */
  figures?: boolean
}

// ---------------------------------------------------------------- names

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'in', 'on', 'at', 'is', 'are', 'be', 'and', 'or', 'from', 'by', 'with', 'into', 'its', 'his', 'her', 'their'])

function stem(w: string): string {
  for (const s of ['ing', 'ies', 'ed', 'es', 's'])
    if (w.length > s.length + 2 && w.endsWith(s)) return s === 'ies' ? `${w.slice(0, -3)}y` : w.slice(0, -s.length)
  return w
}

/** Stemmed content words of a name: "Checks the library cards" → check, library, card. */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map(stem)
}

/** Word overlap of two names, 0–1 (the order of words does not matter: "Invoice check" = "Check invoice"). */
export function nameSimilarity(a: string, b: string): number {
  const A = new Set(nameWords(a))
  const B = new Set(nameWords(b))
  if (!A.size || !B.size) return 0
  let common = 0
  for (const w of A) if (B.has(w)) common++
  return common / (A.size + B.size - common)
}

const MATCH = 0.5

function nameScore(refName: string, mine: string, syn: Record<string, string[]>): number {
  if (!refName || !mine) return 0
  return Math.max(nameSimilarity(refName, mine), ...(syn[refName] ?? []).map((s) => nameSimilarity(s, mine)))
}

// ---------------------------------------------------------------- graph helpers

const isStep = (n: FlowNode) => !isArtifact(n) && n.type !== 'gateway'
const label = (n: FlowNode | undefined) => (n?.name ? `“${n.name}”` : n ? describe(n) : '?')

function describe(n: FlowNode): string {
  switch (n.type) {
    case 'gateway':
      return `${GATEWAY_WORD[n.kind]} gateway`
    case 'event':
      return `${n.trigger === 'none' ? '' : `${n.trigger} `}${n.position} event`
    case 'task':
      return 'task'
    case 'subProcess':
      return 'sub-process'
    default:
      return n.type
  }
}

const GATEWAY_WORD: Record<GatewayKind, string> = { exclusive: 'exclusive', parallel: 'parallel', inclusive: 'inclusive', eventBased: 'event-based', complex: 'complex' }

class Graph {
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
  /** The steps reached from a node through gateways only. */
  next(id: string): Set<string> {
    const found = new Set<string>()
    const seen = new Set<string>()
    const walk = (to: string) => {
      if (seen.has(to)) return
      seen.add(to)
      const n = this.byId.get(to)
      if (!n) return
      if (n.type === 'gateway') for (const f of this.out.get(to) ?? []) walk(f.target)
      else found.add(to)
    }
    for (const f of this.out.get(id) ?? []) walk(f.target)
    return found
  }
  /** The steps a node is reached from, through gateways only. */
  prev(id: string): Set<string> {
    const found = new Set<string>()
    const seen = new Set<string>()
    const walk = (from: string) => {
      if (seen.has(from)) return
      seen.add(from)
      const n = this.byId.get(from)
      if (!n) return
      if (n.type === 'gateway') for (const f of this.inc.get(from) ?? []) walk(f.source)
      else found.add(from)
    }
    for (const f of this.inc.get(id) ?? []) walk(f.source)
    return found
  }
  /** Per outgoing flow of a split: the first steps on that branch. */
  branches(id: string): Set<string>[] {
    return (this.out.get(id) ?? []).map((f) => {
      const n = this.byId.get(f.target)
      if (!n) return new Set<string>()
      if (n.type !== 'gateway') return new Set([n.id])
      const s = this.next(n.id)
      return s
    })
  }
}

/** Reference order of the steps: breadth first from the start events (pools in their order). */
function stepOrder(g: Graph): Map<string, number> {
  const order = new Map<string, number>()
  const queue = g.m.nodes.filter((n) => n.type === 'event' && n.position === 'start').map((n) => n.id)
  const take = (id: string) => {
    if (!order.has(id)) order.set(id, order.size)
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    take(id)
    for (const f of g.out.get(id) ?? []) if (!order.has(f.target)) (take(f.target), queue.push(f.target))
    for (const b of g.m.nodes) if (b.type === 'event' && b.attachedTo === id && !order.has(b.id)) (take(b.id), queue.push(b.id))
  }
  for (const n of g.m.nodes) take(n.id)
  return order
}

// ---------------------------------------------------------------- the comparison

export function compareModels(ref: FlowModel, mine: FlowModel, opts: CompareOptions = {}): CompareResult {
  const syn = opts.synonyms ?? {}
  const R = new Graph(ref)
  const S = new Graph(mine)
  const order = stepOrder(R)
  const map = new Map<string, string>() // ref id → student id
  const taken = new Set<string>() // student ids already matched (groups may map several refs to one)
  const notes = new Map<string, string>() // ref id → a remark on a match made by place, not by name
  const items: CompareItem[] = []
  const add = (it: Omit<CompareItem, 'order'> & { order?: number }) => items.push({ order: it.order ?? 1e6, ...it })
  const ord = (id: string) => order.get(id) ?? 1e6
  const inv = (id: string) => [...map].filter(([, s]) => s === id).map(([r]) => r)

  // --- pools
  const greedy = <A extends { id: string; name: string }, B extends { id: string; name: string }>(as: A[], bs: B[], fit: (a: A, b: B) => number) => {
    const pairs: [number, A, B][] = []
    for (const a of as) for (const b of bs) {
      const s = fit(a, b)
      if (s >= MATCH) pairs.push([s, a, b])
    }
    pairs.sort((x, y) => y[0] - x[0])
    for (const [, a, b] of pairs) if (!map.has(a.id) && !taken.has(b.id)) (map.set(a.id, b.id), taken.add(b.id))
  }
  const stepsIn = (m: FlowModel, poolId: string) => m.nodes.filter((n) => n.participantId === poolId && isStep(n)).length
  greedy(ref.participants, mine.participants, (a, b) => nameScore(a.name, b.name, syn))
  // By content: the white-box pool with the most steps, then a remaining black box.
  for (const p of ref.participants) {
    if (map.has(p.id)) continue
    const free = mine.participants.filter((q) => !taken.has(q.id))
    const pick = p.processId && stepsIn(ref, p.id)
      ? free.filter((q) => stepsIn(mine, q.id)).sort((a, b) => stepsIn(mine, b.id) - stepsIn(mine, a.id))[0]
      : free.find((q) => !stepsIn(mine, q.id))
    if (pick) (map.set(p.id, pick.id), taken.add(pick.id))
  }

  // --- steps by name, coarse groups, then by place
  const refSteps = ref.nodes.filter(isStep)
  const mySteps = mine.nodes.filter(isStep)
  const kindOf = (n: FlowNode) => (n.type === 'event' ? 'event' : 'activity')
  greedy(refSteps, mySteps, (a, b) => {
    const s = nameScore(a.name, b.name, syn)
    return s && s + (kindOf(a) === kindOf(b) ? 0.01 : 0)
  })
  for (const [coarse, parts] of Object.entries(opts.groups ?? {})) {
    const refs = parts.map((p) => refSteps.find((n) => n.name === p)).filter((n) => n !== undefined)
    if (refs.length !== parts.length || refs.some((n) => map.has(n.id))) continue
    const hit = mySteps.find((n) => !taken.has(n.id) && nameSimilarity(coarse, n.name) >= MATCH)
    if (!hit) continue
    for (const r of refs) map.set(r.id, hit.id)
    taken.add(hit.id)
  }
  const mapped = (ids: Set<string>) => new Set([...ids].map((i) => map.get(i)).filter((x): x is string => !!x))
  for (let pass = 0; pass < 3; pass++) {
    let changed = false
    for (const r of refSteps) {
      if (map.has(r.id)) continue
      const free = mySteps.filter((n) => !taken.has(n.id))
      let pick: FlowNode | undefined
      if (r.type === 'event' && r.position === 'start') {
        const pool = r.participantId && map.get(r.participantId)
        pick = free.find((n) => n.type === 'event' && n.position === 'start' && (!pool || n.participantId === pool))
      } else if (r.type === 'event' && r.position === 'boundary') {
        const host = r.attachedTo && map.get(r.attachedTo)
        pick = free.find((n) => n.type === 'event' && n.position === 'boundary' && n.attachedTo === host && host)
      } else {
        const before = mapped(R.prev(r.id))
        const after = mapped(R.next(r.id))
        const fits = (n: FlowNode) =>
          kindOf(n) === kindOf(r) &&
          (r.type !== 'event' || (n.type === 'event' && n.position === r.position)) &&
          ([...S.prev(n.id)].some((p) => before.has(p)) || (r.type !== 'event' && [...S.next(n.id)].some((p) => after.has(p)))) &&
          (r.type === 'event' || !after.size || !before.size || ([...S.prev(n.id)].some((p) => before.has(p)) && [...S.next(n.id)].some((p) => after.has(p))))
        pick = free.find(fits)
        if (pick && r.type !== 'event' && r.name && pick.name)
          notes.set(r.id, `${label(pick)} stands where the reference has “${r.name}”: the same step in other words? Rename it if so.`)
      }
      if (pick) (map.set(r.id, pick.id), taken.add(pick.id), (changed = true))
    }
    if (!changed) break
  }

  // --- lanes: by name, else the lane holding most of the lane's steps
  greedy(ref.lanes, mine.lanes, (a, b) => nameScore(a.name, b.name, syn))
  for (const l of ref.lanes) {
    if (map.has(l.id)) continue
    const votes = new Map<string, number>()
    for (const n of ref.nodes) {
      const s = n.laneId === l.id && map.get(n.id)
      const lane = s && S.byId.get(s)?.laneId
      if (lane && !taken.has(lane)) votes.set(lane, (votes.get(lane) ?? 0) + 1)
    }
    const best = [...votes].sort((a, b) => b[1] - a[1])[0]
    if (best) (map.set(l.id, best[0]), taken.add(best[0]))
  }

  // --- items: pools
  for (const p of ref.participants) {
    const q = map.get(p.id)
    const qp = q ? mine.participants.find((x) => x.id === q) : undefined
    const base = { key: `pool:${p.name}`, kind: 'pool' as const, ref: [p.id], mine: q ? [q] : [], order: -100 + ref.participants.indexOf(p) }
    if (!qp) add({ ...base, status: 'missing', text: `Pool “${p.name}” is not there yet${p.processId ? '' : ' (another participant, drawn as an empty pool)'}.` })
    else if (!p.processId && stepsIn(mine, qp.id))
      add({ ...base, status: 'different', text: `Pool ${qp.name ? `“${qp.name}”` : ''} stands for an outside participant: we do not see its steps, so leave it empty (black box) and draw only the messages.` })
    else if (p.processId && stepsIn(ref, p.id) && !stepsIn(mine, qp.id)) add({ ...base, status: 'different', text: `Pool “${p.name}” is the process we model: its steps go inside it.` })
    else add({ ...base, status: 'ok', text: `Pool “${p.name}”.` })
  }
  for (const q of mine.participants)
    if (!taken.has(q.id)) add({ key: `extra:${q.id}`, kind: 'pool', status: 'extra', ref: [], mine: [q.id], text: `Pool ${q.name ? `“${q.name}”` : '(no name)'} is not in the reference: who is this participant in the text?` })

  // --- lanes
  for (const l of ref.lanes) {
    const q = map.get(l.id)
    add({
      key: `lane:${l.name}`,
      kind: 'lane',
      ref: [l.id],
      mine: q ? [q] : [],
      order: -50 + ref.lanes.indexOf(l),
      status: q ? 'ok' : 'missing',
      text: q ? `Lane “${l.name}”.` : `Lane “${l.name}” (a role in the text) is not there yet.`,
    })
  }
  for (const l of mine.lanes)
    if (!taken.has(l.id)) add({ key: `extra:${l.id}`, kind: 'lane', status: 'extra', ref: [], mine: [l.id], text: `Lane ${l.name ? `“${l.name}”` : '(no name)'} is not in the reference.` })

  // --- steps
  for (const r of refSteps) {
    const s = map.get(r.id)
    const n = s ? S.byId.get(s) : undefined
    const base = { key: `step:${r.name || r.id}`, kind: 'step' as const, ref: [r.id], mine: s ? [s] : [], order: ord(r.id) }
    if (!n) {
      add({ ...base, status: 'missing', text: `${cap(describe(r))} ${r.name ? `“${r.name}”` : ''} is not there yet.`.replace('  ', ' ') })
      continue
    }
    const diff = stepDifference(r, n) ?? laneDifference(r, n)
    const shared = inv(n.id).length > 1
    if (diff) add({ ...base, status: 'different', text: diff })
    else if (notes.has(r.id)) add({ ...base, status: 'different', text: notes.get(r.id)! })
    else add({ ...base, status: 'ok', text: shared ? `“${r.name}” is part of your ${label(n)}.` : `${label(n)}${n.name !== r.name && r.name ? ` (reference: “${r.name}”)` : ''}.` })
  }
  // A task standing for a reference end event ("Reject order" for "Order rejected") is followed by a plain
  // end event of its own: that end event is part of the same answer, not an extra.
  const endOfTask = (n: FlowNode) =>
    n.type === 'event' && n.position === 'end' && [...S.prev(n.id)].some((p) => S.byId.get(p)?.type === 'task' && inv(p).some((r) => R.byId.get(r)?.type === 'event'))
  for (const n of mySteps)
    if (!taken.has(n.id) && !endOfTask(n))
      add({ key: `extra:${n.id}`, kind: 'step', status: 'extra', ref: [], mine: [n.id], text: `${cap(label(n))} is not in the reference: does the text ask for it?` })

  function stepDifference(r: FlowNode, n: FlowNode): string | null {
    const name = r.name ? `“${r.name}”` : label(n)
    if (r.type === 'event' && n.type === 'event') {
      if (r.position !== n.position) return `${name} should be ${a(r.position)} event, yours is ${a(n.position)} event.`
      if (r.trigger !== n.trigger) return `${name}: the text calls for a ${r.trigger} trigger (yours: ${n.trigger}).`
      if (r.position === 'intermediate' && r.throwing !== n.throwing) return `${name} should ${r.throwing ? 'send (throw)' : 'wait for (catch)'} the ${r.trigger}.`
      if (r.position === 'boundary' && (r.interrupting ?? true) !== (n.interrupting ?? true))
        return `${name} should be ${r.interrupting === false ? 'non-interrupting (dashed: the activity goes on)' : 'interrupting (the activity stops)'}.`
      return null
    }
    if (r.type === 'event' && n.type === 'task') {
      // Accepted alternatives: a send task for a throwing message event, a receive task for a catching one.
      if (r.trigger === 'message' && r.throwing && n.kind === 'send') return null
      if (r.trigger === 'message' && !r.throwing && r.position === 'intermediate' && n.kind === 'receive') return null
      if (r.trigger === 'message' && r.position === 'end' && n.kind !== 'receive' && n.kind !== 'user') return null
      return `${name} is an event in the reference (${describe(r)}), yours is a task.`
    }
    if (r.type === 'task' && n.type === 'event') {
      if (r.kind === 'send' && n.trigger === 'message' && n.throwing) return null
      if (r.kind === 'receive' && n.trigger === 'message' && !n.throwing && n.position !== 'end') return null
      return `${name} is work to do (a task); yours is an event.`
    }
    if ((r.type === 'task' || r.type === 'subProcess') && (n.type === 'task' || n.type === 'subProcess') && (r.loop ?? '') !== (n.loop ?? ''))
      return r.loop ? `${name} repeats: ${LOOP_MEANING[r.loop]}.` : `${name} runs once: the text does not ask for a ${n.loop === 'standard' ? 'loop' : 'multi-instance'} marker.`
    return null
  }

  function laneDifference(r: FlowNode, n: FlowNode): string | null {
    if (!r.laneId || !n.laneId || r.type === 'event' && r.position === 'boundary') return null
    const want = map.get(r.laneId)
    if (!want || want === n.laneId) return null
    const lane = ref.lanes.find((l) => l.id === r.laneId)
    return `${r.name ? `“${r.name}”` : label(n)} is done by ${lane?.name ? `“${lane.name}”` : 'another lane'}: move it to that lane.`
  }

  // --- decisions (split gateways): what their branches lead to, and their kind
  const splitsOf = (g: Graph) =>
    g.m.nodes.filter((n) => !isArtifact(n) && (g.out.get(n.id)?.length ?? 0) > 1 && (n.type === 'gateway' || n.type === 'task' || n.type === 'subProcess' || n.type === 'event'))
  const mySplits = splitsOf(S)
  const usedSplits = new Set<string>()
  const splitMap = new Map<string, string>() // reference split → the student's
  for (const g of splitsOf(R)) {
    if (g.type !== 'gateway') continue
    const branches = R.branches(g.id)
    const want = branches.map((b) => mapped(b))
    let best: { n: FlowNode; hits: number } | undefined
    for (const n of mySplits) {
      if (usedSplits.has(n.id)) continue
      const theirs = S.branches(n.id)
      const used = new Set<number>()
      let hits = 0
      for (const w of want) {
        const j = theirs.findIndex((t, i) => !used.has(i) && [...w].some((x) => t.has(x)))
        if (j >= 0) (used.add(j), hits++)
      }
      if (hits >= 2 && (!best || hits > best.hits)) best = { n, hits }
    }
    const before = [...R.prev(g.id)].map((i) => R.byId.get(i)?.name).filter(Boolean)
    const what = g.name ? `Decision “${g.name}”` : `The ${GATEWAY_WORD[g.kind]} split${before.length ? ` after “${before[0]}”` : ''}`
    const base = { key: `decision:${g.name || g.id}`, kind: 'decision' as const, ref: [g.id], order: ord(g.id) }
    if (!best) {
      add({ ...base, mine: [], status: 'missing', text: `${what} is not there yet: ${branches.length} ways out (${branches.map((b) => [...b].map((i) => label(R.byId.get(i))).join(' + ')).join(' / ')}).` })
      continue
    }
    usedSplits.add(best.n.id)
    splitMap.set(g.id, best.n.id)
    const n = best.n
    const kindOk = n.type === 'gateway' ? n.kind === g.kind : g.kind === 'parallel'
    const allBranches = best.hits === branches.length
    if (!kindOk)
      add({ ...base, mine: [n.id], status: 'different', text: `${what}: the text needs ${a(GATEWAY_WORD[g.kind])} gateway (${GATEWAY_MEANING[g.kind]}); yours ${n.type === 'gateway' ? `is ${GATEWAY_WORD[n.kind]}` : 'is a step with several flows out (all of them run)'}.` })
    else if (!allBranches) add({ ...base, mine: [n.id], status: 'different', text: `${what}: one of its ${branches.length} ways out is not there yet.` })
    else add({ ...base, mine: [n.id], status: 'ok', text: `${what}.` })
  }
  for (const n of mySplits)
    if (n.type === 'gateway' && !usedSplits.has(n.id))
      add({ key: `extra:${n.id}`, kind: 'decision', status: 'extra', ref: [], mine: [n.id], text: `${cap(label(n))} splits the flow where the reference does not: is there a decision in the text here?` })

  // --- links: which step comes right after which (through gateways)
  const refLinks = new Set<string>()
  for (const r of refSteps)
    for (const t of R.next(r.id)) {
      refLinks.add(`${r.id}>${t}`)
      const ms = map.get(r.id)
      const mt = map.get(t)
      if (ms && ms === mt) continue // both inside one coarse step
      const ok = !!ms && !!mt && S.next(ms).has(mt)
      const viaFlow = ms && mt ? S.out.get(ms)?.map((f) => f.id) ?? [] : []
      add({
        key: `link:${R.byId.get(r.id)?.name || r.id}>${R.byId.get(t)?.name || t}`,
        kind: 'link',
        ref: [r.id, t],
        mine: ok ? [ms!, mt!, ...viaFlow.filter((f) => mine.flows.find((x) => x.id === f)?.target === mt)] : [ms, mt].filter((x): x is string => !!x),
        order: ord(t) + 0.5,
        status: ok ? 'ok' : 'missing',
        text: `${label(R.byId.get(r.id))} → ${label(R.byId.get(t))}${ok ? '' : ': this flow is not there yet'}.`,
      })
    }
  for (const s of mySteps)
    for (const t of S.next(s.id)) {
      const rs = inv(s.id)
      const rt = inv(t)
      if (!rs.length || !rt.length) continue
      if (rs.some((a) => rt.some((b) => refLinks.has(`${a}>${b}`) || a === b))) continue
      add({ key: `extra:${s.id}>${t}`, kind: 'link', status: 'extra', ref: [], mine: [s.id, t], text: `${label(s)} → ${label(S.byId.get(t))} is not in the reference: does the text say this comes next?` })
    }

  // --- message flows: between the same steps, or the same outside pool
  const myMessages = mine.flows.filter((f) => f.kind === 'message')
  const usedMsg = new Set<string>()
  const poolOfMine = (id: string) => S.byId.get(id)?.participantId ?? id
  const endFits = (refEnd: string, myEnd: string) => {
    const m = map.get(refEnd)
    if (!m) return false
    if (m === myEnd) return true
    // A message to or from an outside pool may touch the pool or a step in it.
    return ref.participants.some((p) => p.id === refEnd) && poolOfMine(myEnd) === m
  }
  const endName = (m: FlowModel, id: string) => m.nodes.find((n) => n.id === id)?.name || m.participants.find((p) => p.id === id)?.name || '?'
  for (const f of ref.flows.filter((x) => x.kind === 'message')) {
    const hit = myMessages.find((x) => !usedMsg.has(x.id) && endFits(f.source, x.source) && endFits(f.target, x.target))
    const back = !hit && myMessages.find((x) => !usedMsg.has(x.id) && endFits(f.source, x.target) && endFits(f.target, x.source))
    const text = `Message “${endName(ref, f.source)}” → “${endName(ref, f.target)}”`
    const base = { key: `message:${endName(ref, f.source)}>${endName(ref, f.target)}`, kind: 'message' as const, ref: [f.id, f.source, f.target], order: Math.min(ord(f.source), ord(f.target)) + 0.6 }
    if (hit) (usedMsg.add(hit.id), add({ ...base, mine: [hit.id], status: 'ok', text: `${text}.` }))
    else if (back) (usedMsg.add(back.id), add({ ...base, mine: [back.id], status: 'different', text: `${text}: yours goes the other way.` }))
    else add({ ...base, mine: [], status: 'missing', text: `${text} is not there yet.` })
  }
  for (const f of myMessages)
    if (!usedMsg.has(f.id))
      add({ key: `extra:${f.id}`, kind: 'message', status: 'extra', ref: [], mine: [f.id], text: `Message “${endName(mine, f.source)}” → “${endName(mine, f.target)}” is not in the reference.` })

  // --- data objects and stores: by name, linked to the same step
  const myData = mine.nodes.filter((n) => n.type === 'dataObject' || n.type === 'dataStore')
  const linked = (m: FlowModel, id: string) => new Set(m.flows.filter((f) => f.kind === 'data' && (f.source === id || f.target === id)).map((f) => (f.source === id ? f.target : f.source)))
  for (const d of ref.nodes.filter((n) => n.type === 'dataObject' || n.type === 'dataStore')) {
    const hit = myData.filter((n) => !taken.has(n.id)).sort((x, y) => nameScore(d.name, y.name, syn) - nameScore(d.name, x.name, syn))[0]
    const base = { key: `data:${d.name}`, kind: 'data' as const, ref: [d.id], order: Math.min(...[...linked(ref, d.id)].map(ord), 1e6) + 0.7 }
    if (!hit || nameScore(d.name, hit.name, syn) < MATCH) {
      add({ ...base, mine: [], status: 'missing', text: `Data “${d.name}” is not there yet.` })
      continue
    }
    map.set(d.id, hit.id)
    taken.add(hit.id)
    const want = mapped(linked(ref, d.id))
    const have = linked(mine, hit.id)
    const ok = [...want].every((x) => have.has(x))
    const kind =
      d.type === hit.type
        ? ''
        : d.type === 'dataStore'
          ? `“${d.name}” is kept beyond this case and other processes use it: a data store (cylinder), not a data object.`
          : `“${d.name}” exists for this case only: a data object (a page), not a data store.`
    add({
      ...base,
      mine: [hit.id],
      status: ok && !kind ? 'ok' : 'different',
      text: kind || (ok ? `Data “${d.name}”.` : `Data “${d.name}” should be linked to ${[...linked(ref, d.id)].map((x) => label(R.byId.get(x))).join(', ')}.`),
    })
  }
  for (const d of myData) if (!taken.has(d.id)) add({ key: `extra:${d.id}`, kind: 'data', status: 'extra', ref: [], mine: [d.id], text: `Data ${label(d)} is not in the reference.` })

  // --- figures of the time analysis (redesign level): per matched activity, and the share of each branch
  if (opts.figures) {
    const unit = ref.sim?.unit ?? 'h'
    for (const r of refSteps) {
      const s = map.get(r.id)
      const n = s ? S.byId.get(s) : undefined
      if (!r.sim || !n || inv(n.id).length > 1) continue
      const diffs = FIGURES.filter((k) => !near(r.sim?.[k], n.sim?.[k]))
      add({
        key: `figure:${r.name || r.id}`,
        kind: 'figure',
        ref: [r.id],
        mine: [n.id],
        order: ord(r.id) + 0.3,
        status: diffs.length ? 'different' : 'ok',
        text: diffs.length
          ? `${label(n)}: ${diffs.map((k) => `${FIGURE_WORD[k]} should be ${fmt(r.sim?.[k], k, unit)} (yours ${fmt(n.sim?.[k], k, unit)})`).join(', ')}.`
          : `Figures of ${label(n)}.`,
      })
    }
    for (const f of ref.flows) {
      if (f.kind !== 'sequence' || f.probability === undefined) continue
      const g = splitMap.get(f.source)
      const t = R.byId.get(f.target)
      const want = t && t.type !== 'gateway' ? new Set([t.id]) : R.next(f.target)
      const targets = mapped(want)
      const mineFlow = g ? (S.out.get(g) ?? []).find((x) => targets.has(x.target) || [...S.next(x.target)].some((y) => targets.has(y)) || [...targets].some((y) => S.byId.get(x.target)?.type === 'gateway' && x.target === y)) : undefined
      if (!mineFlow) continue
      const ok = near(f.probability, mineFlow.probability)
      const where = `${label(R.byId.get(f.source))} → ${f.name ? `${f.name}, ` : ''}${[...want].map((x) => label(R.byId.get(x))).join(' + ')}`
      add({
        key: `figure:${f.id}`,
        kind: 'figure',
        ref: [f.id],
        mine: [mineFlow.id],
        order: ord(f.source) + 0.4,
        status: ok ? 'ok' : 'different',
        text: ok ? `Share of ${where}.` : `Share of ${where} should be ${pct(f.probability)} (yours ${mineFlow.probability === undefined ? 'not set' : pct(mineFlow.probability)}).`,
      })
    }
  }

  items.sort((x, y) => x.order - y.order)
  const total = items.filter((i) => i.status !== 'extra').length
  const earned = items.reduce((s, i) => s + (i.status === 'ok' ? 1 : i.status === 'different' ? 0.5 : 0), 0)
  const extras = items.filter((i) => i.status === 'extra').length
  const score = total ? Math.max(0, Math.round((100 * (earned - extras / 4)) / total)) : 100
  return { items, score, map: Object.fromEntries(map) }
}

const GATEWAY_MEANING: Record<GatewayKind, string> = {
  exclusive: 'exactly one way is taken',
  parallel: 'all ways run at the same time',
  inclusive: 'one or more ways are taken',
  eventBased: 'the first event to happen decides',
  complex: 'a rule decides',
}

const LOOP_MEANING: Record<LoopKind, string> = {
  standard: 'a loop marker (circular arrow), done again while a condition holds',
  parallel: 'a parallel multi-instance marker (three vertical bars), once for each item, all at the same time',
  sequential: 'a sequential multi-instance marker (three horizontal bars), once for each item, one after another',
}

const FIGURES = ['duration', 'wait', 'cost'] as const
const FIGURE_WORD: Record<(typeof FIGURES)[number], string> = { duration: 'the work', wait: 'the waiting time', cost: 'the cost' }
/** Equal up to rounding (10 minutes typed as 0.17 or 0.1667 h). */
const near = (a: number | undefined, b: number | undefined) => Math.abs((a ?? 0) - (b ?? 0)) <= 0.01 + 0.02 * Math.abs(a ?? 0)
const fmt = (v: number | undefined, k: (typeof FIGURES)[number], unit: string) => (v === undefined ? 'not set' : `${Math.round(v * 100) / 100}${k === 'cost' ? '' : ` ${unit}`}`)
const pct = (p: number) => `${Math.round(p * 1000) / 10} %`

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const a = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`)
