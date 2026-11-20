// Routes for auto layout: every flow gets an orthogonal path that keeps clear of the shapes it does not join,
// bends little, and keeps off the lines already drawn (crossing one costs, running along one costs more). A
// grid is cut along the shapes (their borders, centres and a clear margin around them) and between them; each
// flow is a cheapest-path search over it (A*, a price per bend). Flows are routed short first, so the long
// ones go around. Pure; core/layout calls it once the shapes have their places.
import type { Bounds, Flow, FlowModel, FlowNode, Point } from './metamodel'
import { nodeOf } from './ops'

/** Clear room left between a line and a shape it passes. */
const MARGIN = 12
/** The shortest piece of line out of a shape and into one (the arrow needs room). */
const STUB = 12
const BEND = 40
/** How far round the two ends a flow is first searched for. */
const CORRIDOR = 260
const CROSS = 60
const OVERLAP = 3
/** Flows that share an end overlap at the start (a fork) at a lower price. */
const FRIEND_OVERLAP = 0.3

const DX = [1, 0, -1, 0]
const DY = [0, 1, 0, -1]

interface Port {
  x: number
  y: number
  /** The way out of the shape. */
  dir: number
  cost: number
}

const sideCost = (kind: Flow['kind'], dir: number, boundary: boolean, out: boolean): number => {
  if (boundary) return dir === 1 ? 0 : 5000
  if (kind !== 'sequence') return dir === 1 || dir === 3 ? 0 : 30
  // Sequence flows leave by the right and enter by the left; top and bottom are the second choice.
  const natural = out ? 0 : 2
  if (dir === natural) return 0
  if (dir === 1 || dir === 3) return 16
  return 70
}

function shapePorts(b: Bounds, kind: Flow['kind'], boundary: boolean, out: boolean): Port[] {
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const at = [
    { x: b.x + b.width, y: cy, dir: 0 },
    { x: cx, y: b.y + b.height, dir: 1 },
    { x: b.x, y: cy, dir: 2 },
    { x: cx, y: b.y, dir: 3 },
  ]
  return at.map((p) => ({ ...p, cost: sideCost(kind, p.dir, boundary, out) }))
}

interface Heap {
  f: number[]
  s: number[]
}
function push(h: Heap, f: number, s: number) {
  let i = h.f.length
  h.f.push(f)
  h.s.push(s)
  while (i > 0) {
    const p = (i - 1) >> 1
    if (h.f[p] < f || (h.f[p] === f && h.s[p] <= s)) break
    h.f[i] = h.f[p]
    h.s[i] = h.s[p]
    h.f[p] = f
    h.s[p] = s
    i = p
  }
}
function pop(h: Heap): number {
  const top = h.s[0]
  const lf = h.f.pop()!
  const ls = h.s.pop()!
  const n = h.f.length
  if (n > 0) {
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= n) break
      if (c + 1 < n && (h.f[c + 1] < h.f[c] || (h.f[c + 1] === h.f[c] && h.s[c + 1] < h.s[c]))) c++
      if (lf < h.f[c] || (lf === h.f[c] && ls <= h.s[c])) break
      h.f[i] = h.f[c]
      h.s[i] = h.s[c]
      i = c
    }
    h.f[i] = lf
    h.s[i] = ls
  }
  return top
}

export interface RouteOptions {
  /** Flows to route (default: every sequence and message flow). */
  only?: (f: Flow) => boolean
  /** How many times each flow is routed again among the others (default: fewer for a large drawing). */
  passes?: number
}

