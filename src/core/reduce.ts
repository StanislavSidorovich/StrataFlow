// A model reduced to what a walkthrough or a story has shown so far (same ids, same order): the order the
// steps are shown in, and the subset of the model. Shared by data/walkthrough.ts and core/story.ts.
import { isArtifact, type FlowModel, type FlowNode } from './metamodel'

/** The order the nodes are shown in: per pool from its start events along the flow; a sub-process's content right after it. */
export function walkOrder(ref: FlowModel): string[] {
  const order: string[] = []
  const taken = new Set<string>()
  const out = (id: string) => ref.flows.filter((f) => f.kind === 'sequence' && f.source === id).map((f) => f.target)
  const starts = (parent: string | undefined, pool?: string | null) =>
    ref.nodes.filter((n) => n.type === 'event' && n.position === 'start' && n.parentId === parent && (pool === null || n.participantId === pool)).map((n) => n.id)
  const take = (id: string, queue: string[]) => {
    if (taken.has(id)) return
    taken.add(id)
    order.push(id)
    queue.push(id)
    const n = ref.nodes.find((x) => x.id === id)
    if (n?.type === 'subProcess') walk(starts(id, null))
  }
  function walk(from: string[]) {
    const queue: string[] = []
    for (const s of from) take(s, queue)
    for (let i = 0; i < queue.length; i++) {
      for (const b of ref.nodes) if (b.type === 'event' && b.attachedTo === queue[i]) take(b.id, queue)
      for (const t of out(queue[i])) take(t, queue)
    }
  }
  for (const p of ref.participants) walk(starts(undefined, p.id))
  walk(starts(undefined, undefined))
  // Steps no start event reaches, in model order (each with what follows it).
  for (const n of ref.nodes) if (!isArtifact(n) && !taken.has(n.id)) walk([n.id])
  return order
}

/** The reference reduced to what is shown (same ids, same order); a flow shows once both its ends do (and, if `drawn` is given, only when it is in it). */
export function snapshot(ref: FlowModel, shown: Set<string>, drawn?: Set<string>): FlowModel {
  const flows = ref.flows.filter((f) => shown.has(f.source) && shown.has(f.target) && (!drawn || drawn.has(f.id)))
  const keep = new Set([...shown, ...flows.map((f) => f.id)])
  return {
    ...ref,
    participants: ref.participants.filter((p) => shown.has(p.id)),
    lanes: ref.lanes.filter((l) => shown.has(l.id)),
    nodes: ref.nodes
      .filter((n) => shown.has(n.id))
      // A gateway's default flow is kept only once the flow is there.
      .map((n) => (n.type === 'gateway' && n.defaultFlow && !keep.has(n.defaultFlow) ? (({ defaultFlow: _, ...rest }) => rest)(n) : n) as FlowNode),
    flows,
    diagram: {
      shapes: Object.fromEntries(Object.entries(ref.diagram.shapes).filter(([id]) => keep.has(id))),
      edges: Object.fromEntries(Object.entries(ref.diagram.edges).filter(([id]) => keep.has(id))),
    },
  }
}

