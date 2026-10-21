// Edit operations (SPEC §6). Each one changes a model in place (the store runs it on an immer draft)
// and throws ModelError, leaving the caller to drop the draft, when the edit makes no sense.
// Coordinates are absolute; after a node moves, place() works out its pool, lane and sub-process.
import {
  isArtifact,
  LANE_HEIGHT,
  POOL_HEADER,
  POOL_SIZE,
  SIZES,
  type Bounds,
  type Side,
  type EventPosition,
  type EventTrigger,
  type Flow,
  type FlowKind,
  type FlowModel,
  type FlowNode,
  type GatewayKind,
  type Lane,
  type LoopKind,
  type Participant,
  type Point,
  type SimFigures,
  type SimSettings,
  type TaskKind,
} from './metamodel'

export class ModelError extends Error {}

const PREFIX: Record<FlowNode['type'], string> = {
  task: 'Task',
  subProcess: 'SubProcess',
  event: 'Event',
  gateway: 'Gateway',
  dataObject: 'DataObject',
  dataStore: 'DataStore',
  annotation: 'Annotation',
}

/** `Task_7` style ids, one more than the highest number in use with that prefix. */
export function nextId(m: FlowModel, prefix: string): string {
  const used = [...m.nodes.map((n) => n.id), ...m.flows.map((f) => f.id), ...m.participants.flatMap((p) => [p.id, p.processId ?? '']), ...m.lanes.map((l) => l.id)]
  let max = 0
  for (const id of used) {
    const hit = id.startsWith(prefix + '_') ? Number(id.slice(prefix.length + 1)) : NaN
    if (Number.isInteger(hit) && hit > max) max = hit
  }
  return `${prefix}_${max + 1}`
}

// ---------------------------------------------------------------- lookups

export const nodeOf = (m: FlowModel, id: string) => m.nodes.find((n) => n.id === id)
export const poolOf = (m: FlowModel, id: string) => m.participants.find((p) => p.id === id)
export const laneOf = (m: FlowModel, id: string) => m.lanes.find((l) => l.id === id)
export const flowOf = (m: FlowModel, id: string) => m.flows.find((f) => f.id === id)

function nodeOrThrow(m: FlowModel, id: string): FlowNode {
  const n = nodeOf(m, id)
  if (!n) throw new ModelError(`No element ${id}`)
  return n
}

const centre = (b: Bounds): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const inside = (p: Point, b: Bounds) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
const area = (b: Bounds) => b.width * b.height

/** The element and everything nested in it: boundary events, and the content of a sub-process. */
export function withDescendants(m: FlowModel, id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const n of m.nodes)
      if (!out.has(n.id) && ((n.parentId && out.has(n.parentId)) || (n.type === 'event' && n.attachedTo && out.has(n.attachedTo)))) {
        out.add(n.id)
        grew = true
      }
  }
  return out
}

/** The collapsed sub-process that hides a node (the outermost one), if any: its content is drawn on a page of its own. */
export function hiddenBy(m: FlowModel, id: string): string | undefined {
  let found: string | undefined
  const seen = new Set<string>()
  for (let p = nodeOf(m, id)?.parentId; p && !seen.has(p); p = nodeOf(m, p)?.parentId) {
    seen.add(p)
    const h = nodeOf(m, p)
    if (h?.type === 'subProcess' && h.collapsed) found = p
  }
  return found
}

/** The page a node is drawn on: the collapsed sub-process that holds it directly or through expanded ones (undefined = the main canvas). */
export function pageOf(m: FlowModel, id: string): string | undefined {
  const seen = new Set<string>()
  for (let p = nodeOf(m, id)?.parentId; p && !seen.has(p); p = nodeOf(m, p)?.parentId) {
    seen.add(p)
    const h = nodeOf(m, p)
    if (h?.type === 'subProcess' && h.collapsed) return p
  }
  return undefined
}

/** Sets a node's pool, lane and enclosing sub-process from where its centre sits. */
export function place(m: FlowModel, id: string): void {
  const n = nodeOrThrow(m, id)
  if (n.type === 'event' && n.attachedTo) {
    const host = nodeOrThrow(m, n.attachedTo)
    n.participantId = host.participantId
    n.laneId = host.laneId
    n.parentId = host.parentId
    return
  }
  // Inside a collapsed sub-process a node is hidden: it stays where it belongs.
  const holder = n.parentId ? nodeOf(m, n.parentId) : undefined
  if (holder?.type === 'subProcess' && holder.collapsed) return
  const s = m.diagram.shapes[id]
  if (!s) return
  const c = centre(s)
  const own = withDescendants(m, id)
  const smallest = <T extends { id: string }>(items: T[]) =>
    items
      .filter((i) => m.diagram.shapes[i.id] && inside(c, m.diagram.shapes[i.id]))
      .sort((a, b) => area(m.diagram.shapes[a.id]) - area(m.diagram.shapes[b.id]))[0]

  const parent = smallest(m.nodes.filter((x) => x.type === 'subProcess' && !x.collapsed && !own.has(x.id)))
  // Inside a sub-process that is itself in a collapsed one, the drawing is not on the main canvas: pool and lane come from it.
  if (parent && hiddenBy(m, parent.id)) {
    n.parentId = parent.id
    n.participantId = parent.participantId
    n.laneId = parent.laneId
    return
  }
  const pool = smallest(m.participants)
  n.parentId = parent?.id
  n.participantId = pool?.id
  n.laneId = pool ? smallest(m.lanes.filter((l) => l.participantId === pool.id))?.id : undefined
  // A black-box pool that receives a step gets a process of its own.
  if (pool && !pool.processId && !isArtifact(n)) pool.processId = nextId(m, 'Process')
}

// ---------------------------------------------------------------- add

export type NodeSpec =
  | { type: 'task'; kind?: TaskKind }
  | { type: 'subProcess' }
  | { type: 'event'; position?: Exclude<EventPosition, 'boundary'>; trigger?: EventTrigger; throwing?: boolean }
  | { type: 'gateway'; kind?: GatewayKind }
  | { type: 'dataObject' }
  | { type: 'dataStore' }
  | { type: 'annotation' }

function makeNode(id: string, spec: NodeSpec, name: string): FlowNode {
  switch (spec.type) {
    case 'task':
      return { id, name, type: 'task', kind: spec.kind ?? 'task' }
    case 'subProcess':
      return { id, name, type: 'subProcess', collapsed: true }
    case 'event': {
      const position = spec.position ?? 'start'
      return { id, name, type: 'event', position, trigger: spec.trigger ?? 'none', throwing: position === 'end' ? true : position === 'start' ? false : !!spec.throwing }
    }
    case 'gateway':
      return { id, name, type: 'gateway', kind: spec.kind ?? 'exclusive' }
    default:
      return { id, name, type: spec.type }
  }
}

/** Adds a node centred on `at`; `page` = the collapsed sub-process whose page it is drawn on (pool and lane come from it). */
export function addNode(m: FlowModel, spec: NodeSpec, at: Point, name = '', page?: string): FlowNode {
  const id = nextId(m, PREFIX[spec.type])
  const node = makeNode(id, spec, name)
  m.nodes.push(node)
  const { width, height } = SIZES[spec.type]
  m.diagram.shapes[id] = { x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2), width, height }
  if (page) putOnPage(m, node.id, page)
  else place(m, id)
  return nodeOf(m, id)!
}

/** Places a node on the page of a collapsed sub-process: pool and lane come from it, an expanded sub-process there may hold it. */
function putOnPage(m: FlowModel, id: string, page: string) {
  const node = nodeOrThrow(m, id)
  const holder = nodeOf(m, page)
  if (holder?.type !== 'subProcess' || !holder.collapsed) throw new ModelError(`${page} is not a collapsed sub-process`)
  const c = centre(m.diagram.shapes[id])
  const own = withDescendants(m, id)
  const inner = m.nodes
    .filter((x) => x.type === 'subProcess' && !x.collapsed && !own.has(x.id) && pageOf(m, x.id) === page && inside(c, m.diagram.shapes[x.id]))
    .sort((p, q) => area(m.diagram.shapes[p.id]) - area(m.diagram.shapes[q.id]))[0]
  node.parentId = inner?.id ?? holder.id
  node.participantId = holder.participantId
  node.laneId = holder.laneId
}