/** Orthogonal paths for the flows of `m`, keyed by flow id. Flows that cannot be routed are left out. Gives the page a turn now and then, so a big drawing does not freeze it. */
export async function routeFlows(m: FlowModel, opts: RouteOptions = {}): Promise<Record<string, Point[]>> {
  const shapes = m.diagram.shapes
  const out: Record<string, Point[]> = {}
  const hidden = (n: FlowNode) => {
    for (let p = n.parentId ? nodeOf(m, n.parentId) : undefined; p; p = p.parentId ? nodeOf(m, p.parentId) : undefined) if (p.type === 'subProcess' && p.collapsed) return true
    return false
  }
  const shown = m.nodes.filter((n) => shapes[n.id] && !hidden(n))
  const solid = shown
  const pools = m.participants.filter((p) => shapes[p.id])
  const poolIds = new Set(pools.map((p) => p.id))
  const known = new Set([...shown.map((n) => n.id), ...poolIds])
  const flows = m.flows.filter((f) => known.has(f.source) && known.has(f.target) && (opts.only?.(f) ?? true))
  if (!flows.length) return out

  // ---- the grid: special lines along every shape, plain lines between
  const xsSet = new Set<number>()
  const ysSet = new Set<number>()
  const add = (set: Set<number>, v: number) => set.add(Math.round(v * 2) / 2)
  const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const boxes = [...shown.map((n) => shapes[n.id]), ...pools.map((p) => shapes[p.id])]
  for (const b of boxes) {
    for (const x of [b.x, b.x + b.width / 2, b.x + b.width, b.x - MARGIN, b.x + b.width + MARGIN]) add(xsSet, x)
    for (const y of [b.y, b.y + b.height / 2, b.y + b.height, b.y - MARGIN, b.y + b.height + MARGIN]) add(ysSet, y)
    bbox.x0 = Math.min(bbox.x0, b.x - 3 * MARGIN)
    bbox.y0 = Math.min(bbox.y0, b.y - 3 * MARGIN)
    bbox.x1 = Math.max(bbox.x1, b.x + b.width + 3 * MARGIN)
    bbox.y1 = Math.max(bbox.y1, b.y + b.height + 3 * MARGIN)
  }
  const fill = (set: Set<number>, lo: number, hi: number) => {
    const special = [...set].sort((p, q) => p - q)
    // Plain lines between the special ones give room for parallel lines; a big drawing has plenty of special ones.
    const pitch = special.length > 160 ? 40 : special.length > 90 ? 20 : 10
    const keep: number[] = []
    for (let v = Math.ceil(lo / pitch) * pitch; v <= hi; v += pitch) {
      // A plain line too close to a special one only makes a sliver.
      let k = 0
      let a = 0
      let b = special.length - 1
      while (a <= b) {
        const mid = (a + b) >> 1
        if (special[mid] < v) a = mid + 1
        else b = mid - 1
      }
      k = a
      const near = Math.min(Math.abs((special[k] ?? Infinity) - v), Math.abs((special[k - 1] ?? Infinity) - v))
      if (near >= 4) keep.push(v)
    }
    return [...special, ...keep].sort((p, q) => p - q)
  }
  const xs = fill(xsSet, bbox.x0, bbox.x1)
  const ys = fill(ysSet, bbox.y0, bbox.y1)
  const nx = xs.length
  const ny = ys.length
  const N = nx * ny
  const ixOf = new Map(xs.map((v, i) => [v, i]))
  const iyOf = new Map(ys.map((v, i) => [v, i]))
  const gx = (v: number) => ixOf.get(Math.round(v * 2) / 2)!
  const gy = (v: number) => iyOf.get(Math.round(v * 2) / 2)!
  /** First index at or after v. */
  const lowerX = (v: number) => {
    let a = 0
    let b = nx
    while (a < b) {
      const mid = (a + b) >> 1
      if (xs[mid] < v) a = mid + 1
      else b = mid
    }
    return a
  }
  const lowerY = (v: number) => {
    let a = 0
    let b = ny
    while (a < b) {
      const mid = (a + b) >> 1
      if (ys[mid] < v) a = mid + 1
      else b = mid
    }
    return a
  }

  // ---- per flow state
  const blockedStamp = new Int32Array(N)
  const cost = new Float64Array(N * 4)
  const costStamp = new Int32Array(N * 4)
  const parent = new Int32Array(N * 4)
  let stamp = 0
  // Lines already drawn: the flows that use a piece of grid line (horizontal piece from a node to its right
  // neighbour, vertical piece from a node to the one below), and the flows passing straight through a node.
  const usedH = new Map<number, number[]>()
  const usedV = new Map<number, number[]>()
  const crossH = new Map<number, number[]>()
  const crossV = new Map<number, number[]>()
  const ends = new Map<number, [string, string]>()
  const friends = (a: number, b: number) => {
    const p = ends.get(a)!
    const q = ends.get(b)!
    return p[0] === q[0] || p[1] === q[1] || p[0] === q[1] || p[1] === q[0]
  }

  const boundaryOf = (id: string) => {
    const n = nodeOf(m, id)
    return !!n && n.type === 'event' && !!n.attachedTo
  }
  const ancestorsOf = (id: string) => {
    const set = new Set<string>()
    for (let n = nodeOf(m, id); n; n = n.parentId ? nodeOf(m, n.parentId) : undefined) {
      set.add(n.id)
      if (n.type === 'event' && n.attachedTo) set.add(n.attachedTo)
    }
    return set
  }

  /** Flows shortest first: the long ones then go around what the short ones left. */
  const centre = (id: string) => {
    const b = shapes[id]
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const order = flows
    .map((f, i) => ({ f, i, d: Math.abs(centre(f.source).x - centre(f.target).x) + Math.abs(centre(f.source).y - centre(f.target).y) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)

  flows.forEach((f, i) => ends.set(i, [f.source, f.target]))
  const index = new Map(flows.map((f, i) => [f.id, i]))

  /** Puts a line on the grid (or takes it off), so the flows routed after it see it. */
  const register = (fi: number, route: number[], on: boolean) => {
    // The grid nodes between two of the path's nodes (the stubs skip some) are on the line too.
    const nodes: number[] = []
    for (const n of route) {
      const last = nodes.at(-1)
      if (last !== undefined && last !== n) {
        const step = n % nx !== last % nx ? (n % nx > last % nx ? 1 : -1) : n > last ? nx : -nx
        for (let k = last + step; k !== n; k += step) nodes.push(k)
      }
      nodes.push(n)
    }
    const mark = (map: Map<number, number[]>, key: number) => {
      const list = map.get(key)
      if (on) {
        if (list) list.push(fi)
        else map.set(key, [fi])
      } else if (list) {
        const at = list.indexOf(fi)
        if (at >= 0) list.splice(at, 1)
      }
    }
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]
      const b = nodes[i]
      if (b === a + 1) mark(usedH, a)
      else if (b === a - 1) mark(usedH, b)
      else if (b === a + nx) mark(usedV, a)
      else mark(usedV, b)
      if (i + 1 < nodes.length) {
        const c = nodes[i + 1]
        const horizontalIn = Math.abs(b - a) === 1
        const horizontalOut = Math.abs(c - b) === 1
        if (horizontalIn && horizontalOut) mark(crossH, b)
        else if (!horizontalIn && !horizontalOut) mark(crossV, b)
      }
    }
  }
  const drawn = new Map<number, number[]>()
  let turn = Date.now()

  // The first pass routes every flow; the next ones take each flow off and route it again among the others.
  const passes = opts.passes ?? (flows.length > 110 ? 1 : flows.length > 60 ? 2 : 3)
  for (let pass = 0; pass < passes; pass++)
  for (const { f } of order) {
    if (Date.now() - turn > 40) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      turn = Date.now()
    }
    const fi = index.get(f.id)!
    if (drawn.has(fi)) {
      register(fi, drawn.get(fi)!, false)
      drawn.delete(fi)
    }
    // A flow is first searched for in a corridor round its ends (fast); only if that finds nothing, in the whole drawing.
    const attempt = (tight: boolean): boolean => {
    stamp++
    const own = new Set([...ancestorsOf(f.source), ...ancestorsOf(f.target)])
    // Where the flow may run: inside the sub-process or pool both ends are in; messages between pools run anywhere.
    const sn = nodeOf(m, f.source)
    const tn = nodeOf(m, f.target)
    let win: Bounds | undefined
    if (f.kind === 'sequence' && sn && tn) {
      const holder = sn.parentId && sn.parentId === tn.parentId ? shapes[sn.parentId] : sn.participantId && sn.participantId === tn.participantId && !sn.parentId && !tn.parentId ? shapes[sn.participantId] : undefined
      if (holder) win = { x: holder.x + 8, y: holder.y + 4, width: holder.width - 16, height: holder.height - 8 }
    }
    if (tight) {
      const end = (id: string, other: string) => {
        if (!poolIds.has(id)) return centre(id)
        const p = shapes[id]
        const o = centre(other)
        return { x: o.x, y: p.y >= o.y ? p.y : p.y + p.height }
      }
      const a = end(f.source, f.target)
      const b = end(f.target, f.source)
      const box = { x: Math.min(a.x, b.x) - CORRIDOR, y: Math.min(a.y, b.y) - CORRIDOR, width: Math.abs(a.x - b.x) + 2 * CORRIDOR, height: Math.abs(a.y - b.y) + 2 * CORRIDOR }
      const x0 = Math.max(box.x, win?.x ?? -Infinity)
      const y0 = Math.max(box.y, win?.y ?? -Infinity)
      const x1 = Math.min(box.x + box.width, win ? win.x + win.width : Infinity)
      const y1 = Math.min(box.y + box.height, win ? win.y + win.height : Infinity)
      win = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    }
    const wx0 = win ? lowerX(win.x) : 0
    const wx1 = win ? lowerX(win.x + win.width + 0.01) - 1 : nx - 1
    const wy0 = win ? lowerY(win.y) : 0
    const wy1 = win ? lowerY(win.y + win.height + 0.01) - 1 : ny - 1
    const block = (b: Bounds, grow: number) => {
      const i0 = lowerX(b.x - grow + 0.01)
      const i1 = lowerX(b.x + b.width + grow - 0.01) - 1
      const j0 = lowerY(b.y - grow + 0.01)
      const j1 = lowerY(b.y + b.height + grow - 0.01) - 1
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blockedStamp[j * nx + i] = stamp
    }
    for (const n of solid) {
      if (own.has(n.id)) continue
      if (n.type === 'subProcess' && !n.collapsed) {
        // A sub-process holding shapes is no wall for flows inside it; for the others it is.
        block(shapes[n.id], 0)
        continue
      }
      block(shapes[n.id], n.type === 'event' && n.attachedTo ? 0 : MARGIN)
    }
    for (const id of [f.source, f.target]) if (shapes[id] && !poolIds.has(id)) block(shapes[id], 0)

    // ---- ends
    const portsOf = (id: string, other: string, outgoing: boolean): Port[] => {
      if (!poolIds.has(id)) return shapePorts(shapes[id], f.kind, boundaryOf(id), outgoing)
      // A pool meets a message on its top or bottom border, anywhere along it.
      const p = shapes[id]
      const o = shapes[other]
      const below = p.y >= o.y + o.height
      const above = p.y + p.height <= o.y
      if (!below && !above) return []
      const dir = below ? 3 : 1
      const y = below ? p.y : p.y + p.height
      const ports: Port[] = []
      for (const x of xs) if (x >= p.x + 40 && x <= p.x + p.width - 10) ports.push({ x, y, dir, cost: 0 })
      return ports
    }
    const startPorts = portsOf(f.source, f.target, true)
    const endPorts = portsOf(f.target, f.source, false)
    if (!startPorts.length || !endPorts.length) return false

    /** The grid node a stub of STUB leads to, going `dir` from a port; undefined when blocked on the way. */
    const stubNode = (p: Port): { ix: number; iy: number; length: number } | undefined => {
      let ix = gx(p.x)
      let iy = gy(p.y)
      if (ix === undefined || iy === undefined) return undefined
      const x0 = p.x
      const y0 = p.y
      for (let guard = 0; guard < 400; guard++) {
        ix += DX[p.dir]
        iy += DY[p.dir]
        if (ix < wx0 || ix > wx1 || iy < wy0 || iy > wy1) return undefined
        if (blockedStamp[iy * nx + ix] === stamp) return undefined
        const length = Math.abs(xs[ix] - x0) + Math.abs(ys[iy] - y0)
        if (length >= STUB) return { ix, iy, length }
      }
      return undefined
    }
    const goals = new Map<number, { port: Port; length: number }[]>()
    let gxMin = Infinity
    let gxMax = -Infinity
    let gyMin = Infinity
    let gyMax = -Infinity
    for (const p of endPorts) {
      const s = stubNode(p)
      if (!s) continue
      const key = s.iy * nx + s.ix
      goals.set(key, [...(goals.get(key) ?? []), { port: p, length: s.length }])
      gxMin = Math.min(gxMin, xs[s.ix])
      gxMax = Math.max(gxMax, xs[s.ix])
      gyMin = Math.min(gyMin, ys[s.iy])
      gyMax = Math.max(gyMax, ys[s.iy])
    }
    if (!goals.size) return false
    const h = (ix: number, iy: number) => {
      const dx = xs[ix] < gxMin ? gxMin - xs[ix] : xs[ix] > gxMax ? xs[ix] - gxMax : 0
      const dy = ys[iy] < gyMin ? gyMin - ys[iy] : ys[iy] > gyMax ? ys[iy] - gyMax : 0
      return dx + dy
    }

    const heap: Heap = { f: [], s: [] }
    const termInfo: { g: number; from: number; port: Port; startPort: Port }[] = []
    const startOf = new Map<number, { port: Port; length: number }>()
    for (const p of startPorts) {
      const s = stubNode(p)
      if (!s) continue
      const state = (s.iy * nx + s.ix) * 4 + p.dir
      const g = s.length + p.cost
      if (costStamp[state] === stamp && cost[state] <= g) continue
      costStamp[state] = stamp
      cost[state] = g
      parent[state] = -1
      startOf.set(state, { port: p, length: s.length })
      push(heap, g + h(s.ix, s.iy), state)
    }
    let best: { g: number; state: number; goal: { port: Port; length: number }; turn: number } | undefined
    let guard = 0
    while (heap.f.length) {
      const f0 = heap.f[0]
      const state = pop(heap)
      if (state < -1) {
        // A finished route waiting its turn: the first one popped is the cheapest.
        const t = termInfo[-state - 2]
        best = { g: t.g, state: t.from, goal: { port: t.port, length: 0 }, turn: 0 }
        break
      }
      const node = state >> 2
      const dir = state & 3
      const g = cost[state]
      // A cheaper way here was found after this entry was queued: skip the old one.
      if (f0 > g + h(node % nx, (node / nx) | 0) + 1e-6) continue
      if (++guard > 400000) break
      const ix = node % nx
      const iy = (node / nx) | 0
      // Reached the stub node of an end?
      const gl = goals.get(node)
      if (gl) {
        for (const { port, length } of gl) {
          const inward = (port.dir + 2) % 4
          const total = g + (dir === inward ? 0 : BEND) + length + port.cost
          const id = termInfo.length
          termInfo.push({ g: total, from: state, port, startPort: port })
          push(heap, total, -id - 2)
        }
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((dir + 2) & 3)) continue
        const jx = ix + DX[nd]
        const jy = iy + DY[nd]
        if (jx < wx0 || jx > wx1 || jy < wy0 || jy > wy1) continue
        const nn = jy * nx + jx
        if (blockedStamp[nn] === stamp) continue
        const len = Math.abs(xs[jx] - xs[ix]) + Math.abs(ys[jy] - ys[iy])
        let c = g + len + (nd === dir ? 0 : BEND)
        // Lines already there: the piece of line this move runs along, and whether it crosses one at the node.
        const horizontal = nd === 0 || nd === 2
        const edgeKey = horizontal ? (nd === 0 ? node : nn) : nd === 1 ? node : nn
        const users = (horizontal ? usedH : usedV).get(edgeKey)
        if (users) for (const u of users) c += len * (friends(u, fi) ? FRIEND_OVERLAP : OVERLAP)
        // Going straight through the node while another line goes straight through it across ours.
        if (nd === dir) {
          const cr = (horizontal ? crossV : crossH).get(node)
          if (cr && cr.some((u) => !friends(u, fi))) c += CROSS
        }
        const ns = nn * 4 + nd
        if (costStamp[ns] === stamp && cost[ns] <= c) continue
        costStamp[ns] = stamp
        cost[ns] = c
        parent[ns] = state
        push(heap, c + h(jx, jy), ns)
      }
    }
    if (!best) return false

    // ---- the path, from the end back to the start
    const pts: Point[] = [{ x: best.goal.port.x, y: best.goal.port.y }]
    const nodesPath: number[] = []
    let st = best.state
    for (let guard2 = 0; st >= 0 && guard2 < 100000; guard2++) {
      const node = st >> 2
      pts.push({ x: xs[node % nx], y: ys[(node / nx) | 0] })
      nodesPath.push(node)
      st = parent[st]
    }
    nodesPath.reverse()
    // The start state is the stub node: find its port.
    const startState = nodesPathStartState(best.state, parent, startOf)
    const first = startOf.get(startState)
    if (first) pts.push({ x: first.port.x, y: first.port.y })
    pts.reverse()
    const clean = simplifyPath(pts)
    out[f.id] = clean

    // ---- remember the line, for the flows still to come
    const endNodes = [first ? gy(first.port.y) * nx + gx(first.port.x) : undefined, best.goal.port ? gy(best.goal.port.y) * nx + gx(best.goal.port.x) : undefined]
    const whole = [...(endNodes[0] === undefined ? [] : [endNodes[0]]), ...nodesPath, ...(endNodes[1] === undefined || Number.isNaN(endNodes[1]) ? [] : [endNodes[1]])]
    register(fi, whole, true)
    drawn.set(fi, whole)
    return true
    }
    if (!attempt(true)) attempt(false)
  }
  return out
}

/** The start state (stub node and direction) that a search path began from. */
function nodesPathStartState(lastState: number, parent: Int32Array, startOf: Map<number, unknown>): number {
  let st = lastState
  for (let guard = 0; guard < 100000; guard++) {
    if (startOf.has(st)) return st
    const p = parent[st]
    if (p < 0) return st
    st = p
  }
  return st
}

function simplifyPath(pts: Point[]): Point[] {
  const out: Point[] = []
  for (const p of pts) {
    const last = out.at(-1)
    if (last && last.x === p.x && last.y === p.y) continue
    out.push(p)
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1]
    const b = out[i]
    const c = out[i + 1]
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) out.splice(i, 1)
  }
  return out
}
