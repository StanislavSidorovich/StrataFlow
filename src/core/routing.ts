// Orthogonal routes between the sides of two shapes, and the edits a user makes to one: choosing the side a
// flow leaves or enters by, dragging a segment, dragging an end. Pure geometry (SPEC §6); the canvas and the
// BPMN writer both draw a flow from what is made here, so what is seen is what is exported.
import type { Bounds, Flow, Point, Side } from './metamodel'

const M = 20 // room left outside a shape when a route has to go around

const OUT: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }
const horizontal = (s: Side) => s === 'left' || s === 'right'

/** The middle of a side; a pool's long top or bottom border is met straight above or below `towards`. */
export function anchor(b: Bounds, side: Side, towards?: Point, pool = false): Point {
  if (side === 'left') return { x: b.x, y: b.y + b.height / 2 }
  if (side === 'right') return { x: b.x + b.width, y: b.y + b.height / 2 }
  const y = side === 'top' ? b.y : b.y + b.height
  if (pool && towards) return { x: Math.min(Math.max(towards.x, b.x + 40), b.x + b.width - 10), y }
  return { x: b.x + b.width / 2, y }
}

/** The side of a shape nearest to a point: where a flow dropped there should attach. */
export function nearestSide(b: Bounds, p: Point): Side {
  const dx = (p.x - (b.x + b.width / 2)) / Math.max(b.width, 1)
  const dy = (p.y - (b.y + b.height / 2)) / Math.max(b.height, 1)
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'top' : 'bottom'
}