/** Adds a node to the right of `fromId` (below the ones already there) and connects the two. */
export function appendNode(m: FlowModel, fromId: string, spec: NodeSpec, name = ''): FlowNode {
  const from = m.diagram.shapes[fromId]
  if (!from) throw new ModelError(`No element ${fromId}`)
  const { width, height } = SIZES[spec.type]
  const x = from.x + from.width + 60 + width / 2
  let y = from.y + from.height / 2
  // The sub-processes holding the step are its room, not obstacles.
  const holders = new Set<string>()
  for (let p = nodeOf(m, fromId)?.parentId; p && !holders.has(p); p = nodeOf(m, p)?.parentId) holders.add(p)
  // Only what is drawn on the same page is in the way.
  const page = pageOf(m, fromId)
  const busy = (cy: number) =>
    Object.entries(m.diagram.shapes).some(
      ([id, s]) => nodeOf(m, id) && !holders.has(id) && pageOf(m, id) === page && Math.abs(s.x + s.width / 2 - x) < (s.width + width) / 2 + 10 && Math.abs(s.y + s.height / 2 - cy) < (s.height + height) / 2 + 10,
    )
  for (let i = 0; i < 20 && busy(y); i++) y += height + 30
  // Appending past the end of the pool widens the pool, so the new step stays in the process.
  const pool = nodeOf(m, fromId)?.participantId
  const ps = pool && m.diagram.shapes[pool]
  if (!page && ps && inside(centre(from), ps) && x + width / 2 + 30 > ps.x + ps.width) resizeElement(m, pool, { ...ps, width: x + width / 2 + 30 - ps.x })
  const node = addNode(m, spec, { x, y }, name, page)
  connect(m, fromId, node.id)
  return node
}

/** Adds an event on the lower border of a task or sub-process. */
export function addBoundaryEvent(m: FlowModel, hostId: string, trigger: EventTrigger = 'timer'): FlowNode {
  const host = nodeOrThrow(m, hostId)
  if (host.type !== 'task' && host.type !== 'subProcess') throw new ModelError('Only a task or a sub-process can carry a boundary event')
  const hs = m.diagram.shapes[hostId]
  const count = m.nodes.filter((n) => n.type === 'event' && n.attachedTo === hostId).length
  const id = nextId(m, 'Event')
  const { width, height } = SIZES.event
  m.nodes.push({ id, name: '', type: 'event', position: 'boundary', trigger, throwing: false, interrupting: true, attachedTo: hostId })
  m.diagram.shapes[id] = { x: Math.round(hs.x + hs.width * 0.7 - width / 2 - count * (width + 6)), y: Math.round(hs.y + hs.height - height / 2), width, height }
  place(m, id)
  return nodeOf(m, id)!
}

/** Adds a white-box pool (with an empty process) whose top-left corner is `at`. */
export function addPool(m: FlowModel, at: Point, name = ''): Participant {
  const id = nextId(m, 'Participant')
  const pool: Participant = { id, name, processId: nextId(m, 'Process') }
  m.participants.push(pool)
  m.diagram.shapes[id] = { x: Math.round(at.x), y: Math.round(at.y), ...POOL_SIZE }
  for (const n of m.nodes) if (!n.participantId) place(m, n.id)
  return pool
}

/** The first lane fills the pool; each next one is added at the bottom and the pool grows. */
export function addLane(m: FlowModel, poolId: string, name = ''): Lane {
  const pool = poolOf(m, poolId)
  const ps = m.diagram.shapes[poolId]
  if (!pool || !ps) throw new ModelError(`No pool ${poolId}`)
  const lanes = topLanes(m, poolId)
  const id = nextId(m, 'Lane')
  const lane: Lane = { id, name, participantId: poolId }
  m.lanes.push(lane)
  if (!lanes.length) m.diagram.shapes[id] = { x: ps.x + POOL_HEADER, y: ps.y, width: ps.width - POOL_HEADER, height: ps.height }
  else {
    m.diagram.shapes[id] = { x: ps.x + POOL_HEADER, y: ps.y + ps.height, width: ps.width - POOL_HEADER, height: LANE_HEIGHT }
    ps.height += LANE_HEIGHT
  }
  for (const n of m.nodes) if (n.participantId === poolId) place(m, n.id)
  return lane
}

/** Top-level lanes of a pool, top to bottom. */
export function topLanes(m: FlowModel, poolId: string): Lane[] {
  return m.lanes.filter((l) => l.participantId === poolId && !l.parentLaneId && m.diagram.shapes[l.id]).sort((a, b) => m.diagram.shapes[a.id].y - m.diagram.shapes[b.id].y)
}

/** The lane and every lane nested in it. */
function laneTree(m: FlowModel, id: string): Set<string> {
  const out = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const l of m.lanes) if (l.parentLaneId && out.has(l.parentLaneId) && !out.has(l.id)) out.add(l.id), (grew = true)
  }
  return out
}

/** Whether the lane has a neighbour in that direction. */
export function canMoveLane(m: FlowModel, id: string, dir: 'up' | 'down'): boolean {
  const lane = laneOf(m, id)
  const s = m.diagram.shapes[id]
  if (!lane || !s) return false
  return m.lanes.some((l) => l.id !== id && l.participantId === lane.participantId && l.parentLaneId === lane.parentLaneId && m.diagram.shapes[l.id] && (dir === 'up' ? m.diagram.shapes[l.id].y < s.y : m.diagram.shapes[l.id].y > s.y))
}

/** Swaps a lane with the one above or below it (same pool, same parent); its steps and nested lanes go along. */
export function moveLane(m: FlowModel, id: string, dir: 'up' | 'down'): void {
  const lane = laneOf(m, id)
  if (!lane || !m.diagram.shapes[id]) throw new ModelError(`No lane ${id}`)
  const sibs = m.lanes.filter((l) => l.participantId === lane.participantId && l.parentLaneId === lane.parentLaneId && m.diagram.shapes[l.id]).sort((a, b) => m.diagram.shapes[a.id].y - m.diagram.shapes[b.id].y)
  const i = sibs.findIndex((l) => l.id === id)
  const other = sibs[dir === 'up' ? i - 1 : i + 1]
  if (!other) throw new ModelError(dir === 'up' ? 'This lane is already the top one' : 'This lane is already the bottom one')
  const [upper, lower] = dir === 'up' ? [other, lane] : [lane, other]
  const up = m.diagram.shapes[upper.id]
  const low = m.diagram.shapes[lower.id]
  const dUpper = low.height // the upper lane moves down by the height of the lower one
  const dLower = -up.height
  const treeUp = laneTree(m, upper.id)
  const treeLow = laneTree(m, lower.id)
  const shift = (tree: Set<string>, dy: number) => {
    for (const l of m.lanes) if (tree.has(l.id) && m.diagram.shapes[l.id]) m.diagram.shapes[l.id].y += dy
  }
  const steps: Record<string, Point> = {}
  for (const n of m.nodes) {
    const s = m.diagram.shapes[n.id]
    if (!s || !n.laneId || (n.type === 'event' && n.attachedTo)) continue
    const dy = treeUp.has(n.laneId) ? dUpper : treeLow.has(n.laneId) ? dLower : 0
    if (dy) steps[n.id] = { x: s.x, y: s.y + dy }
  }
  shift(treeUp, dUpper)
  shift(treeLow, dLower)
  if (Object.keys(steps).length) moveElements(m, steps)
}

// ---------------------------------------------------------------- connect

/** Which kind of flow joins two elements: decided by what they are and which pools they sit in. */
export function flowKindBetween(m: FlowModel, source: string, target: string): FlowKind {
  const s = nodeOf(m, source)
  const t = nodeOf(m, target)
  const sPool = s ? s.participantId : poolOf(m, source)?.id
  const tPool = t ? t.participantId : poolOf(m, target)?.id
  if (!s && !sPool) throw new ModelError(`No element ${source}`)
  if (!t && !tPool) throw new ModelError(`No element ${target}`)
  if (s?.type === 'annotation' || t?.type === 'annotation') return 'association'
  const sData = s?.type === 'dataObject' || s?.type === 'dataStore'
  const tData = t?.type === 'dataObject' || t?.type === 'dataStore'
  if (sData && tData) throw new ModelError('Data connects to an activity or an event, not to other data')
  if (sData || tData) {
    if (!s || !t) throw new ModelError('Data connects to an activity or an event, not to a pool')
    return 'data'
  }
  if (!s || !t) {
    if (sPool === tPool) throw new ModelError('A message flow joins two different pools')
    return 'message'
  }
  return sPool !== tPool ? 'message' : 'sequence'
}

const FLOW_PREFIX: Record<FlowKind, string> = { sequence: 'Flow', message: 'MessageFlow', association: 'Association', data: 'DataAssociation' }

