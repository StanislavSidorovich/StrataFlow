// Online shop: order fulfilment (the planned case 3), drawn with the editor's operations. Used by the
// stage 1 acceptance test and the BPMN round-trip test.
import type { FlowModel } from '../../src/core/metamodel'
import { addBoundaryEvent, addLane, addNode, addPool, appendNode, connect, rename, setDefaultFlow, setFlow, updateNode } from '../../src/core/ops'

export function drawOrderFulfilment(m: FlowModel) {
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

