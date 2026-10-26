// What Bizagi Modeler needs of a sub-process (owner's checks, 2026-10-26): an expanded sub-process comes out as one
// huge box with its steps tiny in the middle, whatever its size, lanes or messages; a collapsed one opens on a page of
// its own. So the file for Bizagi is written from a copy where every expanded sub-process is collapsed in place.
// Unlike `setCollapsed` nothing else moves: the box takes the middle of the space the sub-process had (inside its
// own lane), so nothing lands on a neighbour; the gap it leaves is the price of leaving the drawing alone.
import { SIZES, type FlowModel, type FlowNode } from '../metamodel'

/** The ids below a node: what a sub-process holds, at any depth. */
function below(m: FlowModel, id: string): Set<string> {
  const out = new Set<string>()
  for (let grew = true; grew; ) {
    grew = false
    for (const n of m.nodes) if (!out.has(n.id) && n.parentId && (n.parentId === id || out.has(n.parentId))) (out.add(n.id), (grew = true))
  }
  return out
}

const depth = (m: FlowModel, n: FlowNode): number => (n.parentId ? 1 + depth(m, m.nodes.find((x) => x.id === n.parentId)!) : 0)

/** A copy of the model with every expanded sub-process collapsed in place; `collapsed` counts them. */
export function collapseForBizagi(model: FlowModel): { model: FlowModel; collapsed: number } {
  const m: FlowModel = structuredClone(model)
  const open = m.nodes.filter((n) => n.type === 'subProcess' && !n.collapsed && m.diagram.shapes[n.id]).sort((a, b) => depth(m, b) - depth(m, a))
  for (const n of open) {
    const s = m.diagram.shapes[n.id]
    const lane = n.laneId ? m.diagram.shapes[n.laneId] : undefined
    const inLane = !lane || (s.y >= lane.y && s.y + s.height <= lane.y + lane.height)
    const cx = s.x + s.width / 2
    const cy = inLane ? s.y + s.height / 2 : lane!.y + lane!.height / 2
    const box = { x: Math.round(cx - SIZES.subProcess.width / 2), y: Math.round(cy - SIZES.subProcess.height / 2), ...SIZES.subProcess }
    const own = below(m, n.id)
    if (n.type === 'subProcess') n.collapsed = true
    m.diagram.shapes[n.id] = box
    for (const e of m.nodes.filter((x) => x.type === 'event' && x.attachedTo === n.id)) {
      const b = m.diagram.shapes[e.id]
      if (b) Object.assign(b, { x: Math.round(box.x + Math.min(Math.max(b.x - s.x, 0), box.width - b.width)), y: Math.round(box.y + box.height - b.height / 2) })
    }
    // The flows that met the old box (or crossed its border) are routed again; the ones inside stay on the page.
    for (const f of m.flows) if (f.source === n.id || f.target === n.id || own.has(f.source) !== own.has(f.target)) delete m.diagram.edges[f.id]
  }
  return { model: m, collapsed: open.length }
}