export function connect(m: FlowModel, source: string, target: string, sides: { source?: Side; target?: Side } = {}): Flow {
  if (source === target) throw new ModelError('A flow must join two different elements')
  const kind = flowKindBetween(m, source, target)
  if (m.flows.some((f) => f.source === source && f.target === target && f.kind === kind)) throw new ModelError('These two are already connected')
  const flow: Flow = { id: nextId(m, FLOW_PREFIX[kind]), kind, source, target, name: '' }
  if (sides.source) flow.sourceSide = sides.source
  if (sides.target) flow.targetSide = sides.target
  m.flows.push(flow)
  return flow
}

/**
 * Sets the route of a flow: the sides it leaves and enters by (undefined = the sides facing each other) and,
 * with `points`, the exact path; without them the path follows the sides. Moving an end of the flow keeps the sides.
 */
export function setFlowRoute(m: FlowModel, flowId: string, route: { source?: Side | null; target?: Side | null; points?: Point[] | null }): void {
  const f = flowOf(m, flowId)
  if (!f) throw new ModelError(`No flow ${flowId}`)
  if (route.source !== undefined) route.source ? (f.sourceSide = route.source) : delete f.sourceSide
  if (route.target !== undefined) route.target ? (f.targetSide = route.target) : delete f.targetSide
  if (route.points === null) delete m.diagram.edges[flowId]
  else if (route.points) {
    if (route.points.length < 2) throw new ModelError('A route needs at least two points')
    m.diagram.edges[flowId] = route.points
  } else if (route.source !== undefined || route.target !== undefined) delete m.diagram.edges[flowId]
}

/** Back to the automatic route: sides facing each other, no bends of the user's. */
export function resetFlowRoute(m: FlowModel, flowId: string): void {
  setFlowRoute(m, flowId, { source: null, target: null, points: null })
}

/** Moves one end of a flow to another element; the kind follows the new ends. */
export function reconnect(m: FlowModel, flowId: string, end: 'source' | 'target', to: string, side?: Side): void {
  const f = flowOf(m, flowId)
  if (!f) throw new ModelError(`No flow ${flowId}`)
  const source = end === 'source' ? to : f.source
  const target = end === 'target' ? to : f.target
  if (source === target) throw new ModelError('A flow must join two different elements')
  const kind = flowKindBetween(m, source, target)
  if (kind !== 'sequence' || f.source !== source) clearDefault(m, flowId)
  Object.assign(f, { source, target, kind })
  if (kind !== 'sequence') delete f.condition
  // The end moved to another element: its old side means nothing there; the one dropped on is kept.
  const key = end === 'source' ? 'sourceSide' : 'targetSide'
  if (side) f[key] = side
  else delete f[key]
  delete m.diagram.edges[flowId]
}

/** Turns a flow around (a message drawn from the receiver, for example). */
export function reverseFlow(m: FlowModel, flowId: string): void {
  const f = flowOf(m, flowId)
  if (!f) throw new ModelError(`No flow ${flowId}`)
  const { source, target } = f
  if (f.kind === 'sequence') clearDefault(m, flowId)
  f.source = target
  f.target = source
  const pts = m.diagram.edges[flowId]
  if (pts) m.diagram.edges[flowId] = [...pts].reverse()
}

// ---------------------------------------------------------------- move and resize

/** Moves elements to new top-left positions; boundary events, sub-process content and pool content come along. */
export function moveElements(m: FlowModel, to: Record<string, Point>): void {
  const delta = new Map<string, Point>()
  for (const [id, p] of Object.entries(to)) {
    const s = m.diagram.shapes[id]
    if (!s) throw new ModelError(`No element ${id}`)
    const d = { x: Math.round(p.x) - s.x, y: Math.round(p.y) - s.y }
    if (poolOf(m, id)) {
      delta.set(id, d)
      for (const l of m.lanes) if (l.participantId === id) delta.set(l.id, d)
      for (const n of m.nodes) if (n.participantId === id) delta.set(n.id, d)
    }
  }
  for (const [id, p] of Object.entries(to)) {
    if (poolOf(m, id)) continue
    const s = m.diagram.shapes[id]
    const d = { x: Math.round(p.x) - s.x, y: Math.round(p.y) - s.y }
    for (const f of withDescendants(m, id)) if (f === id || !(f in to)) delta.set(f, d)
  }
  const moved = new Set<string>()
  for (const [id, d] of delta) {
    const s = m.diagram.shapes[id]
    if (!s || (!d.x && !d.y)) continue
    s.x += d.x
    s.y += d.y
    moved.add(id)
  }
  for (const f of m.flows) {
    const pts = m.diagram.edges[f.id]
    if (!pts || !(moved.has(f.source) || moved.has(f.target))) continue
    const ds = delta.get(f.source)
    const dt = delta.get(f.target)
    // Both ends moved together: the route moves too. Otherwise it is routed again from the new positions.
    if (ds && dt && ds.x === dt.x && ds.y === dt.y) m.diagram.edges[f.id] = pts.map((p) => ({ x: p.x + ds.x, y: p.y + ds.y }))
    else delete m.diagram.edges[f.id]
  }
  // Sub-processes first, so their content finds them where they now are.
  const order = m.nodes.filter((n) => moved.has(n.id)).sort((a, b) => (a.type === 'subProcess' ? 0 : 1) - (b.type === 'subProcess' ? 0 : 1))
  for (const n of order) place(m, n.id)
}

/** How near (model units) a dragged shape must come to a lined-up position to be pulled onto it. */
export const SNAP = 16

/**
 * Where a shape dropped with its top-left at `to` should sit so that the flows it has come out straight:
 * if its centre is within SNAP of the centre of a shape it is joined to (across or along), it is pulled onto
 * that line. The nearest neighbour wins on each axis. Pools, lanes and shapes that are not on the canvas do
 * not count; a shape with no such neighbour stays where it is.
 */
export function snapToNeighbours(m: FlowModel, id: string, to: Point, tolerance = SNAP): Point {
  const s = m.diagram.shapes[id]
  if (!s || poolOf(m, id) || laneOf(m, id)) return to
  const cx = to.x + s.width / 2
  const cy = to.y + s.height / 2
  let bestX: number | undefined
  let bestY: number | undefined
  for (const f of m.flows) {
    const other = f.source === id ? f.target : f.target === id ? f.source : undefined
    const o = other && nodeOf(m, other) ? m.diagram.shapes[other] : undefined
    if (!o) continue
    const ox = o.x + o.width / 2
    const oy = o.y + o.height / 2
    if (Math.abs(ox - cx) <= tolerance && (bestX === undefined || Math.abs(ox - cx) < Math.abs(bestX - cx))) bestX = ox
    if (Math.abs(oy - cy) <= tolerance && (bestY === undefined || Math.abs(oy - cy) < Math.abs(bestY - cy))) bestY = oy
  }
  return { x: bestX === undefined ? to.x : Math.round(bestX - s.width / 2), y: bestY === undefined ? to.y : Math.round(bestY - s.height / 2) }
}

/** New bounds for a task, sub-process, annotation, data, or a pool (its lanes stretch with it). */
export function resizeElement(m: FlowModel, id: string, b: Bounds): void {
  const s = m.diagram.shapes[id]
  if (!s) throw new ModelError(`No element ${id}`)
  const next = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(20, Math.round(b.width)), height: Math.max(20, Math.round(b.height)) }
  if (poolOf(m, id)) {
    const lanes = topLanes(m, id)
    const minH = lanes.length > 1 ? lanes.slice(0, -1).reduce((h, l) => h + m.diagram.shapes[l.id].height, 0) + 40 : 60
    next.height = Math.max(next.height, minH)
    next.width = Math.max(next.width, POOL_HEADER + 100)
    const dyTop = next.y - s.y
    const dyBottom = next.y + next.height - (s.y + s.height)
    lanes.forEach((l, i) => {
      const ls = m.diagram.shapes[l.id]
      // Lanes keep their place after the header and stay flush with the pool's right edge.
      ls.x = next.x + (ls.x - s.x)
      ls.width = next.x + next.width - ls.x
      if (i === 0) {
        ls.y += dyTop
        ls.height -= dyTop
      }
      if (i === lanes.length - 1) ls.height += dyBottom
    })
    Object.assign(s, next)
    for (const n of m.nodes) if (n.participantId === id || !n.participantId) place(m, n.id)
    return
  }
  if (laneOf(m, id)) throw new ModelError('Resize the lane with resizeLane')
  const n = nodeOrThrow(m, id)
  if (n.type === 'event' || n.type === 'gateway') throw new ModelError('Events and gateways keep their size')
  Object.assign(s, next)
  for (const f of m.flows) if (f.source === id || f.target === id) delete m.diagram.edges[f.id]
  if (n.type === 'subProcess' && !n.collapsed) for (const x of m.nodes) if (x.id !== id) place(m, x.id)
}

