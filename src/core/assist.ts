// "Do it for me" (trainer levels 2–3 and the redesign level, StrataSQL's coach pattern): makes one item of
// the comparison match the reference, with the editor's own operations, so it is one undo step. Missing
// elements are added where the reference has them, relative to a neighbour the student already has (so
// the student's layout is kept), in the lane the reference names; their flows to steps already there come
// with them. A missing flow is drawn along the reference's path, gateways included. "Different" items are
// changed in place; extras are removed.
import { compareModels, type CompareItem, type CompareOptions, type CompareResult } from './compare'
import { POOL_HEADER, type Bounds, type Flow, type FlowModel, type FlowNode, type Point } from './metamodel'
import {
  addBoundaryEvent,
  addLane,
  addNode,
  addPool,
  connect,
  convertActivity,
  deleteElements,
  ModelError,
  moveElements,
  nodeOf,
  pageOf,
  poolOf,
  reconnect,
  resizeElement,
  reverseFlow,
  setDefaultFlow,
  setProbability,
  setSim,
  topLanes,
  updateNode,
  type NodeSpec,
} from './ops'

/** The item to work on next: the first missing or different one in reference order, extras last. */
export function nextTodo(result: CompareResult): CompareItem | undefined {
  return result.items.find((i) => i.status === 'missing' || i.status === 'different') ?? result.items.find((i) => i.status === 'extra')
}

/**
 * Fixes one item (by key, else the next one) in `m` (an immer draft in the store) and says what was done.
 * Throws ModelError when there is nothing to do or the item needs the student's own hand.
 */
export function doItForMe(ref: FlowModel, m: FlowModel, opts: CompareOptions = {}, key?: string): string {
  const result = compareModels(ref, m, opts)
  const item = (key && result.items.find((i) => i.key === key && i.status !== 'ok')) || nextTodo(result)
  if (!item) throw new ModelError('Nothing left to do: your process matches the reference.')
  return new Assist(ref, m, result).fix(item)
}

const centre = (s: Bounds): Point => ({ x: s.x + s.width / 2, y: s.y + s.height / 2 })
const q = (s: string) => `“${s}”`

class Assist {
  private readonly map = new Map<string, string>()
  constructor(
    private readonly ref: FlowModel,
    private readonly m: FlowModel,
    private readonly result: CompareResult,
  ) {
    for (const [r, s] of Object.entries(result.map)) this.map.set(r, s)
    // Decisions matched to the student's splits.
    for (const i of result.items) if (i.kind === 'decision' && i.mine.length && i.ref.length) this.map.set(i.ref[0], i.mine[0])
  }

  fix(item: CompareItem): string {
    const { ref, m } = this
    const r0 = item.ref[0]
    if (item.status === 'extra') return this.removeExtra(item)
    switch (item.kind) {
      case 'pool': {
        const p = ref.participants.find((x) => x.id === r0)!
        if (item.status === 'missing') return (this.ensure(r0), `Added the pool ${q(p.name)}${p.processId ? '' : ' (a black box)'}.`)
        if (!p.processId) throw new ModelError(`${q(p.name)} is an outside participant: move its steps out of the pool by hand (or delete them), and keep only the messages.`)
        // A white-box pool without steps: its first missing step.
        const step = this.result.items.find((i) => i.kind === 'step' && i.status === 'missing' && ref.nodes.find((n) => n.id === i.ref[0])?.participantId === p.id)
        if (!step) throw new ModelError(`Draw the steps of ${q(p.name)} inside the pool.`)
        return this.fix(step)
      }
      case 'lane': {
        const l = ref.lanes.find((x) => x.id === r0)!
        return (this.ensure(r0), `Added the lane ${q(l.name)}.`)
      }
      case 'step':
        return item.status === 'missing' ? this.addStep(r0) : this.changeStep(r0)
      case 'decision':
        return item.status === 'missing' ? this.addDecision(r0) : this.changeDecision(r0)
      case 'link': {
        const [a, b] = item.ref
        for (const end of [a, b]) if (!this.mine(end)) return this.addStep(end)
        this.path(a, b)
        return `Drew the flow ${this.refName(a)} → ${this.refName(b)}.`
      }
      case 'message': {
        const f = ref.flows.find((x) => x.id === r0)!
        if (item.status === 'different' && item.mine[0]) return (reverseFlow(m, item.mine[0]), `Turned the message ${this.refName(f.source)} → ${this.refName(f.target)} round.`)
        this.link(f)
        return `Drew the message ${this.refName(f.source)} → ${this.refName(f.target)}.`
      }
      case 'data': {
        const d = ref.nodes.find((x) => x.id === r0)!
        const mine = this.mine(r0)
        if (mine) {
          const n = nodeOf(m, mine)!
          if (n.type !== d.type) {
            const i = m.nodes.indexOf(n)
            m.nodes[i] = { id: n.id, name: n.name, participantId: n.participantId, laneId: n.laneId, parentId: n.parentId, type: d.type } as FlowNode
            return `${q(n.name)} is now ${d.type === 'dataStore' ? 'a data store' : 'a data object'}.`
          }
        } else this.ensure(r0)
        for (const f of this.touching(r0, ['data', 'association'])) if (this.mine(f.source === r0 ? f.target : f.source)) this.link(f)
        return `${mine ? 'Linked' : 'Added'} the data ${q(d.name)}.`
      }
      case 'figure': {
        const id = item.mine[0]
        const f = ref.flows.find((x) => x.id === r0)
        if (f) {
          setProbability(m, id, f.probability)
          return `Set the share of the branch to ${Math.round((f.probability ?? 0) * 100)} %.`
        }
        const n = this.refNode(r0)
        setSim(m, id, { duration: n.sim?.duration, wait: n.sim?.wait, cost: n.sim?.cost, repeats: n.sim?.repeats })
        return `Typed the figures of ${q(nodeOf(m, id)?.name || n.name)} from the text.`
      }
    }
  }

