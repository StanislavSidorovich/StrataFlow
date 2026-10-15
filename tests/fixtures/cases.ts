// The own cases in `cases/`, drawn with the editor's operations. `tests/cases.test.ts` lays each one out and
// checks it against `cases/<id>.flow.json` (UPDATE_CASES=1 writes the files).
import type { FlowModel } from '../../src/core/metamodel'
import { addBoundaryEvent, addLane, addNode, addPool, appendNode, connect, moveElements, rename, setDefaultFlow, setFlow, setProbability, setSim, setSimSettings, updateNode } from '../../src/core/ops'
import { drawOrderFulfilment } from './order-fulfilment'

/** Moves a step straight down (or up) so its centre sits at `cy`: into another lane. */
function toRow(m: FlowModel, id: string, cy: number) {
  const s = m.diagram.shapes[id]
  moveElements(m, { [id]: { x: s.x, y: cy - s.height / 2 } })
}

/** Names the two branches of a decision: the first gets `no` (with its condition), the second is the default Yes. */
function branches(m: FlowModel, gatewayId: string, condition: string) {
  const [no, yes] = m.flows.filter((f) => f.source === gatewayId)
  setFlow(m, no.id, { name: 'No', condition })
  setFlow(m, yes.id, { name: 'Yes' })
  setDefaultFlow(m, yes.id, true)
}

/** Case 1 ★: start and end, tasks, one XOR with named branches, two lanes. */
export function drawLibrary(m: FlowModel) {
  addPool(m, { x: 0, y: 0 }, 'City library')
  addLane(m, 'Participant_1', 'Front desk')
  addLane(m, 'Participant_1', 'Stacks')
  const start = addNode(m, { type: 'event' }, { x: 80, y: 120 }, 'Loan requested')
  const check = appendNode(m, start.id, { type: 'task' }, 'Check library card')
  const valid = appendNode(m, check.id, { type: 'gateway' }, 'Card valid?')
  appendNode(m, valid.id, { type: 'event', position: 'end' }, 'Loan refused')
  const fetch = appendNode(m, valid.id, { type: 'task' }, 'Fetch book')
  toRow(m, fetch.id, 325)
  const record = appendNode(m, fetch.id, { type: 'task' }, 'Record loan')
  toRow(m, record.id, 125)
  const stamp = appendNode(m, record.id, { type: 'task' }, 'Stamp due date')
  const hand = appendNode(m, stamp.id, { type: 'task' }, 'Hand over book')
  appendNode(m, hand.id, { type: 'event', position: 'end' }, 'Book lent')
  branches(m, valid.id, 'the card is missing or expired')
}

/** Case 2 ★: message events, the guest as a black-box pool, message flows. */
export function drawHotel(m: FlowModel) {
  addPool(m, { x: 0, y: 0 }, 'Hotel')
  addLane(m, 'Participant_1', 'Reservations')
  addLane(m, 'Participant_1', 'Reception')
  addPool(m, { x: 0, y: 460 }, 'Guest')
  m.participants[1].processId = undefined // black box
  const start = addNode(m, { type: 'event', trigger: 'message' }, { x: 80, y: 120 }, 'Booking request received')
  const check = appendNode(m, start.id, { type: 'task' }, 'Check room availability')
  const free = appendNode(m, check.id, { type: 'gateway' }, 'Room available?')
  const declined = appendNode(m, free.id, { type: 'event', position: 'end', trigger: 'message' }, 'Request declined')
  const reserve = appendNode(m, free.id, { type: 'task' }, 'Reserve room')
  const confirm = appendNode(m, reserve.id, { type: 'task', kind: 'send' }, 'Send confirmation')
  const arrived = appendNode(m, confirm.id, { type: 'event', position: 'intermediate', trigger: 'message' }, 'Guest arrived')
  toRow(m, arrived.id, 325)
  const id = appendNode(m, arrived.id, { type: 'task' }, 'Check guest ID')
  const key = appendNode(m, id.id, { type: 'task' }, 'Hand over key card')
  appendNode(m, key.id, { type: 'event', position: 'end' }, 'Guest checked in')
  connect(m, 'Participant_2', start.id)
  connect(m, declined.id, 'Participant_2')
  connect(m, confirm.id, 'Participant_2')
  connect(m, 'Participant_2', arrived.id)
  branches(m, free.id, 'no room of that type is free on those dates')
}