/** A lane's new height: the lanes below (and what is in them) move, the pool grows or shrinks. */
export function resizeLane(m: FlowModel, id: string, height: number): void {
  const lane = laneOf(m, id)
  const ls = m.diagram.shapes[id]
  if (!lane || !ls || !lane.participantId) throw new ModelError(`No lane ${id}`)
  const dh = Math.max(40, Math.round(height)) - ls.height
  if (!dh) return
  const bottom = ls.y + ls.height
  const pool = m.diagram.shapes[lane.participantId]
  const below: Record<string, Point> = {}
  for (const l of m.lanes) {
    const s = m.diagram.shapes[l.id]
    if (l.participantId === lane.participantId && l.id !== id && s && s.y >= bottom - 1) s.y += dh
  }
  for (const n of m.nodes) {
    const s = m.diagram.shapes[n.id]
    if (n.participantId === lane.participantId && s && centre(s).y > bottom && !(n.type === 'event' && n.attachedTo)) below[n.id] = { x: s.x, y: s.y + dh }
  }
  ls.height += dh
  pool.height += dh
  if (Object.keys(below).length) moveElements(m, below)
}

// ---------------------------------------------------------------- change

export function rename(m: FlowModel, id: string, name: string): void {
  const el = nodeOf(m, id) ?? poolOf(m, id) ?? laneOf(m, id) ?? flowOf(m, id)
  if (!el) throw new ModelError(`No element ${id}`)
  el.name = name
}

export type NodePatch = {
  kind?: TaskKind | GatewayKind
  position?: Exclude<EventPosition, 'boundary'>
  trigger?: EventTrigger
  throwing?: boolean
  interrupting?: boolean
  state?: string
  collapsed?: boolean
  /** Loop or multi-instance marker of a task or sub-process; 'none' removes it. */
  loop?: LoopKind | 'none'
}

/** Triggers BPMN allows per event position (start, intermediate catch and boundary catch; `throw` = intermediate throw). */
export const TRIGGERS: Record<EventPosition | 'throw', EventTrigger[]> = {
  start: ['none', 'message', 'timer', 'signal', 'conditional'],
  intermediate: ['none', 'message', 'timer', 'signal', 'conditional', 'link'],
  throw: ['none', 'message', 'signal', 'escalation', 'link', 'compensation'],
  boundary: ['message', 'timer', 'error', 'signal', 'conditional', 'escalation', 'compensation'],
  end: ['none', 'message', 'error', 'signal', 'terminate', 'escalation', 'compensation'],
}

/** The triggers an event may have where it is. */
export const triggersFor = (e: { position: EventPosition; throwing: boolean }): EventTrigger[] =>
  TRIGGERS[e.position === 'intermediate' && e.throwing ? 'throw' : e.position]

/** Interrupting or not is a choice for a boundary event and for a start event inside a sub-process (an event sub-process). */
export function canInterrupt(m: FlowModel, id: string): boolean {
  const n = nodeOf(m, id)
  return n?.type === 'event' && (n.position === 'boundary' || (n.position === 'start' && !!n.parentId))
}

/**
 * Changes what a node is, keeping its flows: task type, gateway kind, event position, direction and trigger.
 * An event moved where its trigger is not allowed gets the first allowed one ("none" except on a boundary);
 * asking for a trigger not allowed there is refused.
 */
export function updateNode(m: FlowModel, id: string, patch: NodePatch): void {
  const n = nodeOrThrow(m, id)
  if (patch.loop !== undefined) {
    if (n.type !== 'task' && n.type !== 'subProcess') throw new ModelError('Only a task or a sub-process repeats')
    if (patch.loop === 'none') delete n.loop
    else n.loop = patch.loop
  }
  if (n.type === 'task' && patch.kind) n.kind = patch.kind as TaskKind
  else if (n.type === 'gateway' && patch.kind) {
    n.kind = patch.kind as GatewayKind
    if (n.kind === 'parallel' || n.kind === 'eventBased') {
      delete n.defaultFlow
      for (const f of m.flows) if (f.source === id) delete f.condition
    }
  } else if (n.type === 'event') {
    if (patch.position && n.position !== 'boundary') {
      n.position = patch.position
      if (n.position === 'start') n.throwing = false
      if (n.position === 'end') n.throwing = true
    }
    if (patch.throwing !== undefined && n.position === 'intermediate') n.throwing = patch.throwing
    const allowed = triggersFor(n)
    if (patch.trigger) {
      if (!allowed.includes(patch.trigger)) {
        const where = n.position === 'intermediate' ? `${n.throwing ? 'a throwing' : 'a catching'} intermediate` : `a ${n.position}`
        throw new ModelError(`${patch.trigger === 'none' ? 'An event without a trigger' : `A ${patch.trigger} trigger`} is not allowed on ${where} event`)
      }
      n.trigger = patch.trigger
    } else if (!allowed.includes(n.trigger)) n.trigger = allowed[0]
    if (patch.interrupting !== undefined && n.position === 'boundary') n.interrupting = patch.interrupting
    // A start event interrupts unless marked otherwise (as BPMN XML keeps it): only "false" is stored.
    if (patch.interrupting !== undefined && n.position === 'start') n.interrupting = patch.interrupting ? undefined : false
  } else if (n.type === 'dataObject' && patch.state !== undefined) n.state = patch.state.trim() || undefined
  else if (n.type === 'subProcess' && patch.collapsed !== undefined) n.collapsed = patch.collapsed
}

/** Task ↔ sub-process. The id, name, size and flows stay. */
export function convertActivity(m: FlowModel, id: string, to: 'task' | 'subProcess'): void {
  const i = m.nodes.findIndex((n) => n.id === id)
  const n = m.nodes[i]
  if (!n || (n.type !== 'task' && n.type !== 'subProcess')) throw new ModelError('Only a task or a sub-process converts')
  if (n.type === to) return
  if (n.type === 'subProcess' && m.nodes.some((x) => x.parentId === id)) throw new ModelError('Ungroup the sub-process first, or empty it')
  const { participantId, laneId, parentId, name, loop } = n
  m.nodes[i] = to === 'task' ? { id, name, participantId, laneId, parentId, type: 'task', kind: 'task' } : { id, name, participantId, laneId, parentId, type: 'subProcess', collapsed: true }
  if (loop) (m.nodes[i] as { loop?: LoopKind }).loop = loop
}

export function setFlow(m: FlowModel, id: string, patch: { name?: string; condition?: string }): void {
  const f = flowOf(m, id)
  if (!f) throw new ModelError(`No flow ${id}`)
  if (patch.name !== undefined) f.name = patch.name
  if (patch.condition !== undefined) {
    if (f.kind !== 'sequence') throw new ModelError('Only a sequence flow has a condition')
    f.condition = patch.condition.trim() || undefined
  }
}

/** Marks the flow as its gateway's default (taken when no condition holds), or unmarks it. */
export function setDefaultFlow(m: FlowModel, flowId: string, on: boolean): void {
  const f = flowOf(m, flowId)
  const g = f && nodeOf(m, f.source)
  if (!f || f.kind !== 'sequence' || g?.type !== 'gateway' || !['exclusive', 'inclusive', 'complex'].includes(g.kind))
    throw new ModelError('Only a flow leaving an exclusive, inclusive or complex gateway can be the default')
  if (on) {
    g.defaultFlow = flowId
    delete f.condition
  } else if (g.defaultFlow === flowId) delete g.defaultFlow
}

function clearDefault(m: FlowModel, flowId: string) {
  for (const n of m.nodes) if (n.type === 'gateway' && n.defaultFlow === flowId) delete n.defaultFlow
}

export function setModelName(m: FlowModel, name: string): void {
  m.name = name
}

// ---------------------------------------------------------------- delete

/**
 * Deletes elements and what hangs on them: a node takes its flows, boundary events and sub-process content;
 * a pool takes its lanes and process; a lane gives its room and its nodes to the lane next to it.
 */