  // ---------------------------------------------------------------- steps and decisions

  private addStep(r: string): string {
    const n = this.refNode(r)
    const had = new Set(this.m.flows.map((f) => f.id))
    this.ensure(r)
    this.linkNeighbours(r)
    const flows = this.m.flows.filter((f) => !had.has(f.id)).length
    return `Added ${this.describe(n)}${flows ? ` and its flow${flows > 1 ? 's' : ''}` : ''}.`
  }

  /** Flows between a node just added and the steps the student already has; a direct flow it now stands in is removed. */
  private linkNeighbours(r: string) {
    const { ref, m } = this
    const ins = this.touching(r, ['sequence']).filter((f) => f.target === r && this.mine(f.source))
    const outs = this.touching(r, ['sequence']).filter((f) => f.source === r && this.mine(f.target))
    for (const f of [...ins, ...outs, ...this.touching(r, ['message', 'data', 'association']).filter((f) => this.mine(f.source === r ? f.target : f.source))]) this.link(f)
    for (const a of ins)
      for (const b of outs) {
        if (ref.flows.some((f) => f.kind === 'sequence' && f.source === a.source && f.target === b.target)) continue
        const short = m.flows.find((f) => f.kind === 'sequence' && f.source === this.mine(a.source) && f.target === this.mine(b.target))
        if (short) deleteElements(m, [short.id])
      }
  }

  private changeStep(r: string): string {
    const { ref, m } = this
    const want = this.refNode(r)
    const id = this.mine(r)
    const n = id ? nodeOf(m, id) : undefined
    if (!n) return this.addStep(r)
    const said: string[] = []
    if (want.type !== n.type && isActivity(want) && isActivity(n)) (convertActivity(m, n.id, want.type as 'task' | 'subProcess'), said.push(`is ${this.describe(want).replace(/ “.*$/, '')}`))
    else if (want.type !== n.type) {
      this.replace(n, want)
      return `${q(n.name || 'The step')} is now ${this.describe(want)}.`
    }
    if (want.type === 'subProcess' || want.type === 'task' || n.type === 'task' || n.type === 'subProcess') {
      const loop = 'loop' in want ? want.loop : undefined
      if ((('loop' in n && n.loop) || undefined) !== loop) (updateNode(m, n.id, { loop: loop ?? 'none' }), said.push(loop ? 'repeats' : 'runs once'))
      if (want.type === 'task' && n.type === 'task' && want.kind !== n.kind && !(want.kind === 'task')) (updateNode(m, n.id, { kind: want.kind }), said.push(`is a ${want.kind} task`))
    }
    if (want.type === 'event' && n.type === 'event') {
      if (want.position !== n.position && want.position !== 'boundary' && n.position !== 'boundary') updateNode(m, n.id, { position: want.position })
      if (want.position === 'intermediate' && want.throwing !== n.throwing) updateNode(m, n.id, { throwing: want.throwing })
      if (want.trigger !== n.trigger) updateNode(m, n.id, { trigger: want.trigger })
      if (want.position === 'boundary' && (want.interrupting ?? true) !== (n.interrupting ?? true)) updateNode(m, n.id, { interrupting: want.interrupting ?? true })
      said.push(`is ${this.describe(want).replace(/ “.*$/, '')}`)
    }
    // The lane the reference puts it in.
    const lane = want.laneId && !(want.type === 'event' && want.position === 'boundary') ? this.mine(want.laneId) : undefined
    if (lane && n.laneId !== lane && !pageOf(m, n.id)) {
      const ls = m.diagram.shapes[lane]
      const s = m.diagram.shapes[n.id]
      moveElements(m, { [n.id]: { x: s.x, y: ls.y + ls.height / 2 - s.height / 2 } })
      said.push(`moved to ${q(ref.lanes.find((l) => l.id === want.laneId)!.name)}`)
    }
    if (want.name && n.name !== want.name) (n.name = want.name, said.push(`renamed ${q(want.name)}`))
    if (!said.length) throw new ModelError(`Change ${q(n.name)} by hand: see the item's text.`)
    return `${q(n.name)}: ${said.join(', ')}.`
  }

