// Auto layout (SPEC §4): one click, left to right, lanes kept. elkjs (layered) orders the steps of each pool
// or expanded sub-process into columns; then each lane gets the rows its steps need, so lanes stay bands and
// a step never leaves its lane, pool or sub-process. Data and annotations go in a row at the bottom of
// their step's lane, under that step. planLayout is async (elkjs is); applyLayout is the undoable op.
import ELK from 'elkjs/lib/elk.bundled.js'
import { isArtifact, POOL_HEADER, type Bounds, type FlowModel, type FlowNode, type Lane } from './metamodel'
import { nodeOf, place, topLanes } from './ops'

/** Room left of the first step: Bizagi writes lane names without a strip, right where a step would sit. */
export const LEFT_MARGIN = 60
const RIGHT_MARGIN = 50
const PAD_TOP = 30
/** Below the last row: event and gateway names hang under the shape. */
const PAD_BOTTOM = 40
const ROW_GAP = 40
const ART_GAP = 20
const LANE_MIN = 120
const POOL_MIN_WIDTH = 400
const POOL_GAP = 60
const SUB_PAD = 20
/** Room for a sub-process's name above its content. */
const SUB_TOP = 30
/** Steps whose centres elkjs put this close share a row. */
const ROW_SNAP = 30

const elk = new ELK()

const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '50',
  'elk.spacing.componentComponent': '40',
  // Steps go to elkjs lane by lane, top to bottom: keeping that order keeps lanes apart.
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
}

type Size = { width: number; height: number }

/** A container whose steps are laid out together: a pool, an expanded sub-process, or the canvas outside pools. */
interface Scope {
  key: string
  members: FlowNode[]
  /** Bands top to bottom: a pool's leaf lanes, or one band. */
  bands: string[]
  bandOf: (n: FlowNode) => number
  arts: { node: FlowNode; reps: string[]; band: number }[]
}

/** Where a step sits relative to its scope's content: x from elkjs, y inside its band. */
interface Placed {
  size: Size
  x: number
  y: number
}

interface ScopeLayout {
  placed: Map<string, Placed>
  bandHeights: number[]
  width: number
}