export function deleteElements(m: FlowModel, ids: string[]): void {
  const gone = new Set<string>()
  for (const id of ids) {
    if (poolOf(m, id)) {
      gone.add(id)
      for (const l of m.lanes) if (l.participantId === id) gone.add(l.id)
      for (const n of m.nodes) if (n.participantId === id) gone.add(n.id)
    } else if (laneOf(m, id)) removeLane(m, id)
    else if (nodeOf(m, id)) for (const x of withDescendants(m, id)) gone.add(x)
    else if (flowOf(m, id)) gone.add(id)
  }
  for (const f of m.flows) if (gone.has(f.source) || gone.has(f.target)) gone.add(f.id)
  for (const id of gone) {
    clearDefault(m, id)
    delete m.diagram.shapes[id]
    delete m.diagram.edges[id]
  }
  m.participants = m.participants.filter((p) => !gone.has(p.id))
  m.lanes = m.lanes.filter((l) => !gone.has(l.id))
  m.nodes = m.nodes.filter((n) => !gone.has(n.id))
  m.flows = m.flows.filter((f) => !gone.has(f.id))
}

function removeLane(m: FlowModel, id: string) {
  const lane = laneOf(m, id)!
  const s = m.diagram.shapes[id]
  const siblings = m.lanes
    .filter((l) => l.participantId === lane.participantId && l.parentLaneId === lane.parentLaneId && l.id !== id && m.diagram.shapes[l.id])
    .sort((a, b) => m.diagram.shapes[a.id].y - m.diagram.shapes[b.id].y)
  // The lane above takes the room (the one below when it was the first): nothing on the canvas moves.
  const heir = s && ([...siblings].reverse().find((l) => m.diagram.shapes[l.id].y < s.y) ?? siblings[0])
  if (heir && s) {
    const hs = m.diagram.shapes[heir.id]
    const top = Math.min(hs.y, s.y)
    hs.height = Math.max(hs.y + hs.height, s.y + s.height) - top
    hs.y = top
  }
  const into = heir?.id ?? lane.parentLaneId
  for (const l of m.lanes) if (l.parentLaneId === id) l.parentLaneId = into
  for (const n of m.nodes) if (n.laneId === id) n.laneId = into
  m.lanes = m.lanes.filter((l) => l.id !== id)
  delete m.diagram.shapes[id]
  for (const n of m.nodes) if (n.participantId === lane.participantId) place(m, n.id)
}

// ---------------------------------------------------------------- copy and paste

/** Shapes taken out of a model for the clipboard: nodes with what hangs on them, the flows among them, their drawing. */
export interface Clip {
  nodes: FlowNode[]
  flows: Flow[]
  shapes: Record<string, Bounds>
  edges: Record<string, Point[]>
}

/**
 * Copies the selected nodes with their boundary events and sub-process content, and the flows whose both
 * ends are copied. Pools, lanes and flows in the selection are left out, a boundary event without its task too.
 * Null when nothing can be copied.
 */
export function copyElements(m: FlowModel, ids: string[]): Clip | null {
  const take = new Set<string>()
  for (const id of ids) {
    const n = nodeOf(m, id)
    if (!n || !m.diagram.shapes[id] || (n.type === 'event' && n.attachedTo && !ids.includes(n.attachedTo))) continue
    for (const x of withDescendants(m, id)) take.add(x)
  }
  if (!take.size) return null
  const clip: Clip = { nodes: m.nodes.filter((n) => take.has(n.id)), flows: m.flows.filter((f) => take.has(f.source) && take.has(f.target)), shapes: {}, edges: {} }
  for (const n of clip.nodes) if (m.diagram.shapes[n.id]) clip.shapes[n.id] = m.diagram.shapes[n.id]
  for (const f of clip.flows) if (m.diagram.edges[f.id]) clip.edges[f.id] = m.diagram.edges[f.id]
  // A plain copy: the model may be an immer draft, and the clipboard outlives it.
  return JSON.parse(JSON.stringify(clip)) as Clip
}

/** How far the n-th paste of a clip lands from the original, per step. */
export const PASTE_STEP = 24

/** The copied shapes that are not inside another copied one or on its border. */
function clipTop(clip: Clip): FlowNode[] {
  const ids = new Set(clip.nodes.map((n) => n.id))
  return clip.nodes.filter((n) => clip.shapes[n.id] && !(n.parentId && ids.has(n.parentId)) && !(n.type === 'event' && n.attachedTo))
}

const laneAt = (m: FlowModel, p: Point) =>
  m.lanes.filter((l) => m.diagram.shapes[l.id] && inside(p, m.diagram.shapes[l.id])).sort((a, b) => area(m.diagram.shapes[a.id]) - area(m.diagram.shapes[b.id]))[0]?.id

/** The shift of the n-th paste: down and to the right, else only right, else only down, so each shape stays in its lane. */
export function pasteOffset(m: FlowModel, clip: Clip, n = 1): Point {
  const d = PASTE_STEP * n
  const tries = [
    { x: d, y: d },
    { x: d, y: 0 },
    { x: 0, y: d },
  ]
  const keeps = (o: Point) =>
    clipTop(clip).every((node) => {
      const c = centre(clip.shapes[node.id])
      return laneAt(m, c) === laneAt(m, { x: c.x + o.x, y: c.y + o.y })
    })
  return tries.find(keeps) ?? tries[0]
}

/**
 * Pastes a clip as new elements with new ids, shifted by `offset` or centred on `at`; `page` = the collapsed
 * sub-process whose page is shown. Pool and lane come from where each shape lands, as after a move.
 * Returns the ids of the pasted shapes that are not inside another pasted one (to select them).
 */
export function pasteClip(m: FlowModel, clip: Clip, opts: { offset?: Point; at?: Point; page?: string } = {}): string[] {
  const top = clipTop(clip)
  if (!top.length) throw new ModelError('Nothing to paste')
  const byId = new Map(clip.nodes.map((n) => [n.id, n]))
  let d = opts.offset ?? { x: PASTE_STEP, y: PASTE_STEP }
  if (opts.at) {
    const box = top.map((n) => clip.shapes[n.id])
    const x0 = Math.min(...box.map((b) => b.x))
    const y0 = Math.min(...box.map((b) => b.y))
    const x1 = Math.max(...box.map((b) => b.x + b.width))
    const y1 = Math.max(...box.map((b) => b.y + b.height))
    d = { x: Math.round(opts.at.x - (x0 + x1) / 2), y: Math.round(opts.at.y - (y0 + y1) / 2) }
  }
  // The content of a collapsed sub-process is on its own page: it does not move.
  const hidden = (n: FlowNode) => {
    for (let p = n.parentId; p && byId.has(p); p = byId.get(p)!.parentId) {
      const h = byId.get(p)!
      if (h.type === 'subProcess' && h.collapsed) return true
    }
    return false
  }
  const newId = new Map<string, string>()
  for (const n of clip.nodes) {
    const s = clip.shapes[n.id]
    if (!s) continue
    const id = nextId(m, PREFIX[n.type])
    newId.set(n.id, id)
    const shift = hidden(n) ? { x: 0, y: 0 } : d
    m.nodes.push({ ...(JSON.parse(JSON.stringify(n)) as FlowNode), id })
    m.diagram.shapes[id] = { ...s, x: s.x + shift.x, y: s.y + shift.y }
  }
  const pasted = (old: string) => nodeOf(m, newId.get(old)!)!
  for (const n of clip.nodes) {
    if (!newId.has(n.id)) continue
    const c = pasted(n.id)
    c.parentId = n.parentId && newId.get(n.parentId)
    if (!c.parentId) delete c.parentId
    if (c.type === 'event' && c.attachedTo) c.attachedTo = newId.get(c.attachedTo)
    if (c.type === 'gateway') delete c.defaultFlow
  }
  // Shapes on top first, then what they hold (outer before inner), boundary events last.
  const depth = (n: FlowNode) => {
    let k = 0
    for (let p = n.parentId; p && byId.has(p); p = byId.get(p)!.parentId) k++
    return k
  }
  const onBorder = (n: FlowNode) => (n.type === 'event' && n.attachedTo ? 1 : 0)
  const order = clip.nodes.filter((n) => newId.has(n.id)).sort((a, b) => onBorder(a) - onBorder(b) || depth(a) - depth(b))
  const put = (id: string) => (opts.page ? putOnPage(m, id, opts.page) : place(m, id))
  for (const n of order) {
    const c = pasted(n.id)
    if (top.includes(n) || onBorder(n)) put(c.id)
    else if (hidden(n)) {
      const parent = nodeOf(m, c.parentId!)!
      c.participantId = parent.participantId
      c.laneId = parent.laneId
    } else {
      // Inside a pasted expanded sub-process: the lane is where it sits, the sub-process stays its parent.
      const parent = c.parentId
      put(c.id)
      c.parentId = parent
    }
  }
  const newFlow = new Map<string, string>()
  for (const f of clip.flows) {
    const source = newId.get(f.source)
    const target = newId.get(f.target)
    if (!source || !target) continue
    let kind: FlowKind
    try {
      kind = flowKindBetween(m, source, target)
    } catch {
      continue
    }
    const id = nextId(m, FLOW_PREFIX[kind])
    newFlow.set(f.id, id)
    m.flows.push({ ...f, id, kind, source, target })
    const pts = clip.edges[f.id]
    const shift = hidden(byId.get(f.source)!) ? { x: 0, y: 0 } : d
    if (pts) m.diagram.edges[id] = pts.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y }))
  }
  for (const n of clip.nodes) {
    if (n.type !== 'gateway' || !n.defaultFlow || !newId.has(n.id)) continue
    const g = pasted(n.id)
    const f = newFlow.get(n.defaultFlow)
    if (g.type === 'gateway' && f && flowOf(m, f)?.kind === 'sequence') g.defaultFlow = f
  }
  return top.map((n) => newId.get(n.id)!)
}