/** The sides of two shapes that face each other: left/right when apart sideways, else top/bottom. */
export function facing(s: Bounds, t: Bounds, preferVertical: boolean): [Side, Side] {
  const apartX = t.x >= s.x + s.width + 10 ? 1 : t.x + t.width <= s.x - 10 ? -1 : 0
  const apartY = t.y >= s.y + s.height + 10 ? 1 : t.y + t.height <= s.y - 10 ? -1 : 0
  if (apartX && !(preferVertical && apartY)) return apartX > 0 ? ['right', 'left'] : ['left', 'right']
  return apartY >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

/** Drops repeated points and the middle point of every straight run. */
export function simplify(pts: Point[]): Point[] {
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

/**
 * An orthogonal path from one side of `s` to one side of `t`. Facing sides get one bend in the middle;
 * a side that does not face the other shape leaves and enters with a short step outward, then goes around.
 */
export function routeSides(s: Bounds, ss: Side, t: Bounds, ts: Side, pools: { source?: boolean; target?: boolean } = {}): Point[] {
  const a0 = anchor(s, ss)
  const b0 = anchor(t, ts)
  const a = pools.source ? anchor(s, ss, b0, true) : a0
  const b = pools.target ? anchor(t, ts, a, true) : b0
  const os = OUT[ss]
  const ot = OUT[ts]
  const a1 = { x: a.x + os.x * M, y: a.y + os.y * M }
  const b1 = { x: b.x + ot.x * M, y: b.y + ot.y * M }
  const hs = horizontal(ss)
  const ht = horizontal(ts)
  const ahead = (from: Point, o: Point, to: Point) => (to.x - from.x) * o.x + (to.y - from.y) * o.y > 0

  if (hs && ht) {
    if (ss !== ts && ahead(a, os, b) && ahead(b, ot, a)) {
      const mid = Math.round((a.x + b.x) / 2)
      return simplify([a, { x: mid, y: a.y }, { x: mid, y: b.y }, b])
    }
    if (ss === ts) {
      const x = ss === 'right' ? Math.max(a.x, b.x) + M : Math.min(a.x, b.x) - M
      return simplify([a, { x, y: a.y }, { x, y: b.y }, b])
    }
    // Opposite sides turned away from each other: around, through the gap between the shapes or over both.
    const apart = s.y + s.height < t.y || t.y + t.height < s.y
    const y = apart ? Math.round((Math.min(s.y + s.height, t.y + t.height) + Math.max(s.y, t.y)) / 2) : Math.min(s.y, t.y) - M
    return simplify([a, a1, { x: a1.x, y }, { x: b1.x, y }, b1, b])
  }
  if (!hs && !ht) {
    if (ss !== ts && ahead(a, os, b) && ahead(b, ot, a)) {
      const mid = Math.round((a.y + b.y) / 2)
      return simplify([a, { x: a.x, y: mid }, { x: b.x, y: mid }, b])
    }
    if (ss === ts) {
      const y = ss === 'bottom' ? Math.max(a.y, b.y) + M : Math.min(a.y, b.y) - M
      return simplify([a, { x: a.x, y }, { x: b.x, y }, b])
    }
    const apart = s.x + s.width < t.x || t.x + t.width < s.x
    const x = apart ? Math.round((Math.min(s.x + s.width, t.x + t.width) + Math.max(s.x, t.x)) / 2) : Math.min(s.x, t.x) - M
    return simplify([a, a1, { x, y: a1.y }, { x, y: b1.y }, b1, b])
  }
  // One horizontal end and one vertical end: a single corner when both directions allow it.
  const corner = hs ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
  if (ahead(a, os, corner) && ahead(b, ot, corner)) return simplify([a, corner, b])
  return hs ? simplify([a, a1, { x: a1.x, y: b1.y }, b1, b]) : simplify([a, a1, { x: b1.x, y: a1.y }, b1, b])
}

/** True when every segment of the path is horizontal or vertical. */
export const isOrthogonal = (pts: Point[]) => pts.every((p, i) => i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y)

/**
 * Moves segment `i` (from pts[i] to pts[i+1]) sideways by `d` (only the part across the segment counts).
 * The segments before and after stretch along; at an end of the path a step is added instead, so the end
 * stays on its shape's side.
 */
export function dragSegment(pts: Point[], i: number, d: Point): Point[] {
  const p = pts[i]
  const q = pts[i + 1]
  if (!p || !q) return pts
  const across = p.y === q.y ? { x: 0, y: d.y } : p.x === q.x ? { x: d.x, y: 0 } : null
  if (!across) return pts
  const moved = (x: Point) => ({ x: x.x + across.x, y: x.y + across.y })
  const head = i === 0 ? [p, moved(p)] : [...pts.slice(0, i), moved(p)]
  const tail = i + 1 === pts.length - 1 ? [moved(q), q] : [moved(q), ...pts.slice(i + 2)]
  return simplify([...head, ...tail])
}

/** An orthogonal path between the sides of two shapes that face each other (as edges.tsx draws it). */
export function route(f: Pick<Flow, 'kind' | 'sourceSide' | 'targetSide'>, s: Bounds | undefined, t: Bounds | undefined, toPool = false, fromPool = false): Point[] | undefined {
  if (!s || !t) return undefined
  if (f.sourceSide || f.targetSide) {
    // The user chose a side: the same route the canvas draws.
    const [fs, ft] = facing(s, t, f.kind === 'message')
    return routeSides(s, f.sourceSide ?? fs, t, f.targetSide ?? ft, { source: fromPool, target: toPool })
  }
  const apartX = t.x >= s.x + s.width + 10 ? 1 : t.x + t.width <= s.x - 10 ? -1 : 0
  const apartY = t.y >= s.y + s.height + 10 ? 1 : t.y + t.height <= s.y - 10 ? -1 : 0
  const cy = (b: Bounds) => b.y + b.height / 2
  const cx = (b: Bounds) => b.x + b.width / 2
  if (apartX && !(f.kind === 'message' && apartY)) {
    const a = { x: apartX > 0 ? s.x + s.width : s.x, y: cy(s) }
    const b = { x: apartX > 0 ? t.x : t.x + t.width, y: cy(t) }
    const mid = Math.round((a.x + b.x) / 2)
    return a.y === b.y ? [a, b] : [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b]
  }
  const down = apartY >= 0
  const a = { x: cx(s), y: down ? s.y + s.height : s.y }
  const b = { x: cx(t), y: down ? t.y : t.y + t.height }
  // A message to or from a pool meets the pool's border straight above or below the other end.
  if (toPool) b.x = Math.min(Math.max(a.x, t.x + 40), t.x + t.width - 10)
  if (fromPool) a.x = Math.min(Math.max(b.x, s.x + 40), s.x + s.width - 10)
  const mid = Math.round((a.y + b.y) / 2)
  return a.x === b.x ? [a, b] : [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b]
}