  /** Puts a node of the reference's type where the student's one is and moves its flows over. */
  private replace(n: FlowNode, want: FlowNode) {
    const { m } = this
    const c = centre(m.diagram.shapes[n.id])
    const fresh = want.type === 'event' && want.position === 'boundary' ? undefined : this.create(want, c, pageOf(m, n.id))
    if (!fresh) throw new ModelError('Draw this boundary event on its activity by hand.')
    for (const f of m.flows.filter((x) => x.source === n.id || x.target === n.id)) {
      try {
        reconnect(m, f.id, f.source === n.id ? 'source' : 'target', fresh.id)
      } catch {
        // A flow the new type cannot take is dropped with the old node.
      }
    }
    deleteElements(m, [n.id])
    this.map.set(want.id, fresh.id)
  }

  private addDecision(g: string): string {
    const { ref, m } = this
    const gw = this.refNode(g)
    const before = [...this.prevSteps(g)].filter((s) => this.mine(s))
    // The first step of each way out comes too: a decision is known by where its branches go.
    const after = [...this.nextSteps(g)]
    this.ensure(g)
    for (const s of before) this.path(s, g)
    for (const t of after) this.path(g, t)
    for (const s of before)
      for (const t of after) {
        if (ref.flows.some((f) => f.kind === 'sequence' && f.source === s && f.target === t)) continue
        const short = m.flows.find((f) => f.kind === 'sequence' && f.source === this.mine(s) && f.target === this.mine(t))
        if (short) deleteElements(m, [short.id])
      }
    return `Added ${this.describe(gw)} with its ways out.`
  }

  private changeDecision(g: string): string {
    const { m } = this
    const gw = this.refNode(g)
    if (gw.type !== 'gateway') throw new ModelError('Not a gateway')
    const id = this.mine(g)!
    const n = nodeOf(m, id)!
    if (n.type === 'gateway' && n.kind !== gw.kind) {
      updateNode(m, id, { kind: gw.kind })
      return `${q(n.name || 'The gateway')} is now ${this.describe(gw).replace(/ “.*$/, '')}.`
    }
    if (n.type !== 'gateway') {
      // A step with several flows out (all run): a gateway after it takes the flows.
      const s = m.diagram.shapes[id]
      const fresh = this.create(gw, { x: s.x + s.width + 50, y: s.y + s.height / 2 }, pageOf(m, id))
      for (const f of m.flows.filter((x) => x.kind === 'sequence' && x.source === id)) reconnect(m, f.id, 'source', fresh.id)
      connect(m, id, fresh.id)
      this.map.set(g, fresh.id)
      return `Added ${this.describe(gw)} after ${q(n.name)}: it takes the flows out.`
    }
    for (const t of this.nextSteps(g)) if (this.mine(t)) this.path(g, t)
    return `Drew the missing way out of ${q(n.name || 'the gateway')}.`
  }