// ---------------------------------------------------------------- group into / ungroup sub-process

/** Thrown when a selection has several ways in or out: the caller asks, then runs again with gateways. */
export class NeedsGatewaysError extends ModelError {}

const GROUP_PAD = 20
/** Room above the content for the sub-process's name. */
const GROUP_TOP = 20
const GROUP_GAP = 40

/**
 * Turns the selected steps of one process level into an expanded sub-process drawn round them (SPEC §6).
 * Flows coming in go to the sub-process and, inside, a start event leads to the step(s) they reached; flows
 * going out leave from the sub-process and, inside, end in an end event (one per place reached outside).
 * Several steps reached from outside need an exclusive gateway after the start event; several places reached
 * outside, one after the sub-process (it repeats the choice made inside, with the same conditions). Without
 * `gateways` that throws NeedsGatewaysError. What sits right of the selection moves right to make room.
 */
export function groupIntoSubprocess(m: FlowModel, ids: string[], opts: { gateways?: boolean; name?: string } = {}): FlowNode {
  if (m.nodes.some((n) => ids.includes(n.id) && n.type === 'event' && n.attachedTo && !ids.includes(n.attachedTo)))
    throw new ModelError('A boundary event goes with its activity: select the activity too')
  const picked = m.nodes.filter((n) => ids.includes(n.id))
  const steps = picked.filter((n) => !isArtifact(n))
  if (!steps.length) throw new ModelError('Select the steps to group: tasks, events, gateways')
  // Only the outermost picked nodes count: what is nested in them comes along.
  const tops = picked.filter((n) => !picked.some((p) => p.id !== n.id && withDescendants(m, p.id).has(n.id)))
  const level = { participantId: tops[0].participantId, parentId: tops[0].parentId }
  if (tops.some((n) => n.participantId !== level.participantId || n.parentId !== level.parentId))
    throw new ModelError('Group steps of one process level: same pool, same sub-process')
  const inside = new Set(tops.flatMap((n) => [...withDescendants(m, n.id)]))
  // Data and notes linked only to the selected steps go with them.
  for (const a of m.nodes) {
    if (!isArtifact(a) || inside.has(a.id) || a.parentId !== level.parentId) continue
    const linked = m.flows.flatMap((f) => (f.source === a.id ? [f.target] : f.target === a.id ? [f.source] : []))
    if (linked.length && linked.every((x) => inside.has(x))) {
      inside.add(a.id)
      tops.push(a)
    }
  }
  // Selected steps on a collapsed sub-process's page: the new one is drawn there too.
  const page = pageOf(m, tops[0].id)

  const seq = m.flows.filter((f) => f.kind === 'sequence')
  const incoming = seq.filter((f) => !inside.has(f.source) && inside.has(f.target))
  const outgoing = seq.filter((f) => inside.has(f.source) && !inside.has(f.target))
  const entries = [...new Set(incoming.map((f) => f.target))]
  const targets = [...new Set(outgoing.map((f) => f.target))]
  const gateIn = entries.length > 1
  const gateOut = targets.length > 1
  if ((gateIn || gateOut) && !opts.gateways) {
    const ways = [gateIn ? `${entries.length} ways in` : '', gateOut ? `${targets.length} ways out` : ''].filter(Boolean).join(' and ')
    throw new NeedsGatewaysError(`The selection has ${ways}: group it with exclusive gateways?`)
  }

  // Room: the start event (and a gateway) on the left, the end events on the right, a gateway after.
  const ev = SIZES.event.width
  const gw = SIZES.gateway.width
  const roomIn = entries.length ? ev + GROUP_GAP + (gateIn ? gw + GROUP_GAP : 0) : 0
  const roomOut = targets.length ? GROUP_GAP + ev : 0
  const outer = gateOut ? GROUP_GAP + gw : 0
  const boxes = [...inside].map((id) => m.diagram.shapes[id]).filter(Boolean)
  const bb = {
    x: Math.min(...boxes.map((b) => b.x)),
    y: Math.min(...boxes.map((b) => b.y)),
    r: Math.max(...boxes.map((b) => b.x + b.width)),
    b: Math.max(...boxes.map((b) => b.y + b.height)),
  }
  // One end event per place reached outside, level with the steps that lead there, none on another.
  const cy = (nid: string) => centre(m.diagram.shapes[nid]).y
  const mid = (xs: string[]) => xs.reduce((t, x) => t + cy(x), 0) / xs.length
  const endY = targets.map((t) => mid([...new Set(outgoing.filter((f) => f.target === t).map((f) => f.source))]))
  const order = targets.map((_, i) => i).sort((a, b) => endY[a] - endY[b])
  order.forEach((i, k) => {
    if (k) endY[i] = Math.max(endY[i], endY[order[k - 1]] + ev + GROUP_GAP)
  })
  if (endY.length) bb.b = Math.max(bb.b, ...endY.map((y) => y + ev / 2))
  // The sub-process stays inside what holds it (it would stick out of a pool's top otherwise).
  const holder = level.parentId ?? level.participantId
  const ceiling = holder && m.diagram.shapes[holder] && (!page || level.parentId !== page) ? m.diagram.shapes[holder].y + (level.parentId ? GROUP_TOP : 0) : -Infinity
  const top = Math.max(bb.y - GROUP_PAD - GROUP_TOP, ceiling)
  const shift = GROUP_PAD + roomIn
  const grow = 2 * GROUP_PAD + roomIn + roomOut + outer
  const box: Bounds = { x: bb.x, y: top, width: bb.r - bb.x + 2 * GROUP_PAD + roomIn + roomOut, height: bb.b + GROUP_PAD - top }
  const sameLevel = (n: FlowNode) => n.participantId === level.participantId && n.parentId === level.parentId && !inside.has(n.id) && !(n.type === 'event' && n.attachedTo)
  const to: Record<string, Point> = {}
  for (const n of tops) to[n.id] = { x: m.diagram.shapes[n.id].x + shift, y: m.diagram.shapes[n.id].y }
  for (const n of m.nodes) {
    const s = m.diagram.shapes[n.id]
    if (s && sameLevel(n) && s.x + s.width / 2 > bb.x) to[n.id] = { x: s.x + grow, y: s.y }
  }
  // Widen first: a step moved past the pool's edge would leave the pool.
  growHolders(m, level, grow, to)
  moveElements(m, to)

  // The sub-process, in the lane holding most of the selected steps.
  const id = nextId(m, 'SubProcess')
  const count = new Map<string | undefined, number>()
  for (const n of steps) count.set(n.laneId, (count.get(n.laneId) ?? 0) + 1)
  const lane = [...count].sort((a, b) => b[1] - a[1])[0][0]
  m.nodes.push({ id, name: opts.name ?? '', type: 'subProcess', collapsed: false })
  m.diagram.shapes[id] = box
  if (page) Object.assign(nodeOf(m, id)!, { parentId: level.parentId, participantId: level.participantId })
  else place(m, id)
  if (lane) nodeOf(m, id)!.laneId = lane
  for (const n of m.nodes.filter((x) => inside.has(x.id))) if (n.type === 'subProcess') place(m, n.id)
  for (const n of m.nodes.filter((x) => inside.has(x.id))) if (n.type !== 'subProcess') place(m, n.id)
  for (const n of tops) nodeOf(m, n.id)!.parentId = id

  // Way in: outer flows end at the sub-process; inside, start → (gateway →) the step(s) they reached.
  if (entries.length) {
    const y = mid(entries)
    const start = addNode(m, { type: 'event', position: 'start' }, { x: box.x + GROUP_PAD + ev / 2, y }, '', page)
    let from = start.id
    if (gateIn) {
      from = addNode(m, { type: 'gateway', kind: 'exclusive' }, { x: box.x + GROUP_PAD + ev + GROUP_GAP + gw / 2, y }, '', page).id
      connect(m, start.id, from)
    }
    for (const e of entries) connect(m, from, e)
    for (const f of incoming) {
      f.target = id
      delete m.diagram.edges[f.id]
    }
    mergeDuplicates(m, id)
  }

  // Way out: inside, the flows end in an end event per place reached; outside, the sub-process (or a gateway after it) leads on.
  if (targets.length) {
    let after = id
    if (gateOut) {
      after = addNode(m, { type: 'gateway', kind: 'exclusive' }, { x: box.x + box.width + GROUP_GAP + gw / 2, y: centre(box).y }, '', page).id
      connect(m, id, after)
    }
    targets.forEach((t, i) => {
      const end = addNode(m, { type: 'event', position: 'end' }, { x: box.x + box.width - GROUP_PAD - ev / 2, y: endY[i] }, '', page)
      const first = outgoing.find((f) => f.target === t)!
      const f = connect(m, after, t)
      // The choice made inside is made again after the sub-process: each branch keeps its name and condition.
      if (gateOut) {
        f.name = first.name
        if (first.condition) f.condition = first.condition
      }
      for (const g of outgoing.filter((x) => x.target === t)) {
        g.target = end.id
        delete m.diagram.edges[g.id]
      }
      mergeDuplicates(m, end.id)
    })
  }
  return nodeOf(m, id)!
}

