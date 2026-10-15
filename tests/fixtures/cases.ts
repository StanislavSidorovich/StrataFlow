// The own cases in `cases/`, drawn with the editor's operations. `tests/cases.test.ts` lays each one out and
// checks it against `cases/<id>.flow.json` (UPDATE_CASES=1 writes the files).
import type { FlowModel } from '../../src/core/metamodel'
import { addLane, addNode, addPool, appendNode, connect, moveElements, setDefaultFlow, setFlow } from '../../src/core/ops'
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

export const CASES: { id: string; name: string; draw: (m: FlowModel) => unknown }[] = [
  { id: 'library-lend', name: 'Lend a book', draw: drawLibrary },
  { id: 'hotel-booking', name: 'Hotel booking and check-in', draw: drawHotel },
  { id: 'shop-order', name: 'Order fulfilment', draw: drawOrderFulfilment },
  { id: 'scooter-ride', name: 'Scooter ride', draw: drawScooter },
]