/** New bounds for every shape that moves. Pools are stacked in their order, all as wide as the widest. */
export async function planLayout(src: FlowModel): Promise<Record<string, Bounds>> {
  const m = src
  const shapes = m.diagram.shapes
  const out: Record<string, Bounds> = {}

  const collapsedAncestor = (n: FlowNode): string | undefined => {
    let top: string | undefined
    for (let p = n.parentId ? nodeOf(m, n.parentId) : undefined; p; p = p.parentId ? nodeOf(m, p.parentId) : undefined)
      if (p.type === 'subProcess' && p.collapsed) top = p.id
    return top
  }
  const hidden = new Set(m.nodes.filter((n) => collapsedAncestor(n)).map((n) => n.id))
  const visible = m.nodes.filter((n) => !hidden.has(n.id) && shapes[n.id])
  const hostOf = (n: FlowNode) => (n.type === 'event' ? n.attachedTo : undefined)
  const isBoundary = (n: FlowNode) => !!hostOf(n)
  const steps = visible.filter((n) => !isArtifact(n) && !isBoundary(n))
  const stepIds = new Set(steps.map((n) => n.id))

  /** The expanded sub-process a step is laid out in (undefined = its pool or the canvas). */
  const scopeKeyOf = (n: FlowNode) => (n.parentId ? `sub:${n.parentId}` : n.participantId ? `pool:${n.participantId}` : 'free')
  /** A step, a boundary event (its host) or something nested deeper, seen from `key`'s level. */
  const repIn = (id: string, key: string): string | undefined => {
    let n = nodeOf(m, id)
    if (n && isBoundary(n)) n = nodeOf(m, hostOf(n)!)
    while (n && stepIds.has(n.id)) {
      if (scopeKeyOf(n) === key) return n.id
      n = n.parentId ? nodeOf(m, n.parentId) : undefined
    }
    return undefined
  }

  // ---- scopes
  const leafLanes = (poolId: string): Lane[] => {
    const below = (l: Lane): Lane[] => {
      const kids = m.lanes.filter((k) => k.parentLaneId === l.id && shapes[k.id]).sort((a, b) => shapes[a.id].y - shapes[b.id].y)
      return kids.length ? kids.flatMap(below) : [l]
    }
    return topLanes(m, poolId).flatMap(below)
  }
  const scopes = new Map<string, Scope>()
  const scope = (key: string): Scope => {
    let s = scopes.get(key)
    if (!s) {
      const leaves = key.startsWith('pool:') ? leafLanes(key.slice(5)) : []
      const index = new Map(leaves.map((l, i) => [l.id, i]))
      const bandOf = (n: FlowNode) => {
        for (let l = n.laneId; l; l = m.lanes.find((x) => x.id === l)?.parentLaneId) if (index.has(l)) return index.get(l)!
        if (!n.laneId) return leaves.length
        // A step in a parent lane (nested lanes): its first leaf.
        return Math.max(0, leaves.findIndex((x) => isUnder(x, n.laneId)))
      }
      const isUnder = (l: Lane, id?: string): boolean => !!id && (l.id === id || (!!l.parentLaneId && isUnder(m.lanes.find((x) => x.id === l.parentLaneId)!, id)))
      s = { key, members: [], bands: leaves.length ? leaves.map((l) => l.id) : [''], bandOf, arts: [] }
      scopes.set(key, s)
    }
    return s
  }
  // Members in band order, then by where they were: elkjs keeps that order where it can.
  const ordered = [...steps].sort((a, b) => shapes[a.id].y - shapes[b.id].y || shapes[a.id].x - shapes[b.id].x)
  for (const n of ordered) scope(scopeKeyOf(n)).members.push(n)
  for (const s of scopes.values()) s.members.sort((a, b) => s.bandOf(a) - s.bandOf(b))

  // Steps in a pool with lanes but outside every lane (Bizagi allows it) get a band of their own at the bottom.
  for (const s of scopes.values()) if (s.bands[0] && s.members.some((n) => s.bandOf(n) === s.bands.length)) s.bands.push('')

  // An artifact stays in its own pool or sub-process (that is where BPMN keeps it), under the steps it is linked to.
  for (const a of visible.filter(isArtifact)) {
    const s = scope(scopeKeyOf(a))
    const linked = m.flows.flatMap((f) => (f.source === a.id ? [f.target] : f.target === a.id ? [f.source] : [])).filter((id) => !hidden.has(id))
    const reps = [...new Set(linked.map((id) => repIn(id, s.key)).filter((x): x is string => !!x))]
    const band = reps.length ? s.bandOf(nodeOf(m, reps[0])!) : s.bandOf(a)
    s.arts.push({ node: a, reps, band: Math.min(band, s.bands.length - 1) })
  }

  // ---- lay out each scope, innermost sub-processes first (their size is what their parent sees)
  const sizes = new Map<string, Size>()
  const sizeOf = (n: FlowNode): Size => sizes.get(n.id) ?? { width: shapes[n.id].width, height: shapes[n.id].height }
  const layouts = new Map<string, ScopeLayout>()
  const depth = (key: string): number => {
    if (!key.startsWith('sub:')) return 0
    const n = nodeOf(m, key.slice(4))
    return 1 + (n ? depth(scopeKeyOf(n)) : 0)
  }
  for (const s of [...scopes.values()].sort((a, b) => depth(b.key) - depth(a.key))) {
    const l = await layoutScope(s, sizeOf, (id) => repIn(id, s.key), m)
    layouts.set(s.key, l)
    if (s.key.startsWith('sub:')) {
      const id = s.key.slice(4)
      const height = l.bandHeights[0] - PAD_TOP - PAD_BOTTOM
      sizes.set(id, {
        width: Math.max(100, l.width + 2 * SUB_PAD),
        height: Math.max(80, (s.members.length || s.arts.length ? height : 0) + SUB_TOP + SUB_PAD),
      })
    }
  }
  // An expanded sub-process with no content keeps its size.
  for (const n of steps) if (n.type === 'subProcess' && !n.collapsed && !scopes.has(`sub:${n.id}`)) sizes.delete(n.id)

  /** Writes a scope's shapes with its content's top-left at (x0, y0); band tops are given. */
  const emit = (key: string, x0: number, bandTops: number[]) => {
    const l = layouts.get(key)
    if (!l) return
    for (const [id, p] of l.placed) {
      const b = { x: Math.round(x0 + p.x), y: Math.round(bandTops[bandIndex.get(id) ?? 0] + p.y), width: p.size.width, height: p.size.height }
      out[id] = b
      if (layouts.has(`sub:${id}`)) emit(`sub:${id}`, b.x + SUB_PAD, [b.y + SUB_TOP - PAD_TOP])
    }
  }
  const bandIndex = new Map<string, number>()
  for (const s of scopes.values()) {
    for (const n of s.members) bandIndex.set(n.id, s.bandOf(n))
    for (const a of s.arts) bandIndex.set(a.node.id, a.band)
  }

  // ---- pools, stacked in their order
  const pools = m.participants.filter((p) => shapes[p.id]).sort((a, b) => shapes[a.id].y - shapes[b.id].y)
  const laneDepth = (l: Lane): number => (l.parentLaneId ? 1 + laneDepth(m.lanes.find((x) => x.id === l.parentLaneId)!) : 1)
  const contentX = (poolId: string, px: number) => {
    const depthMax = Math.max(0, ...m.lanes.filter((l) => l.participantId === poolId && shapes[l.id]).map(laneDepth))
    return px + POOL_HEADER * (1 + depthMax) + LEFT_MARGIN
  }
  const left = pools.length ? shapes[pools[0].id].x : 0
  const width = Math.max(POOL_MIN_WIDTH, ...pools.map((p) => contentX(p.id, left) - left + (layouts.get(`pool:${p.id}`)?.width ?? 0) + RIGHT_MARGIN))
  let y = pools.length ? shapes[pools[0].id].y : 0
  for (const p of pools) {
    const l = layouts.get(`pool:${p.id}`)
    const s = scopes.get(`pool:${p.id}`)
    const leaves = leafLanes(p.id)
    const heights = l?.bandHeights ?? (leaves.length ? leaves.map(() => LANE_MIN) : [Math.max(60, shapes[p.id].height)])
    const tops: number[] = []
    let t = y
    for (const h of heights) {
      tops.push(t)
      t += h
    }
    out[p.id] = { x: left, y, width, height: t - y }
    // Leaf lanes are the bands; a parent lane spans its children.
    leaves.forEach((lane, i) => {
      const x = left + POOL_HEADER * laneDepth(lane)
      out[lane.id] = { x, y: tops[i], width: left + width - x, height: heights[i] }
    })
    const spans = (lane: Lane): Bounds => {
      if (out[lane.id]) return out[lane.id]
      const kids = m.lanes.filter((k) => k.parentLaneId === lane.id && shapes[k.id]).map(spans)
      const x = left + POOL_HEADER * laneDepth(lane)
      const top = Math.min(...kids.map((k) => k.y))
      return (out[lane.id] = { x, y: top, width: left + width - x, height: Math.max(...kids.map((k) => k.y + k.height)) - top })
    }
    for (const lane of m.lanes) if (lane.participantId === p.id && shapes[lane.id]) spans(lane)
    if (s) emit(s.key, contentX(p.id, left), tops)
    y = t + POOL_GAP
  }

  // ---- steps outside pools: below the pools, or where they were
  const free = layouts.get('free')
  if (free) {
    const own = scopes.get('free')!
    const xs = [...own.members, ...own.arts.map((a) => a.node)].map((n) => shapes[n.id])
    const fx = pools.length ? left : Math.min(...xs.map((b) => b.x))
    const fy = pools.length ? y : Math.min(...xs.map((b) => b.y)) - PAD_TOP
    emit('free', fx, [fy])
  }

  // ---- boundary events ride on their host's lower border; hidden content moves with its collapsed sub-process
  for (const e of visible.filter(isBoundary)) {
    const host = out[hostOf(e)!] ?? shapes[hostOf(e)!]
    const old = shapes[hostOf(e)!]
    const s = shapes[e.id]
    const dx = Math.min(Math.max(s.x - old.x, -s.width / 2), host.width - s.width / 2)
    out[e.id] = { ...s, x: Math.round(host.x + dx), y: Math.round(host.y + host.height - s.height / 2) }
  }
  for (const n of m.nodes) {
    if (!hidden.has(n.id) || !shapes[n.id]) continue
    const top = collapsedAncestor(n)!
    const to = out[top]
    if (!to) continue
    const d = { x: to.x - shapes[top].x, y: to.y - shapes[top].y }
    out[n.id] = { ...shapes[n.id], x: shapes[n.id].x + d.x, y: shapes[n.id].y + d.y }
  }
  return out
}

