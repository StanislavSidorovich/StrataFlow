// Align, distribute and insert on a flow (alignElements, distributeElements, flowUnder, insertOnFlow in core/ops).
import { describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import {
  addBoundaryEvent,
  addLane,
  addNode,
  addPool,
  alignElements,
  arrangeable,
  connect,
  distributeElements,
  flowOf,
  flowUnder,
  insertOnFlow,
  ModelError,
  nodeOf,
  setDefaultFlow,
  setFlow,
} from '../src/core/ops'

/** A pool at 0,0 (800 × 400) with lanes Clerk 0–250 and Manager 250–400 (as in clipboard.test.ts). */
function office(): FlowModel {
  const m = emptyModel()
  addPool(m, { x: 0, y: 0 }, 'Office')
  addLane(m, 'Participant_1', 'Clerk')
  addLane(m, 'Participant_1', 'Manager')
  return m
}

const box = (m: FlowModel, id: string) => m.diagram.shapes[id]
const cx = (m: FlowModel, id: string) => box(m, id).x + box(m, id).width / 2
const cy = (m: FlowModel, id: string) => box(m, id).y + box(m, id).height / 2

describe('align', () => {
  it('lines up shapes of different sizes on the left, centre, right, top, middle and bottom', () => {
    const m = office()
    addNode(m, { type: 'task' }, { x: 150, y: 100 })
    addNode(m, { type: 'gateway' }, { x: 300, y: 160 })
    addNode(m, { type: 'event', position: 'intermediate' }, { x: 420, y: 60 })
    const ids = ['Task_1', 'Gateway_1', 'Event_1']
    alignElements(m, ids, 'left')
    expect(ids.map((id) => box(m, id).x)).toEqual([100, 100, 100])
    alignElements(m, ids, 'right')
    expect(ids.map((id) => box(m, id).x + box(m, id).width)).toEqual([200, 200, 200])
    alignElements(m, ids, 'center')
    expect(ids.map((id) => cx(m, id))).toEqual([150, 150, 150])
    alignElements(m, ids, 'top')
    expect(ids.map((id) => box(m, id).y)).toEqual([42, 42, 42])
    alignElements(m, ids, 'bottom')
    expect(new Set(ids.map((id) => box(m, id).y + box(m, id).height)).size).toBe(1)
    alignElements(m, ids, 'middle')
    expect(new Set(ids.map((id) => cy(m, id))).size).toBe(1)
  })

  it('moves tasks of different lanes into one lane and updates their lane', () => {
    const m = office()
    addNode(m, { type: 'task' }, { x: 150, y: 100 })
    addNode(m, { type: 'task' }, { x: 300, y: 320 })
    addNode(m, { type: 'task' }, { x: 450, y: 120 })
    expect(nodeOf(m, 'Task_2')!.laneId).toBe('Lane_2')
    alignElements(m, ['Task_1', 'Task_2', 'Task_3'], 'top')
    expect(['Task_1', 'Task_2', 'Task_3'].map((id) => nodeOf(m, id)!.laneId)).toEqual(['Lane_1', 'Lane_1', 'Lane_1'])
  })

  it('leaves pools, lanes and flows out; a boundary event goes with its task', () => {
    const m = office()
    addNode(m, { type: 'task' }, { x: 150, y: 100 })
    addNode(m, { type: 'task' }, { x: 300, y: 160 })
    addBoundaryEvent(m, 'Task_2')
    connect(m, 'Task_1', 'Task_2')
    const ev = { ...box(m, 'Event_1') }
    const ids = ['Participant_1', 'Lane_1', 'Flow_1', 'Task_1', 'Task_2', 'Event_1']
    expect(arrangeable(m, ids)).toEqual(['Task_1', 'Task_2'])
    alignElements(m, ids, 'top')
    expect(box(m, 'Participant_1')).toMatchObject({ x: 0, y: 0 })
    expect(box(m, 'Task_2').y).toBe(60)
    expect(box(m, 'Event_1')).toMatchObject({ x: ev.x, y: ev.y - 60 })
  })

  it('moves a sub-process with its content', () => {
    const m = office()
    addNode(m, { type: 'task' }, { x: 150, y: 100 })
    addNode(m, { type: 'subProcess' }, { x: 400, y: 150 })
    const sp = nodeOf(m, 'SubProcess_1')!
    if (sp.type === 'subProcess') sp.collapsed = false
    box(m, 'SubProcess_1').width = 200
    box(m, 'SubProcess_1').height = 120
    addNode(m, { type: 'task' }, { x: 450, y: 170 })
    expect(nodeOf(m, 'Task_2')!.parentId).toBe('SubProcess_1')
    const inner = { ...box(m, 'Task_2') }
    const dy = 60 - box(m, 'SubProcess_1').y
    alignElements(m, ['Task_1', 'SubProcess_1', 'Task_2'], 'top')
    expect(box(m, 'SubProcess_1').y).toBe(60)
    expect(box(m, 'Task_2').y).toBe(inner.y + dy)
    expect(nodeOf(m, 'Task_2')!.parentId).toBe('SubProcess_1')
  })

  it('needs two shapes', () => {
    const m = office()
    addNode(m, { type: 'task' }, { x: 150, y: 100 })
    expect(() => alignElements(m, ['Task_1', 'Lane_1'], 'left')).toThrow(ModelError)
  })
})

describe('distribute', () => {
  it('makes the gaps equal; the first and the last stay', () => {
    const m = office()
    addNode(m, { type: 'task' }, { x: 100, y: 100 })
    addNode(m, { type: 'gateway' }, { x: 220, y: 100 })
    addNode(m, { type: 'task' }, { x: 600, y: 300 })
    distributeElements(m, ['Task_2', 'Gateway_1', 'Task_1'], 'horizontal')
    expect(box(m, 'Task_1').x).toBe(50)
    expect(box(m, 'Task_2').x).toBe(550)
    const gap1 = box(m, 'Gateway_1').x - (box(m, 'Task_1').x + 100)
    const gap2 = box(m, 'Task_2').x - (box(m, 'Gateway_1').x + 50)
    expect(Math.abs(gap1 - gap2)).toBeLessThanOrEqual(1)
    expect(cy(m, 'Gateway_1')).toBe(100)
    expect(nodeOf(m, 'Task_2')!.laneId).toBe('Lane_2')
  })

  it('vertically, and needs three shapes', () => {
    const m = office()
    addNode(m, { type: 'task' }, { x: 100, y: 60 })
    addNode(m, { type: 'task' }, { x: 300, y: 100 })
    addNode(m, { type: 'task' }, { x: 500, y: 340 })
    distributeElements(m, ['Task_1', 'Task_2', 'Task_3'], 'vertical')
    expect(cy(m, 'Task_2')).toBe(200)
    expect(nodeOf(m, 'Task_2')!.laneId).toBe('Lane_1')
    expect(() => distributeElements(m, ['Task_1', 'Task_2'], 'vertical')).toThrow(ModelError)
  })
})

/** Clerk lane: Below 200? (gateway) → Pay (task), the flow named "Yes" with a condition. */
function decision(): FlowModel {
  const m = office()
  addNode(m, { type: 'gateway' }, { x: 100, y: 100 })
  addNode(m, { type: 'task' }, { x: 500, y: 100 }, 'Pay')
  connect(m, 'Gateway_1', 'Task_1')
  setFlow(m, 'Flow_1', { name: 'Yes', condition: 'amount < 200' })
  return m
}

describe('insert on flow', () => {
  it('splits A→B into A→X→B; name and condition stay on the first part', () => {
    const m = decision()
    addNode(m, { type: 'task' }, { x: 300, y: 108 }, 'Approve')
    expect(flowUnder(m, { x: 300, y: 108 }, { nodeId: 'Task_2' })).toBe('Flow_1')
    const rest = insertOnFlow(m, 'Flow_1', 'Task_2')
    expect(flowOf(m, 'Flow_1')).toMatchObject({ source: 'Gateway_1', target: 'Task_2', name: 'Yes', condition: 'amount < 200' })
    expect(rest).toMatchObject({ kind: 'sequence', source: 'Task_2', target: 'Task_1', name: '' })
    expect(rest.condition).toBeUndefined()
    // Pulled onto the line, so both parts are straight.
    expect(cy(m, 'Task_2')).toBe(100)
  })

  it('keeps the default mark on the first part', () => {
    const m = decision()
    setDefaultFlow(m, 'Flow_1', true)
    addNode(m, { type: 'event', position: 'intermediate' }, { x: 300, y: 100 })
    insertOnFlow(m, 'Flow_1', 'Event_1')
    const g = nodeOf(m, 'Gateway_1')!
    expect(g.type === 'gateway' && g.defaultFlow).toBe('Flow_1')
    expect(flowOf(m, 'Flow_1')!.target).toBe('Event_1')
  })

  it('finds a flow for a new shape from the palette, not for a start or end event', () => {
    const m = decision()
    expect(flowUnder(m, { x: 300, y: 104 }, { spec: { type: 'task' } })).toBe('Flow_1')
    expect(flowUnder(m, { x: 300, y: 104 }, { spec: { type: 'event', position: 'intermediate' } })).toBe('Flow_1')
    expect(flowUnder(m, { x: 300, y: 104 }, { spec: { type: 'event', position: 'end' } })).toBeUndefined()
    expect(flowUnder(m, { x: 300, y: 104 }, { spec: { type: 'dataObject' } })).toBeUndefined()
    expect(flowUnder(m, { x: 300, y: 140 }, { spec: { type: 'task' } })).toBeUndefined()
  })

  it('counts a flow that passes through the dragged shape, not one that passes by', () => {
    const m = decision()
    addNode(m, { type: 'task' }, { x: 300, y: 300 })
    expect(flowUnder(m, { x: 300, y: 130 }, { nodeId: 'Task_2' })).toBe('Flow_1')
    expect(flowUnder(m, { x: 300, y: 145 }, { nodeId: 'Task_2' })).toBeUndefined()
  })

  it('refuses a shape that is already connected', () => {
    const m = decision()
    addNode(m, { type: 'task' }, { x: 300, y: 300 })
    addNode(m, { type: 'task' }, { x: 300, y: 100 })
    connect(m, 'Task_2', 'Task_3')
    expect(flowUnder(m, { x: 300, y: 100 }, { nodeId: 'Task_3' })).toBeUndefined()
    expect(() => insertOnFlow(m, 'Flow_1', 'Task_3')).toThrow(ModelError)
  })

  it('refuses message flows, associations and a flow of another pool', () => {
    const m = decision()
    addPool(m, { x: 0, y: 500 }, 'Customer')
    addNode(m, { type: 'task' }, { x: 300, y: 600 }, 'Ask')
    const msg = connect(m, 'Task_2', 'Task_1')
    expect(msg.kind).toBe('message')
    addNode(m, { type: 'task' }, { x: 500, y: 400 })
    expect(() => insertOnFlow(m, msg.id, 'Task_3')).toThrow(ModelError)
    // The middle of the message flow lies in no pool.
    expect(flowUnder(m, { x: 500, y: 450 }, { spec: { type: 'task' } })).toBeUndefined()
    // Dropped in the other pool on the line of Flow_1 extended: the flow of Office does not count.
    addNode(m, { type: 'task' }, { x: 300, y: 620 })
    expect(() => insertOnFlow(m, 'Flow_1', 'Task_4')).toThrow(ModelError)
  })

  it('works on a flow with bends of its own', () => {
    const m = office()
    addNode(m, { type: 'task' }, { x: 100, y: 100 })
    addNode(m, { type: 'task' }, { x: 500, y: 320 })
    connect(m, 'Task_1', 'Task_2')
    m.diagram.edges.Flow_1 = [{ x: 150, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 320 }, { x: 450, y: 320 }]
    addNode(m, { type: 'gateway' }, { x: 306, y: 200 })
    expect(flowUnder(m, { x: 306, y: 200 }, { nodeId: 'Gateway_1' })).toBe('Flow_1')
    insertOnFlow(m, 'Flow_1', 'Gateway_1')
    expect(cx(m, 'Gateway_1')).toBe(300)
    expect(m.diagram.edges.Flow_1).toBeUndefined()
    expect(m.flows.map((f) => [f.source, f.target])).toEqual([
      ['Task_1', 'Gateway_1'],
      ['Gateway_1', 'Task_2'],
    ])
  })
})
