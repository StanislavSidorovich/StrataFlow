import { describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import {
  addBoundaryEvent,
  addLane,
  addNode,
  addPool,
  appendNode,
  connect,
  convertActivity,
  deleteElements,
  ModelError,
  moveElements,
  nextId,
  nodeOf,
  reconnect,
  reverseFlow,
  rename,
  resizeElement,
  resizeLane,
  setDefaultFlow,
  setFlow,
  updateNode,
} from '../src/core/ops'

/** A pool at 0,0 (800 × 250) with two lanes: Clerk 0–250, Manager 250–400. */
function poolWithLanes(): FlowModel {
  const m = emptyModel()
  addPool(m, { x: 0, y: 0 }, 'Office')
  addLane(m, 'Participant_1', 'Clerk')
  addLane(m, 'Participant_1', 'Manager')
  return m
}

describe('ids', () => {
  it('counts per prefix from the highest number', () => {
    const m = emptyModel()
    m.nodes.push({ id: 'Task_7', name: '', type: 'task', kind: 'task' })
    expect(nextId(m, 'Task')).toBe('Task_8')
    expect(nextId(m, 'Gateway')).toBe('Gateway_1')
  })
})

describe('add and place', () => {
  it('puts a node in the pool and lane under its centre', () => {
    const m = poolWithLanes()
    const t = addNode(m, { type: 'task' }, { x: 200, y: 100 }, 'Check invoice')
    expect(t).toMatchObject({ id: 'Task_1', participantId: 'Participant_1', laneId: 'Lane_1', name: 'Check invoice' })
    expect(m.diagram.shapes.Task_1).toEqual({ x: 150, y: 60, width: 100, height: 80 })
    expect(addNode(m, { type: 'gateway' }, { x: 300, y: 320 }).laneId).toBe('Lane_2')
    expect(addNode(m, { type: 'event', position: 'end' }, { x: 2000, y: 2000 })).toMatchObject({ participantId: undefined, laneId: undefined, throwing: true })
  })

  it('a new lane fills an empty pool, the next one grows it', () => {
    const m = poolWithLanes()
    expect(m.diagram.shapes.Lane_1).toEqual({ x: 30, y: 0, width: 770, height: 250 })
    expect(m.diagram.shapes.Lane_2).toEqual({ x: 30, y: 250, width: 770, height: 150 })
    expect(m.diagram.shapes.Participant_1.height).toBe(400)
  })

  it('a black-box pool that receives a step gets a process', () => {
    const m = emptyModel()
    addPool(m, { x: 0, y: 0 })
    m.participants[0].processId = undefined
    addNode(m, { type: 'task' }, { x: 200, y: 100 })
    expect(m.participants[0].processId).toBe('Process_1')
  })

  it('nodes inside an expanded sub-process belong to it', () => {
    const m = emptyModel()
    const sp = addNode(m, { type: 'subProcess' }, { x: 300, y: 200 })
    updateNode(m, sp.id, { collapsed: false })
    resizeElement(m, sp.id, { x: 100, y: 100, width: 400, height: 200 })
    expect(addNode(m, { type: 'task' }, { x: 250, y: 200 }).parentId).toBe(sp.id)
  })

  it('appends to the right, below what is already there, and connects', () => {
    const m = emptyModel()
    const g = addNode(m, { type: 'gateway' }, { x: 100, y: 100 })
    const a = appendNode(m, g.id, { type: 'task' })
    const b = appendNode(m, g.id, { type: 'task' })
    expect(m.diagram.shapes[a.id].x).toBe(185)
    expect(m.diagram.shapes[b.id].y).toBeGreaterThan(m.diagram.shapes[a.id].y + 80)
    expect(m.flows.map((f) => [f.source, f.target, f.kind])).toEqual([
      [g.id, a.id, 'sequence'],
      [g.id, b.id, 'sequence'],
    ])
  })

  it('appending past the end of a pool widens it', () => {
    const m = poolWithLanes()
    const t = addNode(m, { type: 'task' }, { x: 700, y: 100 })
    const u = appendNode(m, t.id, { type: 'task' })
    expect(m.diagram.shapes.Participant_1.width).toBe(m.diagram.shapes[u.id].x + 100 + 30)
    expect(m.diagram.shapes.Lane_2.width).toBe(m.diagram.shapes.Participant_1.width - 30)
    expect(u.participantId).toBe('Participant_1')
  })

  it('a boundary event sits on the lower border and takes the host\'s lane', () => {
    const m = poolWithLanes()
    const t = addNode(m, { type: 'task' }, { x: 200, y: 100 })
    const e = addBoundaryEvent(m, t.id, 'timer')
    expect(e).toMatchObject({ position: 'boundary', trigger: 'timer', attachedTo: t.id, interrupting: true, laneId: 'Lane_1' })
    expect(m.diagram.shapes[e.id].y).toBe(140 - 18)
    const g = addNode(m, { type: 'gateway' }, { x: 400, y: 100 })
    expect(() => addBoundaryEvent(m, g.id)).toThrow(ModelError)
  })
})

describe('connect', () => {
  it('picks the flow kind from the ends', () => {
    const m = poolWithLanes()
    addPool(m, { x: 0, y: 500 }, 'Customer')
    const a = addNode(m, { type: 'task' }, { x: 200, y: 100 })
    const b = addNode(m, { type: 'task' }, { x: 400, y: 300 })
    const c = addNode(m, { type: 'task' }, { x: 200, y: 600 })
    const d = addNode(m, { type: 'dataObject' }, { x: 300, y: 50 })
    const n = addNode(m, { type: 'annotation' }, { x: 600, y: 50 })
    expect(connect(m, a.id, b.id).kind).toBe('sequence')
    expect(connect(m, a.id, c.id).kind).toBe('message')
    expect(connect(m, b.id, 'Participant_2').kind).toBe('message')
    expect(connect(m, a.id, d.id).kind).toBe('data')
    expect(connect(m, n.id, a.id).kind).toBe('association')
    expect(() => connect(m, a.id, b.id)).toThrow('already connected')
    expect(() => connect(m, a.id, a.id)).toThrow(ModelError)
    expect(() => connect(m, a.id, 'Participant_1')).toThrow('two different pools')
  })

  it('reconnect changes the kind with the ends and drops the route', () => {
    const m = poolWithLanes()
    addPool(m, { x: 0, y: 500 })
    const a = addNode(m, { type: 'task' }, { x: 200, y: 100 })
    const b = addNode(m, { type: 'task' }, { x: 400, y: 100 })
    const c = addNode(m, { type: 'task' }, { x: 200, y: 600 })
    const f = connect(m, a.id, b.id)
    m.diagram.edges[f.id] = [{ x: 0, y: 0 }]
    reconnect(m, f.id, 'target', c.id)
    expect(m.flows[0]).toMatchObject({ target: c.id, kind: 'message' })
    expect(m.diagram.edges[f.id]).toBeUndefined()
  })
})

describe('reverse', () => {
  it('turns a flow around with its route; a default flow stops being one', () => {
    const m = emptyModel()
    const g = addNode(m, { type: 'gateway' }, { x: 0, y: 0 })
    const a = appendNode(m, g.id, { type: 'task' })
    const f = m.flows[0]
    setDefaultFlow(m, f.id, true)
    m.diagram.edges[f.id] = [{ x: 1, y: 1 }, { x: 2, y: 2 }]
    reverseFlow(m, f.id)
    expect(m.flows[0]).toMatchObject({ source: a.id, target: g.id })
    expect(m.diagram.edges[f.id]).toEqual([{ x: 2, y: 2 }, { x: 1, y: 1 }])
    expect(nodeOf(m, g.id)).not.toHaveProperty('defaultFlow')
  })
})

describe('move and resize', () => {
  it('a boundary event moves with its task; flows lose a route when only one end moved', () => {
    const m = poolWithLanes()
    const t = addNode(m, { type: 'task' }, { x: 200, y: 100 })
    const e = addBoundaryEvent(m, t.id)
    const u = addNode(m, { type: 'task' }, { x: 400, y: 100 })
    const f = connect(m, t.id, u.id)
    m.diagram.edges[f.id] = [{ x: 250, y: 100 }, { x: 350, y: 100 }]
    const before = { ...m.diagram.shapes[e.id] }
    moveElements(m, { [t.id]: { x: 150, y: 260 } })
    expect(m.diagram.shapes[e.id]).toEqual({ ...before, y: before.y + 200 })
    expect(nodeOf(m, t.id)?.laneId).toBe('Lane_2')
    expect(nodeOf(m, e.id)?.laneId).toBe('Lane_2')
    expect(m.diagram.edges[f.id]).toBeUndefined()
  })

  it('a pool moves with its lanes, nodes and routes inside', () => {
    const m = poolWithLanes()
    const a = addNode(m, { type: 'task' }, { x: 200, y: 100 })
    const b = addNode(m, { type: 'task' }, { x: 400, y: 100 })
    const f = connect(m, a.id, b.id)
    m.diagram.edges[f.id] = [{ x: 250, y: 100 }, { x: 350, y: 100 }]
    moveElements(m, { Participant_1: { x: 100, y: 50 } })
    expect(m.diagram.shapes.Lane_2).toMatchObject({ x: 130, y: 300 })
    expect(m.diagram.shapes[a.id]).toMatchObject({ x: 250, y: 110 })
    expect(m.diagram.edges[f.id]).toEqual([{ x: 350, y: 150 }, { x: 450, y: 150 }])
    expect(nodeOf(m, a.id)?.laneId).toBe('Lane_1')
  })

  it('a pool resize stretches its lanes; the last lane takes the extra height', () => {
    const m = poolWithLanes()
    resizeElement(m, 'Participant_1', { x: 0, y: 0, width: 1000, height: 500 })
    expect(m.diagram.shapes.Lane_1).toEqual({ x: 30, y: 0, width: 970, height: 250 })
    expect(m.diagram.shapes.Lane_2).toEqual({ x: 30, y: 250, width: 970, height: 250 })
  })

  it('a taller lane pushes the lanes and nodes below it', () => {
    const m = poolWithLanes()
    const low = addNode(m, { type: 'task' }, { x: 200, y: 320 })
    resizeLane(m, 'Lane_1', 300)
    expect(m.diagram.shapes.Lane_2.y).toBe(300)
    expect(m.diagram.shapes.Participant_1.height).toBe(450)
    expect(m.diagram.shapes[low.id].y).toBe(280 + 50)
    expect(nodeOf(m, low.id)?.laneId).toBe('Lane_2')
  })

  it('events and gateways keep their size', () => {
    const m = emptyModel()
    const e = addNode(m, { type: 'event' }, { x: 0, y: 0 })
    expect(() => resizeElement(m, e.id, { x: 0, y: 0, width: 80, height: 80 })).toThrow(ModelError)
  })
})

describe('change', () => {
  it('renames nodes, pools, lanes and flows', () => {
    const m = poolWithLanes()
    const a = addNode(m, { type: 'task' }, { x: 200, y: 100 })
    for (const id of [a.id, 'Participant_1', 'Lane_1']) rename(m, id, 'X')
    expect([a.name, m.participants[0].name, m.lanes[0].name]).toEqual(['X', 'X', 'X'])
  })

  it('event position keeps throwing consistent; a boundary event stays one', () => {
    const m = emptyModel()
    const e = addNode(m, { type: 'event', position: 'intermediate', throwing: true }, { x: 0, y: 0 })
    updateNode(m, e.id, { position: 'start' })
    expect(nodeOf(m, e.id)).toMatchObject({ position: 'start', throwing: false })
    updateNode(m, e.id, { position: 'end', trigger: 'message' })
    expect(nodeOf(m, e.id)).toMatchObject({ position: 'end', throwing: true, trigger: 'message' })
    const t = addNode(m, { type: 'task' }, { x: 200, y: 0 })
    const b = addBoundaryEvent(m, t.id)
    updateNode(m, b.id, { position: 'end', interrupting: false })
    expect(nodeOf(m, b.id)).toMatchObject({ position: 'boundary', interrupting: false })
  })

  it('a parallel gateway has no default and no conditions', () => {
    const m = emptyModel()
    const g = addNode(m, { type: 'gateway' }, { x: 0, y: 0 })
    const a = appendNode(m, g.id, { type: 'task' })
    appendNode(m, g.id, { type: 'task' })
    const [f1, f2] = m.flows
    setFlow(m, f1.id, { name: 'Yes', condition: 'amount > 100' })
    setDefaultFlow(m, f2.id, true)
    expect(nodeOf(m, g.id)).toMatchObject({ defaultFlow: f2.id })
    updateNode(m, g.id, { kind: 'parallel' })
    expect(nodeOf(m, g.id)).not.toHaveProperty('defaultFlow')
    expect(m.flows[0].condition).toBeUndefined()
    expect(m.flows[0].name).toBe('Yes')
    expect(() => setDefaultFlow(m, f1.id, true)).toThrow(ModelError)
    expect(() => setFlow(m, connect(m, a.id, addNode(m, { type: 'annotation' }, { x: 900, y: 0 }).id).id, { condition: 'x' })).toThrow(ModelError)
  })

  it('task and sub-process convert both ways, keeping flows', () => {
    const m = emptyModel()
    const a = addNode(m, { type: 'task', kind: 'user' }, { x: 0, y: 0 }, 'Review')
    appendNode(m, a.id, { type: 'task' })
    convertActivity(m, a.id, 'subProcess')
    expect(nodeOf(m, a.id)).toMatchObject({ type: 'subProcess', name: 'Review', collapsed: true })
    convertActivity(m, a.id, 'task')
    expect(nodeOf(m, a.id)).toMatchObject({ type: 'task', kind: 'task' })
    expect(m.flows).toHaveLength(1)
  })
})

describe('delete', () => {
  it('a node takes its flows and boundary events; a default flow is cleared', () => {
    const m = emptyModel()
    const g = addNode(m, { type: 'gateway' }, { x: 0, y: 0 })
    const a = appendNode(m, g.id, { type: 'task' })
    setDefaultFlow(m, m.flows[0].id, true)
    addBoundaryEvent(m, a.id)
    deleteElements(m, [a.id])
    expect(m.nodes.map((n) => n.id)).toEqual([g.id])
    expect(m.flows).toEqual([])
    expect(nodeOf(m, g.id)).not.toHaveProperty('defaultFlow')
    expect(Object.keys(m.diagram.shapes)).toEqual([g.id])
  })

  it('a pool takes its lanes, nodes and message flows', () => {
    const m = poolWithLanes()
    addPool(m, { x: 0, y: 500 })
    const a = addNode(m, { type: 'task' }, { x: 200, y: 100 })
    const c = addNode(m, { type: 'task' }, { x: 200, y: 600 })
    connect(m, a.id, c.id)
    deleteElements(m, ['Participant_1'])
    expect(m.lanes).toEqual([])
    expect(m.nodes.map((n) => n.id)).toEqual([c.id])
    expect(m.flows).toEqual([])
  })

  it('a lane gives its room and nodes to the lane above', () => {
    const m = poolWithLanes()
    const low = addNode(m, { type: 'task' }, { x: 200, y: 320 })
    deleteElements(m, ['Lane_2'])
    expect(m.diagram.shapes.Lane_1).toEqual({ x: 30, y: 0, width: 770, height: 400 })
    expect(nodeOf(m, low.id)?.laneId).toBe('Lane_1')
    expect(m.diagram.shapes[low.id]).toMatchObject({ y: 280 })
  })
})