  private removeExtra(item: CompareItem): string {
    const { m } = this
    if (item.kind === 'link') {
      const [s, t] = item.mine
      const direct = m.flows.find((f) => f.kind === 'sequence' && f.source === s && f.target === t)
      if (!direct) throw new ModelError('Remove this flow by hand: it runs through a gateway.')
      deleteElements(m, [direct.id])
      return `Removed the flow ${q(nodeOf(m, s)?.name || s)} → ${q(nodeOf(m, t)?.name || t)}.`
    }
    const names = item.mine.map((id) => nodeOf(m, id)?.name || poolOf(m, id)?.name || m.lanes.find((l) => l.id === id)?.name || '').filter(Boolean)
    deleteElements(m, item.mine)
    return `Removed ${names.length ? names.map(q).join(', ') : 'the extra element'}: it is not in the reference.`
  }

  // ---------------------------------------------------------------- flows

  /** Draws the reference's flows from `a` to `b` through gateways only, adding the gateways that are not there. */
  private path(a: string, b: string) {
    const { ref } = this
    const prev = new Map<string, Flow>()
    const queue = [a]
    for (let i = 0; i < queue.length && !prev.has(b); i++) {
      const at = queue[i]
      if (at !== a && at !== b && this.refNode(at).type !== 'gateway') continue
      for (const f of ref.flows) if (f.kind === 'sequence' && f.source === at && !prev.has(f.target) && f.target !== a) (prev.set(f.target, f), queue.push(f.target))
    }
    if (!prev.has(b)) throw new ModelError(`The reference has no flow from ${this.refName(a)} to ${this.refName(b)}.`)
    const flows: Flow[] = []
    for (let at = b; at !== a; at = prev.get(at)!.source) flows.unshift(prev.get(at)!)
    for (const f of flows) this.link(f)
  }

  /** Draws one reference flow between the student's counterparts of its ends (adding a missing end). */
  private link(f: Flow) {
    const { ref, m } = this
    const s = this.ensure(f.source)
    const t = this.ensure(f.target)
    if (m.flows.some((x) => x.source === s && x.target === t)) return
    let flow: Flow
    try {
      flow = connect(m, s, t)
    } catch (e) {
      throw new ModelError(`Cannot draw ${this.refName(f.source)} → ${this.refName(f.target)}: ${(e as Error).message}.`)
    }
    flow.name = f.name
    if (f.condition && flow.kind === 'sequence') flow.condition = f.condition
    if (f.probability !== undefined) flow.probability = f.probability
    const g = ref.nodes.find((n) => n.id === f.source)
    if (g?.type === 'gateway' && g.defaultFlow === f.id)
      try {
        setDefaultFlow(m, flow.id, true)
      } catch {
        // The student's source is not a gateway that can have a default.
      }
  }

  private touching(r: string, kinds: Flow['kind'][]) {
    return this.ref.flows.filter((f) => kinds.includes(f.kind) && (f.source === r || f.target === r))
  }

  // ---------------------------------------------------------------- elements

  /** The student's element for a reference id (and it still exists). */
  private mine(r: string): string | undefined {
    const id = this.map.get(r)
    const m = this.m
    return id && (nodeOf(m, id) || poolOf(m, id) || m.lanes.some((l) => l.id === id)) ? id : undefined
  }

