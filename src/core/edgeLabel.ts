// Where the name of a flow ("Yes", "No", a condition) is drawn: next to the start of the line, a few pixels off it,
// on the side the line does not turn to. The canvas and the layout-quality measure read the same rule, so what is
// measured is what is seen. Pure geometry.
import type { Bounds, Point } from './metamodel'

/** Room between the label and the line. */
const GAP = 3
/** Height of one line of a label (11 px text and a little padding). */
const LABEL_H = 16
const CHAR_W = 6.2
const PAD_X = 6

export function labelSize(name: string): { width: number; height: number } {
  return { width: Math.round(name.length * CHAR_W + PAD_X), height: LABEL_H }
}

const meets = (a: Bounds, b: Bounds) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const hitsSegment = (r: Bounds, p: Point, q: Point) => Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.width && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.height

/** Boxes beside segment `i`, both sides, the preferred one first (above a horizontal run unless the line turns up; right of a vertical one unless it turns right). */
function candidates(pts: Point[], i: number, width: number, height: number, lead: number): Bounds[] {
  const a = pts[i]
  const b = pts[i + 1]
  const next = pts[i + 2]
  if (a.y === b.y) {
    const dir = Math.sign(b.x - a.x) || 1
    const x = dir > 0 ? a.x + GAP + lead : a.x - GAP - width - lead
    const above = { x, y: a.y - GAP - height, width, height }
    const below = { x, y: a.y + GAP, width, height }
    return next && next.y < b.y ? [below, above] : [above, below]
  }
  const dir = Math.sign(b.y - a.y) || 1
  const y = dir > 0 ? a.y + GAP + lead : a.y - GAP - height - lead
  const right = { x: a.x + GAP, y, width, height }
  const left = { x: a.x - GAP - width, y, width, height }
  return next && next.x > b.x ? [left, right] : [right, left]
}

/**
 * The box of a flow label. It sits beside the line near its start, clear of the shape the flow leaves: the first
 * place (the first segment, then the next ones, each side) where it touches no shape in `obstacles` and none of
 * the flow's own other segments; when every place is taken, the first choice. A short first segment (under the
 * label's length) is tried last, since the label would hang past its bend.
 */
export function labelBox(pts: Point[], name: string, obstacles: Bounds[] = [], offset?: { dx: number; dy: number }): Bounds {
  const home = labelHome(pts, name, obstacles)
  return offset ? { ...home, x: home.x + offset.dx, y: home.y + offset.dy } : home
}

/** The default place of a flow's name, before the user moves it. */
export function labelHome(pts: Point[], name: string, obstacles: Bounds[] = []): Bounds {
  const { width, height } = labelSize(name)
  const len = (k: number) => Math.abs(pts[k + 1].x - pts[k].x) + Math.abs(pts[k + 1].y - pts[k].y)
  const order = pts.slice(1).map((_, k) => k)
  const roomy = order.filter((k) => len(k) >= Math.min(width, 40) || pts.length === 2)
  const tried = [...roomy, ...order.filter((k) => !roomy.includes(k))]
  const first = candidates(pts, tried[0], width, height, tried[0] ? 0 : 2)[0]
  for (const k of tried)
    for (const box of candidates(pts, k, width, height, k ? 0 : 2)) {
      if (obstacles.some((o) => meets(box, o))) continue
      // Its own line: every segment but the one it sits beside.
      if (pts.slice(1).some((p, j) => j !== k && hitsSegment(box, pts[j], p))) continue
      return box
    }
  return first
}