/** Case 4 ★★: event-based gateway (photo or 10 minutes, whichever comes first), intermediate events, a loop. */
export function drawScooter(m: FlowModel) {
  addPool(m, { x: 0, y: 0 }, 'Scooter sharing')
  addLane(m, 'Participant_1', 'App')
  addLane(m, 'Participant_1', 'Support')
  addLane(m, 'Participant_1', 'Field team')
  addPool(m, { x: 0, y: 620 }, 'Rider')
  m.participants[1].processId = undefined // black box
  const start = addNode(m, { type: 'event', trigger: 'message' }, { x: 80, y: 120 }, 'Unlock requested')
  const check = appendNode(m, start.id, { type: 'task', kind: 'service' }, 'Check payment method')
  const valid = appendNode(m, check.id, { type: 'gateway' }, 'Payment method valid?')
  const refused = appendNode(m, valid.id, { type: 'event', position: 'end', trigger: 'message' }, 'Unlock refused')
  const unlock = appendNode(m, valid.id, { type: 'task', kind: 'service' }, 'Unlock scooter')
  const started = appendNode(m, unlock.id, { type: 'event', position: 'intermediate', trigger: 'message', throwing: true }, 'Ride started')
  const ended = appendNode(m, started.id, { type: 'event', position: 'intermediate', trigger: 'message' }, 'Ride end requested')
  const ask = appendNode(m, ended.id, { type: 'task', kind: 'send' }, 'Ask for parking photo')
  // Waiting again after a bad photo: the loop comes back in front of the event-based gateway.
  const again = appendNode(m, ask.id, { type: 'gateway' })
  const race = appendNode(m, again.id, { type: 'gateway', kind: 'eventBased' })
  const photo = appendNode(m, race.id, { type: 'event', position: 'intermediate', trigger: 'message' }, 'Parking photo received')
  const late = appendNode(m, race.id, { type: 'event', position: 'intermediate', trigger: 'timer' }, '10 minutes')
  toRow(m, late.id, 210)
  const review = appendNode(m, photo.id, { type: 'task', kind: 'user' }, 'Check parking photo')
  toRow(m, review.id, 325)
  const ok = appendNode(m, review.id, { type: 'gateway' }, 'Parked correctly?')
  const retry = appendNode(m, ok.id, { type: 'task', kind: 'send' }, 'Ask for new photo')
  connect(m, retry.id, again.id)
  const repark = appendNode(m, late.id, { type: 'task', kind: 'manual' }, 'Repark scooter')
  toRow(m, repark.id, 475)
  const parked = appendNode(m, ok.id, { type: 'gateway' })
  toRow(m, parked.id, 125)
  connect(m, repark.id, parked.id)
  const charge = appendNode(m, parked.id, { type: 'task', kind: 'service' }, 'Charge ride')
  const receipt = appendNode(m, charge.id, { type: 'event', position: 'end', trigger: 'message' }, 'Receipt sent')
  connect(m, 'Participant_2', start.id)
  connect(m, refused.id, 'Participant_2')
  connect(m, started.id, 'Participant_2')
  connect(m, 'Participant_2', ended.id)
  connect(m, ask.id, 'Participant_2')
  connect(m, 'Participant_2', photo.id)
  connect(m, retry.id, 'Participant_2')
  connect(m, receipt.id, 'Participant_2')
  branches(m, valid.id, 'no valid card or wallet')
  const [bad, good] = m.flows.filter((f) => f.source === ok.id)
  setFlow(m, bad.id, { name: 'No', condition: 'the scooter is badly parked' })
  setFlow(m, good.id, { name: 'Yes' })
  setDefaultFlow(m, good.id, true)
  return { refused, unlock, race, again, photo, late, review, ok, retry, repark, parked, charge, receipt }
}