  /** The student's element for a reference id, added when there is none. */
  private ensure(r: string): string {
    const have = this.mine(r)
    if (have) return have
    const { ref, m } = this
    let id: string
    const pool = ref.participants.find((p) => p.id === r)
    const lane = ref.lanes.find((l) => l.id === r)
    if (pool) {
      const bottom = Math.max(-60, ...m.participants.map((p) => m.diagram.shapes[p.id]).filter(Boolean).map((s) => s.y + s.height))
      const left = Math.min(...m.participants.map((p) => m.diagram.shapes[p.id]?.x ?? 0), m.participants.length ? Infinity : 0)
      const rs = ref.diagram.shapes[r]
      const width = Math.max(rs?.width ?? 800, ...m.participants.map((p) => m.diagram.shapes[p.id]?.width ?? 0))
      const p = addPool(m, { x: left, y: bottom + 60 }, pool.name)
      if (!pool.processId) delete p.processId
      resizeElement(m, p.id, { x: left, y: bottom + 60, width, height: pool.processId ? (rs?.height ?? 250) : Math.min(rs?.height ?? 120, 120) })
      id = p.id
    } else if (lane) {
      const holder = lane.participantId ? this.ensure(lane.participantId) : undefined
      if (!holder) throw new ModelError(`Draw the pool of the lane ${q(lane.name)} first.`)
      id = addLane(m, holder, lane.name).id
      // A pool's first lane is as tall as the pool; later ones as the reference's.
      const rs = ref.diagram.shapes[r]
      const ls = m.diagram.shapes[id]
      if (topLanes(m, holder).length > 1 && rs && rs.height !== ls.height) {
        const ps = m.diagram.shapes[holder]
        ps.height += rs.height - ls.height
        ls.height = rs.height
      }
      this.clearBelow(holder)
    } else {
      const n = this.refNode(r)
      if (n.participantId) this.ensure(n.participantId)
      if (n.laneId) this.ensure(n.laneId)
      if (n.type === 'event' && n.attachedTo) {
        const host = this.ensure(n.attachedTo)
        const ev = addBoundaryEvent(m, host, n.trigger)
        Object.assign(ev, { name: n.name, interrupting: n.interrupting ?? true }, n.sim ? { sim: { ...n.sim } } : {})
        id = ev.id
      } else {
        const refPage = pageOf(ref, r)
        const holder = refPage ? this.ensure(refPage) : n.parentId ? this.ensure(n.parentId) : undefined
        const page = holder && pageOf(m, holder) !== undefined ? pageOf(m, holder) : holder && isCollapsed(nodeOf(m, holder)) ? holder : undefined
        id = this.create(n, this.where(n, page, holder), page).id
      }
    }
    this.map.set(r, id)
    return id
  }

  /** A node like the reference's (type, kind, trigger, repeats, figures) centred on `at`. */
  private create(n: FlowNode, at: Point, page?: string): FlowNode {
    const spec: NodeSpec = n.type === 'event' ? { type: 'event', position: n.position === 'boundary' ? 'intermediate' : n.position } : ({ type: n.type } as NodeSpec)
    const node = addNode(this.m, spec, at, n.name, page)
    const { id: _id, participantId: _p, laneId: _l, parentId: _pa, ...props } = n as FlowNode & { attachedTo?: string; defaultFlow?: string }
    delete (props as { attachedTo?: string }).attachedTo
    delete (props as { defaultFlow?: string }).defaultFlow
    Object.assign(node, structuredClone(props))
    return node
  }

  /** Where the student's counterpart goes: next to a neighbour they have, as in the reference; in the right lane; on a free spot. */
  private where(n: FlowNode, page: string | undefined, holder: string | undefined): Point {
    const { ref, m } = this
    const rs = ref.diagram.shapes[n.id]
    const rc = rs ? centre(rs) : { x: 100, y: 100 }
    const size = { width: rs?.width ?? 100, height: rs?.height ?? 80 }
    const neighbours = [
      ...ref.flows.filter((f) => f.target === n.id).map((f) => f.source),
      ...ref.flows.filter((f) => f.source === n.id).map((f) => f.target),
    ]
    let at: Point | undefined
    for (const r of neighbours) {
      const id = this.mine(r)
      const s = id && m.diagram.shapes[id]
      const rr = ref.diagram.shapes[r]
      if (!s || !rr || nodeOf(m, id)?.type === undefined || pageOf(m, id) !== page) continue
      const c = centre(s)
      const d = centre(rr)
      at = { x: c.x + rc.x - d.x, y: c.y + rc.y - d.y }
      break
    }
    if (!at) {
      // Relative to the holding sub-process, else the pool.
      const anchor = holder ? [this.refHolder(n), holder] : n.participantId ? [n.participantId, this.mine(n.participantId)] : []
      const a = anchor[0] && ref.diagram.shapes[anchor[0]]
      const b = anchor[1] && m.diagram.shapes[anchor[1]]
      at = a && b ? { x: rc.x - a.x + b.x, y: rc.y - a.y + b.y } : { ...rc }
    }
    if (!page) {
      const lane = n.laneId && this.mine(n.laneId)
      const ls = lane && m.diagram.shapes[lane]
      if (ls && (at.y - size.height / 2 < ls.y || at.y + size.height / 2 > ls.y + ls.height)) at.y = ls.y + ls.height / 2
      const pool = n.participantId && this.mine(n.participantId)
      const ps = pool && m.diagram.shapes[pool]
      if (ps) {
        const inner = topLanes(m, pool).length ? POOL_HEADER * 2 : POOL_HEADER
        at.x = Math.max(at.x, ps.x + inner + 30 + size.width / 2)
        if (!ls && (at.y < ps.y || at.y > ps.y + ps.height)) at.y = ps.y + ps.height / 2
      }
    }
    // A free spot: further right while something of the same page is in the way.
    const holders = new Set<string>()
    for (let p: string | undefined = holder; p; p = nodeOf(m, p)?.parentId) holders.add(p)
    const busy = (p: Point) =>
      m.nodes.some((x) => {
        const s = m.diagram.shapes[x.id]
        return s && !holders.has(x.id) && pageOf(m, x.id) === page && Math.abs(s.x + s.width / 2 - p.x) < (s.width + size.width) / 2 + 15 && Math.abs(s.y + s.height / 2 - p.y) < (s.height + size.height) / 2 + 15
      })
    for (let i = 0; i < 30 && busy(at); i++) at.x += Math.max(60, size.width / 2 + 40)
    if (!page) {
      const pool = n.participantId && this.mine(n.participantId)
      const ps = pool && m.diagram.shapes[pool]
      if (ps && at.x + size.width / 2 + 30 > ps.x + ps.width) resizeElement(m, pool, { ...ps, width: at.x + size.width / 2 + 30 - ps.x })
    }
    return { x: Math.round(at.x), y: Math.round(at.y) }
  }

