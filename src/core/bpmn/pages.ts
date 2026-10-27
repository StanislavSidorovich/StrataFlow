// What Bizagi Modeler needs of a sub-process (owner's checks, 2026-10-26): an expanded sub-process comes out as one
// huge box with its steps tiny in the middle, whatever its size, lanes or messages; a collapsed one opens on a page of
// its own. So the file for Bizagi is written from a copy where every expanded sub-process is collapsed in place.
// It is `setCollapsed` of the editor (the box in the lane of its steps, what follows closes up), then the pages.
import { type Bounds, type FlowModel, type FlowNode } from '../metamodel'
import { setCollapsed } from '../ops'

export const depth = (m: FlowModel, n: FlowNode): number => (n.parentId ? 1 + depth(m, m.nodes.find((x) => x.id === n.parentId)!) : 0)

/** A copy of the model with every expanded sub-process collapsed in place; `collapsed` counts them. */
export function collapseForBizagi(model: FlowModel): { model: FlowModel; collapsed: number } {
  const m: FlowModel = structuredClone(model)
  const open = m.nodes.filter((n) => n.type === 'subProcess' && !n.collapsed && m.diagram.shapes[n.id]).sort((a, b) => depth(m, b) - depth(m, a))
  // The same collapse as the editor's (its lane, what follows closes up, the pool narrows), deepest first.
  for (const n of open) setCollapsed(m, n.id, true)
  hideInPages(m)
  spreadMessages(m)
  return { model: m, collapsed: open.length }
}

/** Room round the steps on a page of their own. */
export const PAGE_PAD = 100

/** The outermost collapsed sub-process above a node (what the writer puts its page under), if any. */
function pageHolder(m: FlowModel, n: FlowNode): string | undefined {
  let found: string | undefined
  for (let p = n.parentId ? m.nodes.find((x) => x.id === n.parentId) : undefined; p; p = p.parentId ? m.nodes.find((x) => x.id === p!.parentId) : undefined) if (p.type === 'subProcess' && p.collapsed) found = p.id
  return found
}

/**
 * What the pages need once the sub-process is collapsed. A message flow to a step now hidden on a page would end
 * in thin air on the main sheet (Bizagi draws the line to where the step used to be): it goes to the sub-process
 * box instead. And a page is its own drawing: its steps move to the top left (they sit where the sub-process was).
 */
function hideInPages(m: FlowModel): void {
  const host = new Map<string, string>()
  for (const n of m.nodes) {
    const h = pageHolder(m, n)
    if (h) host.set(n.id, h)
  }
  for (const f of m.flows) {
    if (f.kind !== 'message') continue
    const a = host.get(f.source)
    const b = host.get(f.target)
    if (!a && !b) continue
    if (a) f.source = a
    if (b) f.target = b
    delete m.diagram.edges[f.id]
  }
  const pages = new Map<string, string[]>()
  for (const [id, h] of host) pages.set(h, [...(pages.get(h) ?? []), id])
  for (const ids of pages.values()) {
    const boxes = ids.map((id) => m.diagram.shapes[id]).filter((b): b is Bounds => !!b)
    if (!boxes.length) continue
    const dx = PAGE_PAD - Math.min(...boxes.map((b) => b.x))
    const dy = PAGE_PAD - Math.min(...boxes.map((b) => b.y))
    if (!dx && !dy) continue
    for (const b of boxes) Object.assign(b, { x: b.x + dx, y: b.y + dy })
    const inside = new Set(ids)
    for (const f of m.flows) {
      const pts = m.diagram.edges[f.id]
      if (pts && inside.has(f.source) && inside.has(f.target)) m.diagram.edges[f.id] = pts.map((p) => ({ x: p.x + dx, y: p.y + dy }))
    }
  }
}

/**
 * Several message flows meeting one collapsed sub-process on the same side would be drawn on the same line
 * (Bizagi and our writer route each to the middle of the box): each gets its own x along the box.
 */
function spreadMessages(m: FlowModel): void {
  const sides = new Map<string, typeof m.flows>()
  for (const f of m.flows) {
    if (f.kind !== 'message' || m.diagram.edges[f.id]) continue
    const sub = [f.source, f.target].find((id) => m.nodes.find((n) => n.id === id)?.type === 'subProcess')
    const other = sub === f.source ? f.target : f.source
    const a = sub && m.diagram.shapes[sub]
    const o = m.diagram.shapes[other]
    if (!sub || !a || !o) continue
    const key = `${sub}:${o.y + o.height / 2 < a.y + a.height / 2 ? 'top' : 'bottom'}`
    sides.set(key, [...(sides.get(key) ?? []), f])
  }
  for (const [key, flows] of sides) {
    if (flows.length < 2) continue
    const [sub, side] = key.split(':')
    const a = m.diagram.shapes[sub]
    // Left to right in the order of the other ends, so the lines do not cross.
    const centreX = (f: (typeof flows)[number]) => {
      const o = m.diagram.shapes[f.source === sub ? f.target : f.source]
      return o.x + o.width / 2
    }
    flows.sort((p, q) => centreX(p) - centreX(q))
    flows.forEach((f, i) => {
      const o = m.diagram.shapes[f.source === sub ? f.target : f.source]
      const x = Math.round(a.x + (a.width * (i + 1)) / (flows.length + 1))
      const ya = side === 'top' ? a.y : a.y + a.height
      const yo = side === 'top' ? o.y + o.height : o.y
      const isPool = m.participants.some((p) => p.id === (f.source === sub ? f.target : f.source))
      const ox = isPool ? x : Math.round(o.x + o.width / 2)
      const ym = Math.round((ya + yo) / 2)
      const route = ox === x ? [{ x, y: ya }, { x, y: yo }] : [{ x, y: ya }, { x, y: ym }, { x: ox, y: ym }, { x: ox, y: yo }]
      m.diagram.edges[f.id] = f.source === sub ? route : [...route].reverse()
    })
  }
}