/** Moves a step into the lane with that name (its centre row). */
function toLane(m: FlowModel, id: string, lane: string) {
  const l = m.lanes.find((x) => x.name === lane)!
  const s = m.diagram.shapes[l.id]
  toRow(m, id, s.y + s.height / 2)
}

/** Case 5 ★★: two collapsed sub-processes with pages of their own, data objects and a data store, an OR split and join. */
export function drawHospital(m: FlowModel) {
  addPool(m, { x: 0, y: 0 }, 'Hospital')
  for (const l of ['Admissions', 'Doctor', 'Diagnostics', 'Ward']) addLane(m, 'Participant_1', l)
  const start = addNode(m, { type: 'event' }, { x: 80, y: 125 }, 'Patient arrived')
  const register = appendNode(m, start.id, { type: 'subProcess' }, 'Register patient')
  // The page of Register patient: look the patient up, create a record only for a new one, print a wristband.
  const rs = m.diagram.shapes[register.id]
  const rStart = addNode(m, { type: 'event' }, { x: rs.x, y: rs.y + 40 }, '', register.id)
  const lookUp = appendNode(m, rStart.id, { type: 'task', kind: 'user' }, 'Look up patient')
  const known = appendNode(m, lookUp.id, { type: 'gateway' }, 'Patient known?')
  const create = appendNode(m, known.id, { type: 'task', kind: 'user' }, 'Create patient entry')
  const recorded = appendNode(m, create.id, { type: 'gateway' })
  connect(m, known.id, recorded.id)
  const wristband = appendNode(m, recorded.id, { type: 'task', kind: 'manual' }, 'Print wristband')
  appendNode(m, wristband.id, { type: 'event', position: 'end' }, 'Patient registered')
  const records = addNode(m, { type: 'dataStore' }, { x: m.diagram.shapes[lookUp.id].x + 50, y: rs.y + 200 }, 'Patient database', register.id)
  connect(m, records.id, lookUp.id)
  connect(m, create.id, records.id)
  const [isNew, isKnown] = m.flows.filter((f) => f.source === known.id)
  setFlow(m, isNew.id, { name: 'No', condition: 'the patient is not in the records' })
  setFlow(m, isKnown.id, { name: 'Yes' })
  setDefaultFlow(m, isKnown.id, true)

  const examine = appendNode(m, register.id, { type: 'task', kind: 'user' }, 'Examine patient')
  toLane(m, examine.id, 'Doctor')
  const letter = addNode(m, { type: 'dataObject' }, { x: m.diagram.shapes[examine.id].x, y: 60 }, 'Referral letter')
  connect(m, letter.id, examine.id)
  const tests = appendNode(m, examine.id, { type: 'gateway', kind: 'inclusive' }, 'Tests needed?')
  const blood = appendNode(m, tests.id, { type: 'task', kind: 'manual' }, 'Take blood test')
  const xray = appendNode(m, tests.id, { type: 'task', kind: 'manual' }, 'Take X-ray')
  toLane(m, blood.id, 'Diagnostics')
  toLane(m, xray.id, 'Diagnostics')
  const done = appendNode(m, blood.id, { type: 'gateway', kind: 'inclusive' })
  connect(m, xray.id, done.id)
  const [toBlood, toXray] = m.flows.filter((f) => f.source === tests.id)
  setFlow(m, toBlood.id, { name: 'Blood test', condition: 'the doctor orders a blood test' })
  setFlow(m, toXray.id, { name: 'X-ray', condition: 'the doctor orders an X-ray' })
  const results = addNode(m, { type: 'dataObject' }, { x: m.diagram.shapes[done.id].x, y: 560 }, 'Test results')
  connect(m, blood.id, results.id)
  connect(m, xray.id, results.id)
  const review = appendNode(m, done.id, { type: 'task', kind: 'user' }, 'Review test results')
  toLane(m, review.id, 'Doctor')
  connect(m, results.id, review.id)
  const stay = appendNode(m, review.id, { type: 'gateway' }, 'Stay needed?')
  const plan = appendNode(m, stay.id, { type: 'task', kind: 'user' }, 'Write treatment plan')
  const home = appendNode(m, plan.id, { type: 'event', position: 'end' }, 'Patient sent home')
  const admit = appendNode(m, stay.id, { type: 'subProcess' }, 'Admit to ward')
  toLane(m, admit.id, 'Ward')
  // The page of Admit to ward.
  const as = m.diagram.shapes[admit.id]
  const aStart = addNode(m, { type: 'event' }, { x: as.x, y: as.y + 40 }, '', admit.id)
  const bed = appendNode(m, aStart.id, { type: 'task', kind: 'user' }, 'Assign bed')
  const take = appendNode(m, bed.id, { type: 'task', kind: 'manual' }, 'Take patient to ward')
  appendNode(m, take.id, { type: 'event', position: 'end' }, 'Patient on ward')
  const admitted = appendNode(m, admit.id, { type: 'event', position: 'end' }, 'Patient admitted')
  const [goHome, goWard] = m.flows.filter((f) => f.source === stay.id)
  setFlow(m, goHome.id, { name: 'No', condition: 'the patient can be treated at home' })
  setFlow(m, goWard.id, { name: 'Yes' })
  setDefaultFlow(m, goWard.id, true)
  return { start, register, lookUp, known, create, records, examine, letter, tests, blood, xray, done, results, review, stay, plan, home, admit, bed, take, admitted }
}

