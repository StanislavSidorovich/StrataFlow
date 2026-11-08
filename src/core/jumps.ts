// Line jumps (bridges): where two flows cross without joining, the horizontal one hops over the vertical one with
// a small semicircle. Pure geometry; the canvas and the exported pictures both draw from the same path. The rule
// does not depend on drawing order or selection (the horizontal line always hops), so nothing flickers while a
// shape is dragged. A crossing needs room on both lines, so a point where lines meet (a shared end, a junction)
// or a corner is never a crossing.
import type { Point } from './metamodel'

export const JUMP_R = 5 // radius of the hop, in diagram pixels
const EDGE = JUMP_R + 2 // a crossing closer than this to the end of a segment is a junction or a corner

/** The crossings where the horizontal parts of `paths[id]` hop over the vertical parts of the other paths. */
export function findJumps(paths: Map<string, Point[]>): Map<string, Point[]> {
  const verticals: { id: string; x: number; y0: number; y1: number }[] = []
  for (const [id, pts] of paths)
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (a.x === b.x && a.y !== b.y) verticals.push({ id, x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) })
    }
  const out = new Map<string, Point[]>()
  for (const [id, pts] of paths) {
    const found: Point[] = []
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (a.y !== b.y || a.x === b.x) continue
      const x0 = Math.min(a.x, b.x)
      const x1 = Math.max(a.x, b.x)
      for (const v of verticals) {
        if (v.id === id || v.x < x0 + EDGE || v.x > x1 - EDGE || a.y < v.y0 + 1 || a.y > v.y1 - 1) continue
        found.push({ x: v.x, y: a.y })
      }
    }
    if (found.length) out.set(id, found)
  }
  return out
}

/** An SVG path along `pts` with a semicircular hop at each of `jumps` that lies on a horizontal part. */
export function pathWithJumps(pts: Point[], jumps: Point[] | undefined): string {
  let d = `M${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (a.y === b.y && jumps?.length) {
      const dir = b.x > a.x ? 1 : -1
      const on = jumps
        .filter((j) => j.y === a.y && j.x > Math.min(a.x, b.x) + EDGE - 1 && j.x < Math.max(a.x, b.x) - EDGE + 1)
        .sort((p, q) => (p.x - q.x) * dir)
      let last = -Infinity
      for (const j of on) {
        const at = j.x * dir
        if (at - last < 2 * JUMP_R + 2) continue // two hops would touch: the second line goes straight
        last = at
        // Over the other line: left to right is clockwise on screen, right to left counter-clockwise.
        d += ` L${j.x - dir * JUMP_R} ${a.y} A${JUMP_R} ${JUMP_R} 0 0 ${dir > 0 ? 1 : 0} ${j.x + dir * JUMP_R} ${a.y}`
      }
    }
    d += ` L${b.x} ${b.y}`
  }
  return d
}
