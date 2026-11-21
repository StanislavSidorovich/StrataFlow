// A synthetic large collaboration for the layout tests: three white-box pools with five lanes between them,
// 30+ tasks, event-based gateways with message waits and timers, boundary timers with fallback paths, loops back,
// message flows both ways between the pools. Nothing here comes from a real project. Drawn scattered on purpose.
import type { FlowModel } from '../../src/core/metamodel'
import { addBoundaryEvent, addLane, addNode, addPool, connect, rename, setFlow } from '../../src/core/ops'

export function drawThreePoolModel(m: FlowModel) {
  const shop = addPool(m, { x: 0, y: 0 }, 'Shop')
  addLane(m, shop.id, 'Sales')
  addLane(m, shop.id, 'Warehouse')
  const bank = addPool(m, { x: 0, y: 500 }, 'Bank')
  addLane(m, bank.id, 'Front office')
  addLane(m, bank.id, 'Risk')
  const post = addPool(m, { x: 0, y: 1000 }, 'Courier')
  let k = 0
  const at = (y: number) => ({ x: 90 + ((k++ * 61) % 900), y: y + ((k * 23) % 60) - 30 })
  const task = (name: string, y: number, kind: 'task' | 'user' | 'send' | 'receive' | 'service' | 'manual' = 'task') => addNode(m, { type: 'task', kind }, at(y), name)
  const gate = (kind: 'exclusive' | 'parallel' | 'eventBased', y: number, name = '') => addNode(m, { type: 'gateway', kind }, at(y), name)
  const wait = (trigger: 'message' | 'timer', y: number, name: string) => addNode(m, { type: 'event', position: 'intermediate', trigger, throwing: false }, at(y), name)
  const end = (name: string, y: number) => addNode(m, { type: 'event', position: 'end' }, at(y), name)
  const SALES = 100
  const STORE = 250
  const FRONT = 600
  const RISK = 750
  const SHIP = 1100
  const chain = (ids: string[]) => ids.slice(1).forEach((id, i) => connect(m, ids[i], id))

  // Shop: Sales takes the order, asks the bank, waits for its answer or a timeout (event gateway), loops on a rejection.
  const start = addNode(m, { type: 'event', position: 'start', trigger: 'message' }, at(SALES), 'Order placed')
  const receive = task('Receive order', SALES, 'user')
  const check = task('Check stock', SALES, 'user')
  const stocked = gate('exclusive', SALES, 'In stock?')
  const backorder = task('Create back order', STORE)
  const quote = task('Prepare quote', SALES)
  const askBank = task('Ask bank to authorise', SALES, 'send')
  const eg = gate('eventBased', SALES)
  const authorised = wait('message', SALES, 'Authorised')
  const declined = wait('message', SALES, 'Declined')
  const tooLate = wait('timer', SALES, '2 days')
  const contact = task('Contact customer', SALES, 'send')
  const confirm = task('Confirm order', SALES)
  connect(m, start.id, receive.id)
  chain([receive.id, check.id, stocked.id])
  connect(m, stocked.id, quote.id)
  connect(m, stocked.id, backorder.id)
  connect(m, backorder.id, check.id) // loop back
  chain([quote.id, askBank.id, eg.id])
  connect(m, eg.id, authorised.id)
  connect(m, eg.id, declined.id)
  connect(m, eg.id, tooLate.id)
  connect(m, declined.id, contact.id)
  connect(m, contact.id, quote.id) // loop back
  connect(m, tooLate.id, contact.id)
  connect(m, authorised.id, confirm.id)
  const [yes, no] = m.flows.filter((f) => f.source === stocked.id)
  setFlow(m, yes.id, { name: 'Yes' })
  setFlow(m, no.id, { name: 'No' })

  // Warehouse: pick in parallel, pack, a boundary timer on picking with a fallback, hand over to the courier.
  const split = gate('parallel', STORE)
  const join = gate('parallel', STORE)
  connect(m, confirm.id, split.id)
  for (let i = 1; i <= 3; i++) {
    const pick = task(`Pick items ${i}`, STORE, 'user')
    const timer = addBoundaryEvent(m, pick.id, 'timer')
    rename(m, timer.id, '1 day')
    const urgent = task(`Call supplier ${i}`, STORE, 'send')
    const pack = task(`Pack parcel ${i}`, STORE, 'manual')
    const label = task(`Print label ${i}`, STORE, 'service')
    const merge = gate('exclusive', STORE)
    connect(m, split.id, pick.id)
    connect(m, pick.id, merge.id)
    connect(m, timer.id, urgent.id)
    connect(m, urgent.id, merge.id)
    connect(m, merge.id, pack.id)
    connect(m, pack.id, label.id)
    connect(m, label.id, join.id)
  }
  const handOver = task('Hand parcel to courier', STORE, 'send')
  const invoice = task('Send invoice', SALES, 'send')
  const sold = end('Order complete', STORE)
  const cancelled = end('Order cancelled', SALES)
  connect(m, join.id, handOver.id)
  connect(m, handOver.id, invoice.id)
  connect(m, invoice.id, sold.id)
  connect(m, contact.id, cancelled.id)

  // Bank: front office takes the request, risk checks it, an XOR, a retry loop, answers by message.
  const bstart = addNode(m, { type: 'event', position: 'start', trigger: 'message' }, at(FRONT), 'Request arrives')
  const regist = task('Register request', FRONT, 'user')
  const score = task('Score customer', RISK, 'service')
  const limit = task('Check limit', RISK, 'user')
  const ok = gate('exclusive', RISK, 'Within limit?')
  const manual = task('Review by analyst', RISK, 'user')
  const mtimer = addBoundaryEvent(m, manual.id, 'timer')
  rename(m, mtimer.id, '4 hours')
  const escalate = task('Escalate to manager', RISK, 'user')
  const grant = task('Grant authorisation', FRONT, 'send')
  const refuse = task('Refuse authorisation', FRONT, 'send')
  const record = task('Record decision', FRONT)
  const bend = end('Request closed', FRONT)
  connect(m, bstart.id, regist.id)
  chain([regist.id, score.id, limit.id, ok.id])
  connect(m, ok.id, grant.id)
  connect(m, ok.id, manual.id)
  connect(m, manual.id, refuse.id)
  connect(m, manual.id, limit.id) // loop back
  connect(m, mtimer.id, escalate.id)
  connect(m, escalate.id, refuse.id)
  connect(m, grant.id, record.id)
  connect(m, refuse.id, record.id)
  connect(m, record.id, bend.id)
  const [inLimit, over] = m.flows.filter((f) => f.source === ok.id)
  setFlow(m, inLimit.id, { name: 'Yes' })
  setFlow(m, over.id, { name: 'No' })

  // Courier: collect, scan, deliver, an XOR for a failed delivery that loops back, proof of delivery.
  const cstart = addNode(m, { type: 'event', position: 'start', trigger: 'message' }, at(SHIP), 'Parcel ready')
  const collect = task('Collect parcel', SHIP, 'user')
  const scan = task('Scan parcel', SHIP, 'service')
  const plan = task('Plan route', SHIP)
  const deliver = task('Deliver parcel', SHIP, 'manual')
  const home = gate('exclusive', SHIP, 'Customer home?')
  const card = task('Leave card', SHIP, 'manual')
  const proof = task('Record proof', SHIP, 'user')
  const cend = end('Delivered', SHIP)
  connect(m, cstart.id, collect.id)
  chain([collect.id, scan.id, plan.id, deliver.id, home.id])
  connect(m, home.id, proof.id)
  connect(m, home.id, card.id)
  connect(m, card.id, plan.id) // loop back
  connect(m, proof.id, cend.id)
  const [at1, at2] = m.flows.filter((f) => f.source === home.id)
  setFlow(m, at1.id, { name: 'Yes' })
  setFlow(m, at2.id, { name: 'No' })

  // Messages between the pools, both ways.
  connect(m, handOver.id, cstart.id)
  connect(m, proof.id, invoice.id)
  connect(m, askBank.id, bstart.id)
  connect(m, grant.id, authorised.id)
  connect(m, refuse.id, declined.id)
  return { shop, bank, post }
}