async function layoutScope(s: Scope, sizeOf: (n: FlowNode) => Size, rep: (id: string) => string | undefined, m: FlowModel): Promise<ScopeLayout> {
  const ids = new Set(s.members.map((n) => n.id))
  const edges: { id: string; sources: string[]; targets: string[] }[] = []
  const seen = new Set<string>()
  for (const f of m.flows) {
    if (f.kind !== 'sequence') continue
    const a = rep(f.source)
    const b = rep(f.target)
    if (!a || !b || a === b || !ids.has(a) || !ids.has(b) || seen.has(a + '>' + b)) continue
    seen.add(a + '>' + b)
    edges.push({ id: f.id, sources: [a], targets: [b] })
  }
  const graph = await elk.layout({
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: s.members.map((n) => ({ id: n.id, ...sizeOf(n) })),
    edges,
  })
  const pos = new Map((graph.children ?? []).map((c) => [c.id, { x: c.x ?? 0, cy: (c.y ?? 0) + (c.height ?? 0) / 2 }]))
  const minX = Math.min(0, ...[...pos.values()].map((p) => p.x))
  for (const p of pos.values()) p.x -= minX

  const placed = new Map<string, Placed>()
  const bandHeights: number[] = []
  let right = 0
  for (const n of s.members) right = Math.max(right, pos.get(n.id)!.x + sizeOf(n).width)

  s.bands.forEach((_, band) => {
    // Rows: steps sorted by elkjs's height; a step joins the last row when level with it and not in its way.
    const items = s.members.filter((n) => s.bandOf(n) === band).sort((a, b) => pos.get(a.id)!.cy - pos.get(b.id)!.cy)
    const rows: { anchor: number; ids: string[]; height: number }[] = []
    for (const n of items) {
      const p = pos.get(n.id)!
      const w = sizeOf(n).width
      const last = rows.at(-1)
      const clash = last?.ids.some((id) => {
        const q = pos.get(id)!
        return p.x < q.x + sizeOf(nodeOf(m, id)!).width + 10 && q.x < p.x + w + 10
      })
      if (last && !clash && Math.abs(p.cy - last.anchor) <= ROW_SNAP) {
        last.ids.push(n.id)
        last.height = Math.max(last.height, sizeOf(n).height)
      } else rows.push({ anchor: p.cy, ids: [n.id], height: sizeOf(n).height })
    }
    let y = PAD_TOP
    for (const r of rows) {
      for (const id of r.ids) {
        const size = sizeOf(nodeOf(m, id)!)
        placed.set(id, { size, x: pos.get(id)!.x, y: y + (r.height - size.height) / 2 })
      }
      y += r.height + ROW_GAP
    }
    // Artifacts: one row under the steps, each under the steps it is linked to, none on another.
    const arts = s.arts
      .filter((a) => a.band === band)
      .map((a) => {
        const size = sizeOf(a.node)
        const cs = a.reps.map((id) => placed.get(id) ?? { x: pos.get(id)!.x, size: sizeOf(nodeOf(m, id)!) }).map((p) => p.x + p.size.width / 2)
        return { a, size, cx: cs.length ? cs.reduce((t, c) => t + c, 0) / cs.length : Infinity }
      })
      .sort((p, q) => p.cx - q.cx)
    if (arts.length) {
      let next = 0
      const height = Math.max(...arts.map((x) => x.size.height))
      for (const { a, size, cx } of arts) {
        const x = Math.max(next, cx === Infinity ? right + ART_GAP : cx - size.width / 2)
        placed.set(a.node.id, { size, x, y })
        next = x + size.width + ART_GAP
        right = Math.max(right, x + size.width)
      }
      y += height + ROW_GAP
    }
    const used = rows.length || arts.length ? y - ROW_GAP + PAD_BOTTOM : PAD_TOP + PAD_BOTTOM
    bandHeights.push(s.key.startsWith('pool:') ? Math.max(LANE_MIN, used) : used)
  })
  return { placed, bandHeights, width: right }
}

/** The op: every shape to its planned place, every flow routed again from the new positions. */
export function applyLayout(m: FlowModel, plan: Record<string, Bounds>): void {
  for (const [id, b] of Object.entries(plan)) if (m.diagram.shapes[id]) m.diagram.shapes[id] = { ...b }
  m.diagram.edges = {}
  for (const n of m.nodes) place(m, n.id)
}

/** For tests and scripts: plan and apply in one go. */
export async function autoLayout(m: FlowModel): Promise<void> {
  applyLayout(m, await planLayout(m))
}
