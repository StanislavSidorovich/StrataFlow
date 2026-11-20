// The label part of layoutQuality: each flow name's box (core/edgeLabel) against lines, shapes and lane borders.
import { labelBox } from './edgeLabel'
import type { Bounds, Flow, FlowModel, FlowNode, Point } from './metamodel'

const hitsRect = (a: Point, b: Point, r: Bounds): boolean => {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  return x1 > r.x && x0 < r.x + r.width && y1 > r.y && y0 < r.y + r.height
}

export function edgeLabelBoxes(m: FlowModel, flows: Flow[], paths: Map<string, Point[]>, solid: FlowNode[]): { id: string; box: Bounds; bad: boolean; why: string }[] {
  const shapes = m.diagram.shapes
  // Horizontal lane and pool borders: a label across one reads as belonging to both sides.
  const borders = [...m.lanes, ...m.participants].filter((l) => shapes[l.id]).flatMap((l) => [shapes[l.id].y, shapes[l.id].y + shapes[l.id].height].map((y) => ({ y, x0: shapes[l.id].x, x1: shapes[l.id].x + shapes[l.id].width })))
  return flows
    .filter((f) => f.name && paths.has(f.id))
    .map((f) => {
      const box = labelBox(paths.get(f.id)!, f.name, solid.map((n) => shapes[n.id]))
      const inner = { x: box.x + 1, y: box.y + 1, width: box.width - 2, height: box.height - 2 }
      const onLine = [...paths.values()].some((pts) => pts.slice(1).some((p, i) => hitsRect(pts[i], p, inner)))
      const onShape = solid.some((n) => shapes[n.id].x < inner.x + inner.width && inner.x < shapes[n.id].x + shapes[n.id].width && shapes[n.id].y < inner.y + inner.height && inner.y < shapes[n.id].y + shapes[n.id].height)
      const onBorder = borders.some((b) => b.y > inner.y && b.y < inner.y + inner.height && b.x0 < inner.x + inner.width && inner.x < b.x1)
      return { id: f.id, box, bad: onLine || onShape || onBorder, why: [onLine && 'line', onShape && 'shape', onBorder && 'border'].filter(Boolean).join('+') }
    })
}