/**
 * The inverse (SPEC §6): the steps come back to the parent level where they are drawn (a collapsed sub-process's
 * content takes its place), its "none" start and end events go, and the flows that came in and went out join
 * the steps after the start event and before the end event.
 */
export function ungroupSubprocess(m: FlowModel, id: string): void {
  const sp = nodeOf(m, id)
  if (sp?.type !== 'subProcess') throw new ModelError('Select a sub-process to ungroup')
  if (m.nodes.some((n) => n.type === 'event' && n.attachedTo === id))
    throw new ModelError('Delete the boundary events of the sub-process first: afterwards there is nothing to attach them to')
  const kids = m.nodes.filter((n) => n.parentId === id)
  const seq = m.flows.filter((f) => f.kind === 'sequence')
  const none = (n: FlowNode, position: 'start' | 'end') => n.type === 'event' && n.position === position && n.trigger === 'none'
  const starts = kids.filter((n) => none(n, 'start'))
  const ends = kids.filter((n) => none(n, 'end'))
  const startOut = seq.filter((f) => starts.some((x) => x.id === f.source))
  const endIn = seq.filter((f) => ends.some((x) => x.id === f.target))
  const into = seq.filter((f) => f.target === id)
  const outOf = seq.filter((f) => f.source === id)
  if (into.length && !startOut.length) throw new ModelError('The sub-process has no plain start event: ungrouping would not know where the flow comes in')
  if (outOf.length && !endIn.length) throw new ModelError('The sub-process has no plain end event: ungrouping would not know where the flow goes out')

  const s = m.diagram.shapes[id]
  if (sp.collapsed && kids.length && s) {
    // The hidden content is drawn elsewhere: bring it where the sub-process is, and make room on the right.
    const boxes = kids.flatMap((k) => [...withDescendants(m, k.id)]).map((k) => m.diagram.shapes[k]).filter(Boolean)
    const x0 = Math.min(...boxes.map((b) => b.x))
    const y0 = Math.min(...boxes.map((b) => b.y))
    const w = Math.max(...boxes.map((b) => b.x + b.width)) - x0
    const h = Math.max(...boxes.map((b) => b.y + b.height)) - y0
    const extra = Math.max(0, w - s.width)
    const level = { participantId: sp.participantId, parentId: sp.parentId }
    const to: Record<string, Point> = {}
    for (const n of m.nodes) {
      const b = m.diagram.shapes[n.id]
      const peer = n.participantId === level.participantId && n.parentId === level.parentId && !(n.type === 'event' && n.attachedTo)
      if (extra && b && n.id !== id && peer && b.x + b.width / 2 > s.x + s.width / 2) to[n.id] = { x: b.x + extra, y: b.y }
    }
    growHolders(m, level, extra, to)
    if (Object.keys(to).length) moveElements(m, to)
    const d = { x: s.x - x0, y: Math.round(s.y + s.height / 2 - h / 2) - y0 }
    for (const k of kids)
      for (const x of withDescendants(m, k.id)) {
        const b = m.diagram.shapes[x]
        if (b) Object.assign(b, { x: b.x + d.x, y: b.y + d.y })
      }
    for (const f of m.flows) delete m.diagram.edges[f.id]
  }

  // Each flow in reaches each step after a start event; each flow out leaves each step before an end event.
  for (const f of into)
    startOut.forEach((g, i) => {
      if (i === 0) f.target = g.target
      else m.flows.push({ ...f, id: nextId(m, 'Flow'), target: g.target })
    })
  for (const f of outOf) {
    const { name, condition } = f
    endIn.forEach((g, i) => {
      // A flow leaving a gateway inside keeps its own name and condition; else the outer one's.
      const joined: Flow = { ...f, source: g.source, name: g.name || name }
      const cond = g.condition ?? condition
      if (cond) joined.condition = cond
      else delete joined.condition
      if (i === 0) Object.assign(f, joined)
      else m.flows.push({ ...joined, id: nextId(m, 'Flow') })
      const kept = i === 0 ? f.id : m.flows[m.flows.length - 1].id
      for (const n of m.nodes) if (n.type === 'gateway' && n.defaultFlow === g.id) n.defaultFlow = kept
    })
    if (!f.condition) delete f.condition
  }
  // Message flows, data and notes on the sub-process move to its first step in (or last step out).
  const firstIn = startOut[0]?.target ?? kids.find((n) => !isArtifact(n) && !none(n, 'start') && !none(n, 'end'))?.id
  const lastOut = endIn[0]?.source ?? firstIn
  for (const f of m.flows) {
    if (f.kind === 'sequence') continue
    if (f.target === id && firstIn) f.target = firstIn
    if (f.source === id && lastOut) f.source = f.kind === 'association' ? firstIn! : lastOut
  }
  for (const f of m.flows) if (into.includes(f) || outOf.includes(f) || [f.source, f.target].some((x) => x === firstIn || x === lastOut)) delete m.diagram.edges[f.id]

  for (const k of kids) k.parentId = sp.parentId
  m.nodes = m.nodes.filter((n) => n.id !== id)
  delete m.diagram.shapes[id]
  // Without a flow in (or out) the start (or end) events stay: they still start or end those steps.
  deleteElements(m, [...(into.length ? starts : []), ...(outOf.length ? ends : [])].map((n) => n.id))
  for (const n of m.nodes) if (n.participantId === sp.participantId) place(m, n.id)
  // Branches with their own conditions stay apart even when they now join the same two elements.
  for (const t of new Set(m.flows.map((f) => f.target))) mergeDuplicates(m, t, true)
}

/**
 * Flows of the same kind between the same two elements, ending at `nodeId`, become one (with `alike`, only when
 * their names and conditions match too); a gateway's default follows the one kept.
 */
function mergeDuplicates(m: FlowModel, nodeId: string, alike = false) {
  const kept = new Map<string, Flow>()
  const gone = new Set<string>()
  for (const f of m.flows) {
    if (f.target !== nodeId) continue
    const key = `${f.kind}:${f.source}` + (alike ? `:${f.name}:${f.condition ?? ''}` : '')
    const k = kept.get(key)
    if (!k) {
      kept.set(key, f)
      continue
    }
    gone.add(f.id)
    for (const n of m.nodes) if (n.type === 'gateway' && n.defaultFlow === f.id) n.defaultFlow = k.id
  }
  if (!gone.size) return
  m.flows = m.flows.filter((f) => !gone.has(f.id))
  for (const g of gone) delete m.diagram.edges[g]
}

