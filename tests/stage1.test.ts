// Stage 1 acceptance (SPEC §12): a reference process with pools, lanes, XOR and AND split/join, timer and
// message events, a boundary event and a data object is drawn with the editor's operations, saved, reloaded
// unchanged; undo and redo walk the history.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import { addBoundaryEvent, addLane, addNode, addPool, appendNode, connect, rename, setDefaultFlow, setFlow, updateNode } from '../src/core/ops'
import { parseModel, serializeModel, ModelFormatError } from '../src/core/serialize'
import { useEditor } from '../src/ui/store'

/** Online shop: order fulfilment (the planned case 3), drawn step by step. */
function drawOrderFulfilment(m: FlowModel) {
  addPool(m, { x: 0, y: 0 }, 'Online shop')
  addLane(m, 'Participant_1', 'Sales')
  addLane(m, 'Participant_1', 'Warehouse')
  addPool(m, { x: 0, y: 460 }, 'Customer')
  m.participants[1].processId = undefined // black box
  const start = addNode(m, { type: 'event', position: 'start', trigger: 'message' }, { x: 80, y: 120 }, 'Order received')
  const check = appendNode(m, start.id, { type: 'task', kind: 'user' }, 'Check stock')
  const inStock = appendNode(m, check.id, { type: 'gateway' }, 'In stock?')
  const reject = appendNode(m, inStock.id, { type: 'task', kind: 'send' }, 'Reject order')
  const split = appendNode(m, inStock.id, { type: 'gateway', kind: 'parallel' })
  const rejected = appendNode(m, reject.id, { type: 'event', position: 'end' }, 'Order rejected')
  const pack = addNode(m, { type: 'task', kind: 'manual' }, { x: 640, y: 330 }, 'Pack goods')
  const invoice = addNode(m, { type: 'task', kind: 'send' }, { x: 640, y: 200 }, 'Send invoice')
  connect(m, split.id, pack.id)
  connect(m, split.id, invoice.id)
  const join = addNode(m, { type: 'gateway', kind: 'parallel' }, { x: 790, y: 260 })
  connect(m, pack.id, join.id)
  connect(m, invoice.id, join.id)
  const wait = appendNode(m, join.id, { type: 'event', position: 'intermediate', trigger: 'message' }, 'Payment received')
  const ship = appendNode(m, wait.id, { type: 'task' }, 'Ship order')
  const done = appendNode(m, ship.id, { type: 'event', position: 'end' }, 'Order shipped')
  const late = addBoundaryEvent(m, invoice.id, 'timer')
  rename(m, late.id, '14 days')
  updateNode(m, late.id, { interrupting: false })
  const remind = addNode(m, { type: 'task', kind: 'send' }, { x: 790, y: 120 }, 'Send reminder')
  connect(m, late.id, remind.id)
  appendNode(m, remind.id, { type: 'event', position: 'end' }, 'Reminder sent')
  const slip = addNode(m, { type: 'dataObject' }, { x: 640, y: 400 }, 'Packing slip')
  connect(m, pack.id, slip.id)
  connect(m, 'Participant_2', start.id)
  connect(m, invoice.id, 'Participant_2')
  const [toReject, toSplit] = m.flows.filter((f) => f.source === inStock.id)
  setFlow(m, toReject.id, { name: 'No', condition: 'an item is missing' })
  setFlow(m, toSplit.id, { name: 'Yes' })
  setDefaultFlow(m, toSplit.id, true)
  return { start, inStock, split, join, late, slip, rejected, done }
}