/** Case 6 ★★★: three pools (two black boxes), an error end event caught on the border of a sub-process, multi-instance (parallel and sequential). */
export function drawFootball(m: FlowModel) {
  addPool(m, { x: 0, y: 0 }, 'Home club')
  for (const l of ['Match office', 'Security', 'Press office']) addLane(m, 'Participant_1', l)
  addPool(m, { x: 0, y: 620 }, 'League')
  addPool(m, { x: 0, y: 900 }, 'Visiting club')
  m.participants[1].processId = undefined // black boxes
  m.participants[2].processId = undefined
  const start = addNode(m, { type: 'event', trigger: 'message' }, { x: 80, y: 125 }, 'Fixture confirmed')
  const prepare = appendNode(m, start.id, { type: 'subProcess' }, 'Prepare stadium')
  toLane(m, prepare.id, 'Security')
  // The page of Prepare stadium: an unsafe stand ends it with an error.
  const ps = m.diagram.shapes[prepare.id]
  const pStart = addNode(m, { type: 'event' }, { x: ps.x, y: ps.y + 40 }, '', prepare.id)
  const inspect = appendNode(m, pStart.id, { type: 'task', kind: 'manual' }, 'Inspect stands')
  const safe = appendNode(m, inspect.id, { type: 'gateway' }, 'Stands safe?')
  appendNode(m, safe.id, { type: 'event', position: 'end', trigger: 'error' }, 'Stand unsafe')
  const gates = appendNode(m, safe.id, { type: 'task', kind: 'manual' }, 'Set up gates')
  appendNode(m, gates.id, { type: 'event', position: 'end' }, 'Stadium ready')
  const [unsafe, ok] = m.flows.filter((f) => f.source === safe.id)
  setFlow(m, unsafe.id, { name: 'No', condition: 'a stand is unsafe' })
  setFlow(m, ok.id, { name: 'Yes' })
  setDefaultFlow(m, ok.id, true)
  const caught = addBoundaryEvent(m, prepare.id, 'error')
  rename(m, caught.id, 'Stadium unsafe')
  const callOff = appendNode(m, caught.id, { type: 'task', kind: 'user' }, 'Call off match')
  toLane(m, callOff.id, 'Match office')
  const calledOff = appendNode(m, callOff.id, { type: 'event', position: 'end', trigger: 'message' }, 'Match called off')

  const check = appendNode(m, prepare.id, { type: 'task', kind: 'service' }, 'Check player registration')
  toLane(m, check.id, 'Match office')
  updateNode(m, check.id, { loop: 'parallel' })
  const open = appendNode(m, check.id, { type: 'task', kind: 'manual' }, 'Open gates')
  toLane(m, open.id, 'Security')
  const host = appendNode(m, open.id, { type: 'task' }, 'Host match')
  toLane(m, host.id, 'Match office')
  const split = appendNode(m, host.id, { type: 'gateway', kind: 'parallel' })
  const press = appendNode(m, split.id, { type: 'task', kind: 'manual' }, 'Hold press conference')
  toLane(m, press.id, 'Press office')
  updateNode(m, press.id, { loop: 'sequential' })
  const result = appendNode(m, split.id, { type: 'task', kind: 'send' }, 'Send result')
  const join = appendNode(m, press.id, { type: 'gateway', kind: 'parallel' })
  connect(m, result.id, join.id)
  toLane(m, join.id, 'Match office')
  const closed = appendNode(m, join.id, { type: 'event', position: 'end' }, 'Match day closed')
  connect(m, 'Participant_2', start.id)
  connect(m, calledOff.id, 'Participant_2')
  connect(m, calledOff.id, 'Participant_3')
  connect(m, result.id, 'Participant_2')
  return { start, prepare, inspect, safe, caught, callOff, calledOff, check, open, host, split, press, result, join, closed }
}


