// A copy of the model that Bizagi Modeler's Simulation View accepts (v0.21.1).
// Tried in Bizagi on cut-down copies of one real model: a timer or message event that WAITS (an intermediate
// catch event) after a gateway makes "The simulation has failed" at once, with an event-based gateway as well as
// with an exclusive one; the same model with those waits drawn as activities simulates. So for the copy a waiting
// event becomes an activity (a receive task for a message) that takes the wait as its time, and an event-based
// gateway becomes an exclusive one (Bizagi's help: an event gateway followed by anything but plain events is not
// simulated). Boundary events, start and end events, and throwing events stay. The drawing in Flow is not touched:
// this is only what the "for Bizagi simulation" export writes.
import { SIZES, type FlowModel, type FlowNode } from '../metamodel'

export interface SimCopy {
  model: FlowModel
  /** Waiting events drawn as activities, event-based gateways made exclusive. */
  waits: string[]
  gateways: string[]
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
    const task = { ...rest, type: 'task', kind: (n as Extract<FlowNode, { type: 'event' }>).trigger === 'message' ? 'receive' : 'task', sim: Object.keys(sim).length ? sim : undefined } as unknown as FlowNode
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
  return { model: m, waits, gateways }
}