describe('stage 1: draw, save, reload, undo', () => {
  const m = emptyModel('Order fulfilment')
  const r = drawOrderFulfilment(m)

  it('has everything the stage asks for', () => {
    expect(m.participants).toHaveLength(2)
    expect(m.lanes.map((l) => l.name)).toEqual(['Sales', 'Warehouse'])
    const kinds = m.nodes.filter((n) => n.type === 'gateway').map((n) => n.type === 'gateway' && n.kind)
    expect(kinds).toEqual(['exclusive', 'parallel', 'parallel'])
    expect(m.nodes.find((n) => n.id === r.late.id)).toMatchObject({ position: 'boundary', trigger: 'timer', interrupting: false })
    expect(m.nodes.filter((n) => n.type === 'event' && n.trigger === 'message')).toHaveLength(2)
    expect(m.flows.filter((f) => f.kind === 'message')).toHaveLength(2)
    expect(m.flows.filter((f) => f.kind === 'data')).toHaveLength(1)
    // Every flow node sits in the shop's pool; the pack task landed in the warehouse lane.
    expect(m.nodes.every((n) => n.participantId === 'Participant_1')).toBe(true)
    expect(m.nodes.find((n) => n.name === 'Pack goods')?.laneId).toBe('Lane_2')
  })

  it('saves and reloads unchanged', () => {
    const text = serializeModel(m)
    expect(parseModel(text)).toEqual(m)
    expect(serializeModel(parseModel(text))).toBe(text)
  })

  it('undo walks back to the empty model and redo forward again', () => {
    const { apply, undo, redo, load } = useEditor.getState()
    load(emptyModel('Order fulfilment'))
    // Each op is one undo step, as when drawn by hand.
    let steps = 0
    const ops: ((x: FlowModel) => void)[] = [
      (x) => void addPool(x, { x: 0, y: 0 }, 'Online shop'),
      (x) => void addLane(x, 'Participant_1', 'Sales'),
      (x) => void addNode(x, { type: 'event', position: 'start', trigger: 'message' }, { x: 80, y: 120 }, 'Order received'),
      (x) => void appendNode(x, 'Event_1', { type: 'task' }, 'Check stock'),
    ]
    for (const op of ops) if (apply(op)) steps++
    const built = useEditor.getState().model
    expect(built.nodes).toHaveLength(2)
    for (let i = 0; i < steps; i++) undo()
    expect(useEditor.getState().model).toEqual(emptyModel('Order fulfilment'))
    for (let i = 0; i < steps; i++) redo()
    expect(useEditor.getState().model).toBe(built)
  })

  it('a failed edit leaves the model and history alone', () => {
    const before = useEditor.getState()
    expect(before.apply((x) => void connect(x, 'Event_1', 'Event_1'))).toBe(false)
    expect(useEditor.getState().model).toBe(before.model)
    expect(useEditor.getState().past).toBe(before.past)
    expect(useEditor.getState().error).toMatch(/two different/)
  })

  it('typing in a field coalesces into one undo step', () => {
    const { apply } = useEditor.getState()
    const depth = useEditor.getState().past.length
    for (const name of ['C', 'Ch', 'Che', 'Check']) apply((x) => rename(x, 'Task_1', name), { coalesce: 'name:Task_1' })
    expect(useEditor.getState().past.length).toBe(depth + 1)
  })
})

describe('*.flow.json', () => {
  it('the bundled example opens', () => {
    const m = parseModel(readFileSync('src/data/examples/library-loan.flow.json', 'utf8'))
    expect(m.name).toBe('Library book loan')
    expect(m.nodes.length).toBeGreaterThan(5)
  })

  it('refuses files that would break the canvas', () => {
    expect(() => parseModel('{')).toThrow(ModelFormatError)
    expect(() => parseModel('{"format":"strata-sql"}')).toThrow('Not a StrataFlow model')
    const m = emptyModel()
    m.flows.push({ id: 'F', kind: 'sequence', source: 'A', target: 'B', name: '' })
    expect(() => parseModel(JSON.stringify(m))).toThrow('no element A')
    const dup = emptyModel()
    dup.nodes.push({ id: 'X', name: '', type: 'task', kind: 'task' }, { id: 'X', name: '', type: 'annotation' })
    expect(() => parseModel(JSON.stringify(dup))).toThrow('Duplicate id X')
  })
})