/** The centre line of a lane (to put a step in it). */
const rowOf = (m: FlowModel, laneId: string) => m.diagram.shapes[laneId].y + m.diagram.shapes[laneId].height / 2

/** Case 7 ★★★, AS-IS: a paper expense claim with long waits and a rework loop. Figures in hours (8 h a working day). */
export function drawExpenseAsIs(m: FlowModel) {
  addPool(m, { x: 0, y: 0 }, 'Company')
  const emp = addLane(m, 'Participant_1', 'Employee')
  const mgr = addLane(m, 'Participant_1', 'Manager')
  const fin = addLane(m, 'Participant_1', 'Finance')
  const start = addNode(m, { type: 'event' }, { x: 80, y: rowOf(m, emp.id) }, 'Expenses incurred')
  const fill = appendNode(m, start.id, { type: 'task' }, 'Fill in expense form')
  const merge = appendNode(m, fill.id, { type: 'gateway' })
  toRow(m, merge.id, rowOf(m, mgr.id))
  const check = appendNode(m, merge.id, { type: 'task' }, 'Check expense form')
  const ok = appendNode(m, check.id, { type: 'gateway' }, 'Form complete?')
  const complete = appendNode(m, ok.id, { type: 'task' }, 'Complete expense form')
  toRow(m, complete.id, rowOf(m, emp.id))
  connect(m, complete.id, merge.id)
  const enter = appendNode(m, ok.id, { type: 'task' }, 'Enter claim')
  toRow(m, enter.id, rowOf(m, fin.id))
  const receipts = appendNode(m, enter.id, { type: 'task' }, 'Check receipts')
  const pay = appendNode(m, receipts.id, { type: 'task' }, 'Pay claim')
  appendNode(m, pay.id, { type: 'event', position: 'end' }, 'Claim paid')
  branches(m, ok.id, 'a receipt or a field is missing')
  setProbability(m, m.flows.find((f) => f.source === ok.id && f.target === complete.id)!.id, 0.25)
  setSimSettings(m, { unit: 'h' })
  setSim(m, fill.id, { duration: 0.33, cost: 10 })
  setSim(m, check.id, { wait: 16, duration: 0.17, cost: 10 })
  setSim(m, complete.id, { wait: 8, duration: 0.25, cost: 7.5 })
  setSim(m, enter.id, { wait: 8, duration: 0.25, cost: 10 })
  setSim(m, receipts.id, { duration: 0.17, cost: 6.8 })
  setSim(m, pay.id, { wait: 80, duration: 0.08, cost: 3.2 })
}

