// Online shop: order fulfilment (case 3, `cases/shop-order.md`), drawn with the editor's operations. Used by
// the stage 1 acceptance test, the BPMN round-trip test and the case reference model.
import type { FlowModel } from '../../src/core/metamodel'
import { addBoundaryEvent, addLane, addNode, addPool, appendNode, connect, moveElements, rename, setDefaultFlow, setFlow, updateNode } from '../../src/core/ops'

export function drawOrderFulfilment(m: FlowModel) {
  addPool(m, { x: 0, y: 0 }, 'Online shop')
  addLane(m, 'Participant_1', 'Sales')
  addLane(m, 'Participant_1', 'Warehouse')
  addPool(m, { x: 0, y: 460 }, 'Customer')
  m.participants[1].processId = undefined // black box
  const start = addNode(m, { type: 'event', position: 'start', trigger: 'message' }, { x: 80, y: 120 }, 'Order received')
  const check = appendNode(m, start.id, { type: 'task', kind: 'user' }, 'Check stock')
  const inStock = appendNode(m, check.id, { type: 'gateway' }, 'In stock?')
  const rejected = appendNode(m, inStock.id, { type: 'event', position: 'end', trigger: 'message' }, 'Order rejected')
  const split = appendNode(m, inStock.id, { type: 'gateway', kind: 'parallel' })
  const pack = addNode(m, { type: 'task', kind: 'manual' }, { x: 640, y: 330 }, 'Pack goods')
  const invoice = addNode(m, { type: 'task', kind: 'send' }, { x: 640, y: 200 }, 'Send invoice')
  connect(m, split.id, pack.id)
  connect(m, split.id, invoice.id)
  const join = addNode(m, { type: 'gateway', kind: 'parallel' }, { x: 790, y: 260 })
  connect(m, pack.id, join.id)
  connect(m, invoice.id, join.id)
  const pay = appendNode(m, join.id, { type: 'task', kind: 'receive' }, 'Receive payment')
  moveElements(m, { [pay.id]: { x: m.diagram.shapes[pay.id].x, y: 80 } }) // up to sales
  const ship = appendNode(m, pay.id, { type: 'task', kind: 'manual' }, 'Ship order')
  moveElements(m, { [ship.id]: { x: m.diagram.shapes[ship.id].x, y: 290 } }) // to the warehouse
  const done = appendNode(m, ship.id, { type: 'event', position: 'end' }, 'Order shipped')
  // The payment deadline: after 14 days without payment a reminder goes out, the wait goes on.
  const late = addBoundaryEvent(m, pay.id, 'timer')
  rename(m, late.id, '14 days')
  updateNode(m, late.id, { interrupting: false })
  const reminded = appendNode(m, late.id, { type: 'event', position: 'end', trigger: 'message' }, 'Reminder sent')
  const slip = addNode(m, { type: 'dataObject' }, { x: 640, y: 400 }, 'Packing slip')
  connect(m, pack.id, slip.id)
  connect(m, 'Participant_2', start.id)
  connect(m, rejected.id, 'Participant_2')
  connect(m, invoice.id, 'Participant_2')
  connect(m, 'Participant_2', pay.id)
  connect(m, reminded.id, 'Participant_2')
  const [toReject, toSplit] = m.flows.filter((f) => f.source === inStock.id)
  setFlow(m, toReject.id, { name: 'No', condition: 'an item is missing' })
  setFlow(m, toSplit.id, { name: 'Yes' })
  setDefaultFlow(m, toSplit.id, true)
  return { start, inStock, split, join, pay, late, slip, rejected, done }
}