/** Before content at one level moves right by dx (to `to`): its expanded sub-processes and its pool widen to keep it. */
function growHolders(m: FlowModel, level: { participantId?: string; parentId?: string }, dx: number, to: Record<string, Point>) {
  if (dx <= 0) return
  for (let p = level.parentId ? nodeOf(m, level.parentId) : undefined; p; p = p.parentId ? nodeOf(m, p.parentId) : undefined) {
    // A page has no edge to widen: the collapsed sub-process keeps its size, and nothing outside it moves.
    if (p.type === 'subProcess' && p.collapsed) return
    const s = m.diagram.shapes[p.id]
    if (s) resizeElement(m, p.id, { ...s, width: s.width + dx })
  }
  const pool = level.participantId ? m.diagram.shapes[level.participantId] : undefined
  if (!pool) return
  const inPool = m.nodes.filter((n) => n.participantId === level.participantId && m.diagram.shapes[n.id])
  const right = Math.max(...inPool.map((n) => (to[n.id]?.x ?? m.diagram.shapes[n.id].x) + m.diagram.shapes[n.id].width))
  if (right + 30 > pool.x + pool.width) resizeElement(m, level.participantId!, { ...pool, width: right + 30 - pool.x })
}

/**
 * Collapses a sub-process to a task-sized box (its steps go on a page of their own, as in Bizagi) or expands
 * it round its steps. What sits right of it moves left or right by the width it gave up or needs.
 */
export function setCollapsed(m: FlowModel, id: string, collapsed: boolean): void {
  const n = nodeOrThrow(m, id)
  if (n.type !== 'subProcess') throw new ModelError('Only a sub-process collapses')
  if (n.collapsed === collapsed) return
  const s = m.diagram.shapes[id]
  const level = { participantId: n.participantId, parentId: n.parentId }
  const own = withDescendants(m, id)
  const cy = s.y + s.height / 2
  const peersRight = (from: number) =>
    m.nodes.filter((x) => {
      const b = m.diagram.shapes[x.id]
      return b && !own.has(x.id) && x.participantId === level.participantId && x.parentId === level.parentId && !(x.type === 'event' && x.attachedTo) && b.x + b.width / 2 > from
    })
  const ring = m.nodes.filter((x) => x.type === 'event' && x.attachedTo === id)
  const old = { ...s }
  let next: Bounds
  if (collapsed) {
    n.collapsed = true
    next = { x: s.x, y: Math.round(cy - SIZES.subProcess.height / 2), ...SIZES.subProcess }
    const freed = s.width - next.width
    const to: Record<string, Point> = {}
    if (freed > 0) for (const x of peersRight(s.x + s.width)) to[x.id] = { x: m.diagram.shapes[x.id].x - freed, y: m.diagram.shapes[x.id].y }
    Object.assign(s, next)
    if (Object.keys(to).length) moveElements(m, to)
  } else {
    const kids = [...own].filter((k) => k !== id && !ring.some((r) => r.id === k)).map((k) => m.diagram.shapes[k]).filter(Boolean)
    if (kids.length) {
      const x0 = Math.min(...kids.map((b) => b.x))
      const y0 = Math.min(...kids.map((b) => b.y))
      const w = Math.max(...kids.map((b) => b.x + b.width)) - x0
      const h = Math.max(...kids.map((b) => b.y + b.height)) - y0
      next = { x: s.x, y: Math.round(cy - (h + 2 * GROUP_PAD + GROUP_TOP) / 2), width: w + 2 * GROUP_PAD, height: h + 2 * GROUP_PAD + GROUP_TOP }
    } else next = { x: s.x, y: Math.round(cy - 100), width: 350, height: 200 }
    // Not above what holds it.
    const holder = level.parentId ?? level.participantId
    const hs = holder ? m.diagram.shapes[holder] : undefined
    if (hs && !pageOf(m, id) && next.y < hs.y + (level.parentId ? GROUP_TOP : 0)) next.y = hs.y + (level.parentId ? GROUP_TOP : 0)
    const grow = next.width - s.width
    const to: Record<string, Point> = {}
    if (grow > 0) for (const x of peersRight(s.x + s.width / 2)) to[x.id] = { x: m.diagram.shapes[x.id].x + grow, y: m.diagram.shapes[x.id].y }
    growHolders(m, level, grow, to)
    if (Object.keys(to).length) moveElements(m, to)
    // The steps come to where the sub-process is now (their page may have been anywhere).
    if (kids.length) {
      const x0 = Math.min(...kids.map((b) => b.x))
      const y0 = Math.min(...kids.map((b) => b.y))
      const d = { x: next.x + GROUP_PAD - x0, y: next.y + GROUP_TOP + GROUP_PAD - y0 }
      for (const k of own) {
        if (k === id || ring.some((r) => r.id === k)) continue
        const b = m.diagram.shapes[k]
        if (b) Object.assign(b, { x: b.x + d.x, y: b.y + d.y })
      }
      for (const f of m.flows) if (own.has(f.source) && own.has(f.target) && m.diagram.edges[f.id]) m.diagram.edges[f.id] = m.diagram.edges[f.id].map((p) => ({ x: p.x + d.x, y: p.y + d.y }))
    }
    n.collapsed = false
    Object.assign(s, next)
    for (const x of m.nodes) if (own.has(x.id) && x.id !== id && x.parentId === id) place(m, x.id)
  }
  // Boundary events stay on the lower border, as far along as they were (or at its end).
  for (const e of ring) {
    const b = m.diagram.shapes[e.id]
    if (!b) continue
    b.x = Math.round(s.x + Math.min(Math.max(b.x - old.x, 0), s.width - b.width))
    b.y = Math.round(s.y + s.height - b.height / 2)
  }
  for (const f of m.flows) if (own.has(f.source) !== own.has(f.target) || f.source === id || f.target === id) delete m.diagram.edges[f.id]
}

// ---------------------------------------------------------------- figures for the analysis (stage 6)

const figure = (v: number | undefined, what: string, min = 0): number | undefined => {
  if (v === undefined || Number.isNaN(v)) return undefined
  if (!Number.isFinite(v) || v < min) throw new ModelError(`${what} must be a number of at least ${min}`)
  return v
}

/** Sets an activity's duration, waiting time, cost or repeats, or an intermediate event's waiting time (undefined clears it). */
export function setSim(m: FlowModel, id: string, patch: Partial<Record<keyof SimFigures, number | undefined>>): void {
  const n = nodeOrThrow(m, id)
  const activity = n.type === 'task' || n.type === 'subProcess'
  const waits = n.type === 'event' && n.position === 'intermediate' && !n.throwing
  if (!activity && !waits) throw new ModelError('Only an activity or a catching intermediate event has times')
  const sim: SimFigures = { ...n.sim }
  for (const key of ['duration', 'wait', 'cost', 'repeats'] as const) {
    if (!(key in patch)) continue
    if (!activity && key !== 'wait') throw new ModelError('An event only waits: it has no duration or cost')
    const v = figure(patch[key], label(key), key === 'repeats' ? 1 : 0)
    if (v === undefined) delete sim[key]
    else sim[key] = v
  }
  if (Object.keys(sim).length) n.sim = sim
  else delete n.sim
}

const label = (key: string) => key.charAt(0).toUpperCase() + key.slice(1)

/** The share of cases taking a branch of a decision, 0–1 (undefined clears it: the branches left share what remains). */
export function setProbability(m: FlowModel, flowId: string, p: number | undefined): void {
  const f = flowOf(m, flowId)
  const g = f && nodeOf(m, f.source)
  if (!f || f.kind !== 'sequence' || g?.type !== 'gateway' || g.kind === 'parallel') throw new ModelError('Only a branch of a decision has a probability')
  const v = figure(p, 'A probability')
  if (v !== undefined && v > 1) throw new ModelError('A probability is at most 100 %')
  if (v === undefined) delete f.probability
  else f.probability = v
}

/** How many people of a lane's role work at once (undefined = 1). */
export function setCapacity(m: FlowModel, laneId: string, capacity: number | undefined): void {
  const l = laneOf(m, laneId)
  if (!l) throw new ModelError(`No lane ${laneId}`)
  const v = figure(capacity, 'Capacity', 1)
  if (v === undefined) delete l.capacity
  else l.capacity = v
}

export function setSimSettings(m: FlowModel, patch: SimSettings): void {
  const sim: SimSettings = { ...m.sim }
  if ('unit' in patch) sim.unit = patch.unit
  if ('arrivals' in patch) {
    const v = figure(patch.arrivals, 'Arrivals')
    if (v === undefined || v === 0) delete sim.arrivals
    else sim.arrivals = v
  }
  if (!sim.unit) delete sim.unit
  if (Object.keys(sim).length) m.sim = sim
  else delete m.sim
}