  /** A pool that grew pushes the pools under it down, so none overlaps. */
  private clearBelow(poolId: string) {
    const { m } = this
    const ps = m.diagram.shapes[poolId]
    const bottom = ps.y + ps.height
    const below = m.participants.map((p) => [p.id, m.diagram.shapes[p.id]] as const).filter(([id, s]) => id !== poolId && s && s.y >= ps.y && s.y < bottom + 40)
    if (!below.length) return
    const dy = bottom + 40 - Math.min(...below.map(([, s]) => s.y))
    const lower = m.participants.map((p) => [p.id, m.diagram.shapes[p.id]] as const).filter(([id, s]) => id !== poolId && s && s.y >= ps.y)
    moveElements(m, Object.fromEntries(lower.map(([id, s]) => [id, { x: s.x, y: s.y + dy }])))
  }

  private refHolder(n: FlowNode): string | undefined {
    return pageOf(this.ref, n.id) ?? n.parentId
  }

  private refNode(r: string): FlowNode {
    const n = this.ref.nodes.find((x) => x.id === r)
    if (!n) throw new ModelError(`No element ${r} in the reference`)
    return n
  }

  private refName(r: string): string {
    const n = this.ref.nodes.find((x) => x.id === r)
    return q(n?.name || this.ref.participants.find((p) => p.id === r)?.name || (n ? this.describe(n) : r))
  }

  private describe(n: FlowNode): string {
    const what =
      n.type === 'event'
        ? `${n.trigger === 'none' ? '' : `${n.trigger} `}${n.position} event`
        : n.type === 'gateway'
          ? `${n.kind === 'eventBased' ? 'event-based' : n.kind} gateway`
          : n.type === 'subProcess'
            ? 'sub-process'
            : n.type === 'task'
              ? `${n.kind === 'task' ? '' : `${n.kind === 'businessRule' ? 'business rule' : n.kind} `}task`
              : n.type === 'dataStore'
                ? 'data store'
                : n.type === 'dataObject'
                  ? 'data object'
                  : 'annotation'
    return `${/^[aeio]|^u(?!s)/.test(what) ? 'an' : 'a'} ${what}${n.name ? ` ${q(n.name)}` : ''}`
  }

  /** The steps right before a node, through gateways. */
  private prevSteps(id: string): Set<string> {
    return this.walk(id, 'back')
  }
  private nextSteps(id: string): Set<string> {
    return this.walk(id, 'on')
  }
  private walk(id: string, dir: 'on' | 'back'): Set<string> {
    const found = new Set<string>()
    const seen = new Set<string>([id])
    const step = (from: string) => {
      for (const f of this.ref.flows) {
        if (f.kind !== 'sequence' || (dir === 'on' ? f.source : f.target) !== from) continue
        const to = dir === 'on' ? f.target : f.source
        if (seen.has(to)) continue
        seen.add(to)
        if (this.refNode(to).type === 'gateway' && !this.mine(to)) step(to)
        else found.add(to)
      }
    }
    step(id)
    return found
  }
}

const isActivity = (n: FlowNode) => n.type === 'task' || n.type === 'subProcess'
const isCollapsed = (n: FlowNode | undefined) => n?.type === 'subProcess' && n.collapsed