/** Case 7 ★★★, TO-BE: the claim in an app, an automatic completeness check, approval only above a limit and in parallel with the receipts check, a weekly payment run. */
export function drawExpenseToBe(m: FlowModel) {
  addPool(m, { x: 0, y: 0 }, 'Company')
  const emp = addLane(m, 'Participant_1', 'Employee')
  const app = addLane(m, 'Participant_1', 'Expense app')
  const mgr = addLane(m, 'Participant_1', 'Manager')
  const fin = addLane(m, 'Participant_1', 'Finance')
  const start = addNode(m, { type: 'event' }, { x: 80, y: rowOf(m, emp.id) }, 'Expenses incurred')
  const submit = appendNode(m, start.id, { type: 'task', kind: 'user' }, 'Submit claim in app')
  const merge = appendNode(m, submit.id, { type: 'gateway' })
  toRow(m, merge.id, rowOf(m, app.id))
  const auto = appendNode(m, merge.id, { type: 'task', kind: 'service' }, 'Check completeness')
  const ok = appendNode(m, auto.id, { type: 'gateway' }, 'Claim complete?')
  const complete = appendNode(m, ok.id, { type: 'task', kind: 'user' }, 'Complete claim')
  toRow(m, complete.id, rowOf(m, emp.id))
  connect(m, complete.id, merge.id)
  const split = appendNode(m, ok.id, { type: 'gateway', kind: 'parallel' })
  branches(m, ok.id, 'a receipt photo or a field is missing')
  const limit = appendNode(m, split.id, { type: 'gateway' }, 'Above 200 EUR?')
  const receipts = appendNode(m, split.id, { type: 'task' }, 'Check receipts')
  toRow(m, receipts.id, rowOf(m, fin.id))
  const approve = appendNode(m, limit.id, { type: 'task' }, 'Approve claim')
  toRow(m, approve.id, rowOf(m, mgr.id))
  const joinLimit = appendNode(m, approve.id, { type: 'gateway' })
  connect(m, limit.id, joinLimit.id)
  const [toApprove, skip] = [m.flows.find((f) => f.source === limit.id && f.target === approve.id)!, m.flows.find((f) => f.source === limit.id && f.target === joinLimit.id)!]
  setFlow(m, toApprove.id, { name: 'Yes', condition: 'the claim is above 200 EUR' })
  setFlow(m, skip.id, { name: 'No' })
  setDefaultFlow(m, skip.id, true)
  const join = appendNode(m, joinLimit.id, { type: 'gateway', kind: 'parallel' })
  toRow(m, join.id, rowOf(m, fin.id))
  connect(m, receipts.id, join.id)
  const pay = appendNode(m, join.id, { type: 'task' }, 'Pay claim')
  appendNode(m, pay.id, { type: 'event', position: 'end' }, 'Claim paid')
  setProbability(m, m.flows.find((f) => f.source === ok.id && f.target === complete.id)!.id, 0.05)
  setProbability(m, toApprove.id, 0.3)
  setSimSettings(m, { unit: 'h' })
  setSim(m, submit.id, { duration: 0.17, cost: 5 })
  setSim(m, auto.id, { duration: 0, cost: 0.2 })
  setSim(m, complete.id, { wait: 2, duration: 0.1, cost: 3 })
  setSim(m, approve.id, { wait: 4, duration: 0.08, cost: 5 })
  setSim(m, receipts.id, { wait: 4, duration: 0.17, cost: 6.8 })
  setSim(m, pay.id, { wait: 20, duration: 0.05, cost: 2 })
}

/** `md`: the case file when two models share one (AS-IS and TO-BE). */
export const CASES: { id: string; name: string; draw: (m: FlowModel) => unknown; md?: string }[] = [
  { id: 'library-lend', name: 'Lend a book', draw: drawLibrary },
  { id: 'hotel-booking', name: 'Hotel booking and check-in', draw: drawHotel },
  { id: 'shop-order', name: 'Order fulfilment', draw: drawOrderFulfilment },
  { id: 'scooter-ride', name: 'Scooter ride', draw: drawScooter },
  { id: 'hospital-admission', name: 'Patient admission', draw: drawHospital },
  { id: 'football-match', name: 'Match day', draw: drawFootball },
  { id: 'expense-claim-as-is', name: 'Expense claim (AS-IS)', draw: drawExpenseAsIs, md: 'expense-claim' },
  { id: 'expense-claim-to-be', name: 'Expense claim (TO-BE)', draw: drawExpenseToBe, md: 'expense-claim' },
]
