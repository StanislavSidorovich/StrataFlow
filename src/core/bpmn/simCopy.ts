// A copy of the model that Bizagi Modeler's Simulation View accepts (v0.21.2, names on flows v0.22.1).
// 2026-11-21, tried in Bizagi on cut-down copies and then on the whole AS-IS model: the simulation fails or loses its
// cases when (1) an event gateway stands in the model (cases vanish at it: an exclusive gateway runs), (2) an
// imported waiting event carries StrataFlow's figure attributes `sf:wait...` (the same event drawn in Bizagi runs; with
// the attributes taken off it runs too), and (3) a sequence flow after a gateway has a NAME (Yes / No): the same
// model runs when the flows carry no name (a name on the gateway itself is fine). The copy therefore drops the flow
// names (`droppedNames`); the gateway keeps its question.

// Tried in Bizagi on cut-down copies of one real model: a timer or message event that WAITS (an intermediate
// catch event) after a gateway makes "The simulation has failed" at once, with an event-based gateway as well as
// with an exclusive one; the same model with those waits drawn as activities simulates. So for the copy a waiting
// event becomes an activity that takes the wait as its time, and an event-based
// gateway becomes an exclusive one (Bizagi's help: an event gateway followed by anything but plain events is not
// simulated). Boundary events, start and end events, and throwing events stay. The drawing in Flow is not touched:
// this is only what the "for Bizagi simulation" export writes.
import { SIZES, type FlowModel, type FlowNode } from '../metamodel'

export interface SimCopy {
  model: FlowModel
  /** Waiting events drawn as activities, event-based gateways made exclusive. */
  waits: string[]
  gateways: string[]
  /** End events removed because a sibling branch of the same exclusive gateway already ends in another one. */
  mergedEnds: string[]
  /** Sequence flows whose name was left out (Bizagi's simulation fails on a named flow after a gateway). */
  droppedNames: number
}

const WAITING = ['timer', 'message', 'signal', 'conditional'] as const

export function isWait(n: FlowNode): boolean {
  return n.type === 'event' && n.position === 'intermediate' && !n.throwing && (WAITING as readonly string[]).includes(n.trigger)
}

export function forBizagiSimulation(model: FlowModel): SimCopy {
  const m: FlowModel = structuredClone(model)
  const waits: string[] = []
  const gateways: string[] = []
  m.nodes = m.nodes.map((n): FlowNode => {
    if (n.type === 'gateway' && n.kind === 'eventBased') {
      gateways.push(n.id)
      return { ...n, kind: 'exclusive' }
    }
    if (!isWait(n)) return n
    waits.push(n.id)
    const sim = { ...n.sim }
    // The wait is now the time of the activity (Bizagi has one time per activity).
    if (sim.wait !== undefined) sim.duration = sim.wait
    if (sim.waitShape) sim.durationShape = sim.waitShape
    delete sim.wait
    delete sim.waitShape
    const { position: _p, trigger: _t, throwing: _th, interrupting: _i, attachedTo: _a, ...rest } = n as FlowNode & Record<string, unknown>
    const task = { ...rest, type: 'task', kind: 'task', sim: Object.keys(sim).length ? sim : undefined } as unknown as FlowNode
    const b = m.diagram.shapes[n.id]
    if (b) {
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      m.diagram.shapes[n.id] = { ...b, x: cx - SIZES.task.width / 2, y: cy - SIZES.task.height / 2, ...SIZES.task }
    }
    return task
  })
  // A flow's drawn route ends at the old, smaller shape: let the writer route it again.
  for (const f of m.flows) if (waits.includes(f.source) || waits.includes(f.target)) delete m.diagram.edges[f.id]
  const mergedEnds = mergeSiblingEnds(m)
  let droppedNames = 0
  for (const f of m.flows) {
    if (f.kind !== 'sequence' || !f.name) continue
    f.name = ''
    delete f.labelOffset
    droppedNames++
  }
  return { model: m, waits, gateways, mergedEnds, droppedNames }
}

/**
 * The numbers sheet is written from the copy, but a share of a flow is clearer with its name ("Yes"): the names the
 * copy dropped are read back from the model they came from, by flow id.
 */
export function restoreFlowNames(copy: FlowModel, original: FlowModel): void {
  const names = new Map(original.flows.map((f) => [f.id, f.name]))
  for (const f of copy.flows) {
    const name = names.get(f.id)
    if (!f.name && name) f.name = name
  }
}

const isPlainEnd = (n: FlowNode | undefined): boolean =>
  !!n && n.type === 'event' && n.position === 'end' && n.trigger === 'none'

/**
 * Bizagi's engine fails ("The simulation has failed") when the branches of one exclusive gateway each finish in their
 * own end event (tried on cut-down copies of a real model: three branches to three ends fail, the same three branches
 * to one end simulate). For the copy, the plain end events that closed branches of one exclusive gateway become one.
 * A branch is followed through activities that have one way in and one way out. Exclusive branches never run together,
 * so one shared end changes no path.
 */
function mergeSiblingEnds(m: FlowModel): string[] {
  const byId = new Map(m.nodes.map((n) => [n.id, n]))
  const removed: string[] = []
  for (const g of m.nodes) {
    if (g.type !== 'gateway' || g.kind !== 'exclusive') continue
    const ends: FlowNode[] = []
    for (const out of m.flows.filter((f) => f.source === g.id && f.kind === 'sequence')) {
      let cur = byId.get(out.target)
      const seen = new Set<string>()
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id)
        if (isPlainEnd(cur)) {
          if (m.flows.filter((f) => f.target === cur!.id).length === 1 && !ends.includes(cur)) ends.push(cur)
          break
        }
        if (cur.type !== 'task') break
        const next = m.flows.filter((f) => f.source === cur!.id && f.kind === 'sequence')
        const into = m.flows.filter((f) => f.target === cur!.id)
        if (next.length !== 1 || into.length !== 1) break
        cur = byId.get(next[0].target)
      }
    }
    const same = ends.filter((e) => e.participantId === ends[0]?.participantId && e.laneId === ends[0]?.laneId)
    if (same.length < 2) continue
    const keep = same[0]
    for (const e of same.slice(1)) {
      for (const f of m.flows) if (f.target === e.id) {
        f.target = keep.id
        delete m.diagram.edges[f.id]
        delete f.targetSide
      }
      m.nodes = m.nodes.filter((n) => n.id !== e.id)
      byId.delete(e.id)
      delete m.diagram.shapes[e.id]
      removed.push(e.id)
    }
  }
  return removed
}
