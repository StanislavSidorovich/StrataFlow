// How tidy a drawing is, as numbers (the yardstick for auto layout): lines through shapes they do not join,
// lines crossing each other, bends, shapes on shapes, end events that are not the last thing in their pool,
// and flow names lying on a line, a shape or a lane border. Pure; reads the drawn paths (own bends, else the route).
import { edgeLabelBoxes } from './layoutQualityParts'
import { isArtifact, type Bounds, type Flow, type FlowModel, type FlowNode, type Point } from './metamodel'
import { flowPath, nodeOf } from './ops'

export interface LayoutQuality {
  /** Flows drawn (sequence, message, data and association). */
  flows: number
  /** Shapes drawn. */
  elements: number
  /** Line segments that run through a shape the flow does not join. */
  lineThroughShape: number
  /** Pairs of segments of different flows that cross or run on top of each other. */
  lineCrossings: number
  /** Corners on all the lines. */
  bends: number
  /** Pairs of shapes that overlap. */
  shapeOverlaps: number
  /** End events with a step of their pool starting to their right. */
  endNotRightmost: number
  /** Flow names that lie on a line, a shape or a lane border. */
  labelsOnLine: number
}

type Seg = [Point, Point]
const segs = (pts: Point[]): Seg[] => pts.slice(1).map((p, i) => [pts[i], p] as Seg)

/** True when the axis-aligned segment goes through the inside of the box (a 1 px skin does not count). */
export function segHitsBox(a: Point, b: Point, r: Bounds, skin = 1): boolean {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  return x1 > r.x + skin && x0 < r.x + r.width - skin && y1 > r.y + skin && y0 < r.y + r.height - skin
}

/** Two axis-aligned segments of different flows: crossing in a point, or sharing a stretch of line. */
export function segmentsMeet(p: Seg, q: Seg): boolean {
  const ph = p[0].y === p[1].y
  const qh = q[0].y === q[1].y
  const lo = (a: number, b: number) => Math.min(a, b)
  const hi = (a: number, b: number) => Math.max(a, b)
  if (ph !== qh) {
    const [h, v] = ph ? [p, q] : [q, p]
    return v[0].x > lo(h[0].x, h[1].x) + 1 && v[0].x < hi(h[0].x, h[1].x) - 1 && h[0].y > lo(v[0].y, v[1].y) + 1 && h[0].y < hi(v[0].y, v[1].y) - 1
  }
  if (ph) return Math.abs(p[0].y - q[0].y) < 1 && Math.min(hi(p[0].x, p[1].x), hi(q[0].x, q[1].x)) - Math.max(lo(p[0].x, p[1].x), lo(q[0].x, q[1].x)) > 2
  return Math.abs(p[0].x - q[0].x) < 1 && Math.min(hi(p[0].y, p[1].y), hi(q[0].y, q[1].y)) - Math.max(lo(p[0].y, p[1].y), lo(q[0].y, q[1].y)) > 2
}

export function layoutQuality(m: FlowModel): LayoutQuality {
  return analyse(m).quality
}

/** The flow names that lie on a line, a shape or a lane border, and what they lie on (for tests and debugging). */
export function labelProblems(m: FlowModel): { name: string; why: string; box: Bounds }[] {
  return analyse(m).labels.filter((l) => l.bad).map((l) => ({ name: m.flows.find((f) => f.id === l.id)?.name ?? '', why: l.why, box: l.box }))
}

function analyse(m: FlowModel) {
  const shapes = m.diagram.shapes
  const hiddenBy = (n: FlowNode) => {
    for (let p = n.parentId ? nodeOf(m, n.parentId) : undefined; p; p = p.parentId ? nodeOf(m, p.parentId) : undefined) if (p.type === 'subProcess' && p.collapsed) return true
    return false
  }
  const shown = m.nodes.filter((n) => shapes[n.id] && !hiddenBy(n))
  const shownIds = new Set(shown.map((n) => n.id))
  const isBoundary = (n: FlowNode) => n.type === 'event' && !!n.attachedTo
  const ancestors = (id: string) => {
    const out = new Set<string>()
    for (let n = nodeOf(m, id); n; n = n.parentId ? nodeOf(m, n.parentId) : undefined) {
      out.add(n.id)
      if (n.type === 'event' && n.attachedTo) out.add(n.attachedTo)
    }
    return out
  }
  /** What a line may not run through: steps, events, gateways, data and annotations (not a sub-process that holds shapes). */
  const solid = shown.filter((n) => !(n.type === 'subProcess' && !n.collapsed))

  const isPool = (id: string) => m.participants.some((p) => p.id === id)
  const flows: Flow[] = m.flows.filter((f) => (shownIds.has(f.source) || isPool(f.source)) && (shownIds.has(f.target) || isPool(f.target)))
  const paths = new Map<string, Point[]>()
  for (const f of flows) {
    const p = flowPath(m, f)
    if (p) paths.set(f.id, p)
  }

  let lineThroughShape = 0
  let bends = 0
  for (const [id, pts] of paths) {
    const f = flows.find((x) => x.id === id)!
    const own = new Set([...ancestors(f.source), ...ancestors(f.target)])
    bends += Math.max(0, pts.length - 2)
    for (const n of solid) {
      if (own.has(n.id)) continue
      if (segs(pts).some(([a, b]) => segHitsBox(a, b, shapes[n.id]))) lineThroughShape++
    }
  }

  let lineCrossings = 0
  const ids = [...paths.keys()]
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const f = flows.find((x) => x.id === ids[i])!
      const g = flows.find((x) => x.id === ids[j])!
      if (f.source === g.source || f.target === g.target || f.source === g.target || f.target === g.source) continue
      for (const p of segs(paths.get(f.id)!)) for (const q of segs(paths.get(g.id)!)) if (segmentsMeet(p, q)) lineCrossings++
    }

  const overlap = (a: Bounds, b: Bounds) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1
  const drawn = shown.filter((n) => !isBoundary(n))
  let shapeOverlaps = 0
  for (let i = 0; i < drawn.length; i++)
    for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i]
      const b = drawn[j]
      if (ancestors(a.id).has(b.id) || ancestors(b.id).has(a.id)) continue
      if (overlap(shapes[a.id], shapes[b.id])) shapeOverlaps++
    }

  let endNotRightmost = 0
  for (const e of drawn) {
    if (e.type !== 'event' || e.position !== 'end') continue
    const late = drawn.some((n) => n !== e && !isArtifact(n) && !(n.type === 'event' && n.position === 'end') && n.participantId === e.participantId && n.parentId === e.parentId && shapes[n.id].x > shapes[e.id].x + 1)
    if (late) endNotRightmost++
  }

  const labels = edgeLabelBoxes(m, flows, paths, solid)
  const labelsOnLine = labels.filter((l) => l.bad).length

  const quality: LayoutQuality = { flows: paths.size, elements: drawn.length, lineThroughShape, lineCrossings, bends, shapeOverlaps, endNotRightmost, labelsOnLine }
  return { quality, labels }
}
