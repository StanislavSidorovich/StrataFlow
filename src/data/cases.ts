// Trainer cases (SPEC §9–10): the machine form of `cases/*.md`. The case text, the phrases that map to
// model elements (level 0 links, level 1 tagging, "where" hints), synonyms for the comparison and the key
// decisions. The reference model is the case's `.flow.json`. Content: CC BY-NC-SA 4.0 (LICENSE-CONTENT).
import type { FlowModel } from '../core/metamodel'
import { parseModel } from '../core/serialize'
import libraryLend from '../../cases/library-lend.flow.json?raw'
import hotelBooking from '../../cases/hotel-booking.flow.json?raw'
import shopOrder from '../../cases/shop-order.flow.json?raw'
import scooterRide from '../../cases/scooter-ride.flow.json?raw'

export type Tag = 'participant' | 'role' | 'activity' | 'event' | 'decision' | 'parallel' | 'message' | 'data'

export const TAGS: { id: Tag; label: string; hint: string; card: string }[] = [
  { id: 'participant', label: 'Pool', hint: 'an organisation or an outside party', card: 'pool' },
  { id: 'role', label: 'Lane', hint: 'a role inside the organisation that does work', card: 'lane' },
  { id: 'activity', label: 'Task', hint: 'work someone does', card: 'task' },
  { id: 'event', label: 'Event', hint: 'something that happens: a start, an end, a wait, a deadline', card: 'start-event' },
  { id: 'decision', label: 'XOR', hint: 'one of several ways (if … otherwise)', card: 'exclusive-gateway' },
  { id: 'parallel', label: 'AND', hint: 'ways that run at the same time', card: 'parallel-gateway' },
  { id: 'message', label: 'Message', hint: 'something one participant sends another', card: 'sequence-vs-message' },
  { id: 'data', label: 'Data', hint: 'a document or record a task uses or makes', card: 'data-object' },
]

/** A phrase of the case text and what it becomes in the reference model. */
export interface TagSpan {
  /** Paragraph index in `text`. */
  p: number
  /** Exact words; found in the paragraph after the previous span of that paragraph. */
  phrase: string
  tag: Tag
  /** Other tags that are also right (sending an invoice is a task and a message). */
  accept?: Tag[]
  /** Names of the reference elements (nodes, pools, lanes) this phrase becomes. */
  target: string[]
  why: string
}

export interface TrainerCase {
  id: string
  title: string
  difficulty: 1 | 2 | 3
  concepts: string[]
  text: string[]
  spans: TagSpan[]
  /** Key decisions, shown with the worked example (level 0). */
  decisions: string[]
  /** Reference name → other accepted names. */
  synonyms: Record<string, string[]>
  /** A coarser step accepted for several reference steps. */
  groups?: Record<string, string[]>
  reference: () => FlowModel
}

const model = (text: string) => () => parseModel(text)

export const CASES: TrainerCase[] = [
  {
    id: 'library-lend',
    title: 'Library: lend a book',
    difficulty: 1,
    concepts: ['start and end events', 'tasks', 'exclusive gateway (XOR)', 'one pool, two lanes'],
    text: [
      "A member comes to the front desk of the city library and asks to borrow a book. The librarian at the front desk checks the member's library card. If the card is missing or has expired, the loan is refused. Otherwise an assistant from the stacks fetches the book from the shelves and brings it to the desk. The librarian then records the loan in the library system, stamps the due date in the book and hands the book over to the member. The book is now lent.",
    ],
    spans: [
      { p: 0, phrase: 'city library', tag: 'participant', target: ['City library'], why: 'The organisation whose process this is: one pool. The member is not drawn as a pool here; pools talking to each other come in case 2.' },
      { p: 0, phrase: 'asks to borrow a book', tag: 'event', target: ['Loan requested'], why: 'What starts the process: a start event, named noun + past participle (Loan requested).' },
      { p: 0, phrase: 'The librarian at the front desk', tag: 'role', target: ['Front desk'], why: 'A role that does work: a lane. Lanes are named after roles, not people.' },
      { p: 0, phrase: "checks the member's library card", tag: 'activity', target: ['Check library card'], why: 'Work someone does: a task, named verb + noun (Check library card).' },
      { p: 0, phrase: 'If the card is missing or has expired', tag: 'decision', target: ['Card valid?'], why: '"If … otherwise": exactly one of two ways, an exclusive gateway (XOR). The gateway asks a question, the branches answer it.' },
      { p: 0, phrase: 'the loan is refused', tag: 'event', target: ['Loan refused'], why: 'One way the process ends: an end event named after the outcome. The text names no work here, so no task is needed.' },
      { p: 0, phrase: 'Otherwise', tag: 'decision', target: ['Card valid?'], why: 'The other branch of the same decision (Yes, the default flow).' },
      { p: 0, phrase: 'an assistant from the stacks', tag: 'role', target: ['Stacks'], why: 'A second role: a second lane. The book travels from the desk to the stacks and back (handoffs).' },
      { p: 0, phrase: 'fetches the book from the shelves and brings it to the desk', tag: 'activity', target: ['Fetch book'], why: 'One task: bringing the book back is part of fetching it.' },
      { p: 0, phrase: 'records the loan in the library system', tag: 'activity', target: ['Record loan'], why: 'A task. Each act the text names is a task of its own.' },
      { p: 0, phrase: 'stamps the due date in the book', tag: 'activity', target: ['Stamp due date'], why: 'A task.' },
      { p: 0, phrase: 'hands the book over to the member', tag: 'activity', target: ['Hand over book'], why: 'A task.' },
      { p: 0, phrase: 'The book is now lent', tag: 'event', target: ['Book lent'], why: 'The good outcome: an end event. Each end event names the outcome it stands for.' },
    ],
    decisions: [
      'One pool (City library) with two lanes. The member is not a pool: messages between pools are the idea of case 2.',
      '"The loan is refused" is an end event. A task Refuse loan before it is also right.',
      'The decision is a question (Card valid?) with Yes / No branches; Yes is the default flow. A gateway named "Check card" is wrong: the check is the task before it.',
      'Record loan, Stamp due date and Hand over book are three tasks because the text names three acts. One task Lend book is an accepted coarser model.',
      'No join: each branch ends in its own end event.',
    ],
    synonyms: {
      'City library': ['Library'],
      'Front desk': ['Librarian', 'Desk', 'Front office'],
      Stacks: ['Assistant', 'Stacks assistant', 'Stack'],
      'Loan requested': ['Book requested', 'Member arrived', 'Request to borrow'],
      'Check library card': ['Check card', 'Check membership', 'Verify library card', 'Check membership card'],
      'Card valid?': ['Membership valid?', 'Card OK?', 'Valid card?'],
      'Loan refused': ['Loan rejected', 'Loan denied'],
      'Fetch book': ['Get book', 'Bring book', 'Retrieve book'],
      'Record loan': ['Register loan', 'Enter loan', 'Log loan'],
      'Stamp due date': ['Mark due date', 'Stamp book'],
      'Hand over book': ['Give book', 'Hand book to member'],
      'Book lent': ['Loan completed', 'Book handed over'],
    },
    groups: { 'Lend book': ['Record loan', 'Stamp due date', 'Hand over book'] },
    reference: model(libraryLend),
  },
  {
    id: 'hotel-booking',
    title: 'Hotel: booking and check-in',
    difficulty: 1,
    concepts: ['message events', 'a second pool as a black box', 'message flows', 'send task'],
    text: [
      "A guest sends the hotel a booking request for a room type and dates. The reservations team checks whether a room of that type is available on those dates. If no room is free, the hotel declines the request and lets the guest know. Otherwise the reservations team reserves a room and sends the guest a confirmation. The hotel then waits for the guest. When the guest arrives at the reception, the receptionist checks the guest's ID and hands over the key card. The guest is now checked in.",
      "We model the hotel's process. The guest is outside it: we only see what the guest sends to the hotel and receives from it.",
    ],
    spans: [
      { p: 0, phrase: 'A guest', tag: 'participant', target: ['Guest'], why: 'Another participant: a pool of its own. We do not see the guest\'s steps, so the pool stays empty (black box).' },
      { p: 0, phrase: 'sends the hotel a booking request', tag: 'message', accept: ['event'], target: ['Booking request received'], why: 'The process starts when a message comes from another pool: a message start event plus a message flow from the Guest pool.' },
      { p: 0, phrase: 'The reservations team', tag: 'role', target: ['Reservations'], why: 'A role inside the hotel: a lane.' },
      { p: 0, phrase: 'checks whether a room of that type is available on those dates', tag: 'activity', target: ['Check room availability'], why: 'Work: a task.' },
      { p: 0, phrase: 'If no room is free', tag: 'decision', target: ['Room available?'], why: '"If … otherwise": an exclusive gateway with two branches.' },
      { p: 0, phrase: 'declines the request and lets the guest know', tag: 'message', accept: ['event', 'activity'], target: ['Request declined'], why: 'The process ends by sending a message: a message end event and a message flow to the guest (a send task plus an end event says the same in two shapes).' },
      { p: 0, phrase: 'Otherwise', tag: 'decision', target: ['Room available?'], why: 'The other branch of the same decision.' },
      { p: 0, phrase: 'reserves a room', tag: 'activity', target: ['Reserve room'], why: 'A task.' },
      { p: 0, phrase: 'sends the guest a confirmation', tag: 'message', accept: ['activity'], target: ['Send confirmation'], why: 'The process goes on after sending, so a send task (or a throwing message event) plus a message flow to the guest.' },
      { p: 0, phrase: 'waits for the guest', tag: 'event', accept: ['message'], target: ['Guest arrived'], why: 'The process stops and waits for something from the other pool: an intermediate catching message event.' },
      { p: 0, phrase: 'When the guest arrives at the reception', tag: 'message', accept: ['event'], target: ['Guest arrived'], why: 'The guest coming is a message from the Guest pool (a message is anything one participant gives another).' },
      { p: 0, phrase: 'the receptionist', tag: 'role', target: ['Reception'], why: 'A second role: a second lane.' },
      { p: 0, phrase: "checks the guest's ID", tag: 'activity', target: ['Check guest ID'], why: 'A task.' },
      { p: 0, phrase: 'hands over the key card', tag: 'activity', target: ['Hand over key card'], why: 'A task.' },
      { p: 0, phrase: 'The guest is now checked in', tag: 'event', target: ['Guest checked in'], why: 'The outcome: an end event.' },
      { p: 1, phrase: "the hotel's process", tag: 'participant', target: ['Hotel'], why: 'The organisation whose process we model: the white-box pool with the lanes.' },
      { p: 1, phrase: 'The guest is outside it', tag: 'participant', target: ['Guest'], why: 'Outside the process: a black-box pool. Message flows end at its border.' },
    ],
    decisions: [
      'Two pools: Hotel (with two lanes) and Guest, an empty black box. Sequence flows never cross a pool border; messages do.',
      'The decline ends with a message end event. A send task followed by a plain end event is also right.',
      'The confirmation is a send task because the process goes on after it; a throwing message event is equally good.',
      'The arrival of the guest is a catching message event: a message is anything one participant gives another.',
    ],
    synonyms: {
      Hotel: ['Hotel reservations'],
      Guest: ['Customer', 'Client'],
      Reservations: ['Reservations team', 'Reservation', 'Booking team'],
      Reception: ['Receptionist', 'Front desk'],
      'Booking request received': ['Request received', 'Booking requested', 'Reservation request received'],
      'Check room availability': ['Check availability', 'Check free rooms', 'Check rooms'],
      'Room available?': ['Room free?', 'Available?'],
      'Request declined': ['Booking declined', 'Request refused', 'Decline request', 'Send refusal'],
      'Reserve room': ['Book room', 'Block room', 'Create reservation'],
      'Send confirmation': ['Confirm booking', 'Send booking confirmation', 'Confirmation sent'],
      'Guest arrived': ['Guest at reception'],
      'Check guest ID': ['Check ID', 'Verify identity', 'Check passport'],
      'Hand over key card': ['Give key card', 'Hand over key', 'Issue key card'],
      'Guest checked in': ['Check-in completed'],
    },
    reference: model(hotelBooking),
  },
  {
    id: 'shop-order',
    title: 'Online shop: order fulfilment',
    difficulty: 2,
    concepts: ['parallel gateway (AND) split and join', 'timer boundary event', 'receive task', 'data object'],
    text: [
      "When an order from a customer arrives, a sales clerk checks in the system whether every item is in stock. If an item is missing, the order is rejected and the customer is told so. Otherwise two things happen at the same time: the warehouse packs the goods and prints a packing slip, while sales sends the invoice to the customer. When both are done, sales waits for the customer's payment. If no payment has come 14 days after that, sales sends the customer a reminder, and goes on waiting. Once the payment has arrived, the warehouse ships the order. The order is now shipped.",
      "We model the online shop's process. The customer is outside it: we only see what the customer sends to the shop and receives from it.",
    ],
    spans: [
      { p: 0, phrase: 'an order from a customer arrives', tag: 'message', accept: ['event'], target: ['Order received'], why: 'A message from the customer starts the process: a message start event plus a message flow from the Customer pool.' },
      { p: 0, phrase: 'a sales clerk', tag: 'role', target: ['Sales'], why: 'A role: the Sales lane.' },
      { p: 0, phrase: 'checks in the system whether every item is in stock', tag: 'activity', target: ['Check stock'], why: 'A person working with a system: a user task (a plain task is also right).' },
      { p: 0, phrase: 'If an item is missing', tag: 'decision', target: ['In stock?'], why: '"If … otherwise": an exclusive gateway.' },
      { p: 0, phrase: 'the order is rejected and the customer is told so', tag: 'message', accept: ['event', 'activity'], target: ['Order rejected'], why: 'The process ends by telling the customer: a message end event and a message flow.' },
      { p: 0, phrase: 'Otherwise', tag: 'decision', target: ['In stock?'], why: 'The other branch (Yes, the default flow).' },
      { p: 0, phrase: 'two things happen at the same time', tag: 'parallel', target: ['Pack goods', 'Send invoice'], why: '"At the same time": both branches run, in any order: a parallel gateway (AND) split.' },
      { p: 0, phrase: 'the warehouse', tag: 'role', target: ['Warehouse'], why: 'A second role: the Warehouse lane.' },
      { p: 0, phrase: 'packs the goods', tag: 'activity', target: ['Pack goods'], why: 'Work by hand: a (manual) task.' },
      { p: 0, phrase: 'a packing slip', tag: 'data', target: ['Packing slip'], why: 'A document the task produces: a data object linked to Pack goods, not a task of its own.' },
      { p: 0, phrase: 'while', tag: 'parallel', target: ['Pack goods', 'Send invoice'], why: '"While" = meanwhile: the second branch of the AND split.' },
      { p: 0, phrase: 'sends the invoice to the customer', tag: 'message', accept: ['activity'], target: ['Send invoice'], why: 'A send task plus a message flow to the customer.' },
      { p: 0, phrase: 'When both are done', tag: 'parallel', target: ['Receive payment'], why: 'Waiting for both branches: a parallel gateway (AND) join.' },
      { p: 0, phrase: "waits for the customer's payment", tag: 'message', accept: ['activity', 'event'], target: ['Receive payment'], why: 'The process waits for a message: a receive task (the deadline needs an activity to sit on) plus a message flow from the customer.' },
      { p: 0, phrase: '14 days after that', tag: 'event', target: ['14 days'], why: 'A deadline while waiting: a timer boundary event on Receive payment.' },
      { p: 0, phrase: 'sends the customer a reminder', tag: 'message', accept: ['event', 'activity'], target: ['Reminder sent'], why: 'The reminder branch ends by sending: a message end event and a message flow.' },
      { p: 0, phrase: 'goes on waiting', tag: 'event', target: ['14 days'], why: 'The deadline does not stop the wait: the timer is non-interrupting (dashed border).' },
      { p: 0, phrase: 'ships the order', tag: 'activity', target: ['Ship order'], why: 'A task in the Warehouse lane.' },
      { p: 0, phrase: 'The order is now shipped', tag: 'event', target: ['Order shipped'], why: 'The good outcome: an end event.' },
      { p: 1, phrase: "the online shop's process", tag: 'participant', target: ['Online shop'], why: 'The organisation whose process we model: the white-box pool.' },
      { p: 1, phrase: 'The customer is outside it', tag: 'participant', target: ['Customer'], why: 'Outside the process: a black-box pool; messages end at its border.' },
    ],
    decisions: [
      'Pack goods and Send invoice sit between an AND split and an AND join: they run at the same time and the payment waits for both.',
      'The payment deadline is a non-interrupting timer on the border of the receive task Receive payment: the reminder goes out and the wait goes on.',
      'The packing slip is a data object made by Pack goods, not a task.',
      'Rejection and reminder end with message end events (a send task plus an end event is also right).',
    ],
    synonyms: {
      'Online shop': ['Shop', 'Online store', 'Store'],
      Customer: ['Client', 'Buyer'],
      Sales: ['Sales clerk', 'Sales team'],
      Warehouse: ['Warehouse staff', 'Logistics'],
      'Order received': ['Order placed', 'New order'],
      'Check stock': ['Check availability', 'Check inventory', 'Check items in stock'],
      'In stock?': ['All items in stock?', 'Available?', 'Items available?'],
      'Order rejected': ['Order declined', 'Reject order'],
      'Pack goods': ['Pack order', 'Pack items'],
      'Packing slip': ['Delivery note', 'Pick list'],
      'Send invoice': ['Issue invoice', 'Invoice customer'],
      'Receive payment': ['Wait for payment', 'Payment received'],
      '14 days': ['Payment overdue', 'Payment deadline', '14 days passed'],
      'Reminder sent': ['Send reminder', 'Payment reminder sent'],
      'Ship order': ['Dispatch order', 'Send goods', 'Ship goods'],
      'Order shipped': ['Order dispatched', 'Order fulfilled'],
    },
    reference: model(shopOrder),
  },
  {
    id: 'scooter-ride',
    title: 'Scooter sharing: a ride',
    difficulty: 2,
    concepts: ['event-based gateway', 'intermediate events', 'a rework loop', 'three lanes'],
    text: [
      "A rider asks the app to unlock a scooter. The app checks the rider's payment method. If it is not valid, the app refuses the unlock and tells the rider. Otherwise the app unlocks the scooter and tells the rider that the ride has started. The app then waits until the rider ends the ride, and asks the rider for a photo of the parked scooter. Now one of two things happens first: the photo arrives, or 10 minutes pass. If the photo arrives, a support agent checks it. If the scooter is badly parked, the agent asks the rider for a new photo, and the app waits again for whichever comes first. If no photo has come within 10 minutes, someone from the field team goes out and reparks the scooter. Once the scooter is parked correctly, the app charges the ride and sends the rider a receipt.",
      "We model the scooter sharing company's process; its app does the automated steps. The rider is outside it: we only see what the rider sends to the company and receives from it.",
    ],
    spans: [
      { p: 0, phrase: 'A rider', tag: 'participant', target: ['Rider'], why: 'Another participant: a black-box pool. We see only what the rider sends and receives.' },
      { p: 0, phrase: 'asks the app to unlock a scooter', tag: 'message', accept: ['event'], target: ['Unlock requested'], why: 'A message from the rider starts the process: a message start event plus a message flow from the Rider pool.' },
      { p: 0, phrase: 'The app', tag: 'role', target: ['App'], why: "The company's system does the automated steps: a lane of its own." },
      { p: 0, phrase: "checks the rider's payment method", tag: 'activity', target: ['Check payment method'], why: 'Done by the system without a person: a service task.' },
      { p: 0, phrase: 'If it is not valid', tag: 'decision', target: ['Payment method valid?'], why: '"If … otherwise": an exclusive gateway. The company has the data to decide.' },
      { p: 0, phrase: 'refuses the unlock and tells the rider', tag: 'message', accept: ['event', 'activity'], target: ['Unlock refused'], why: 'The process ends by telling the rider: a message end event and a message flow.' },
      { p: 0, phrase: 'Otherwise', tag: 'decision', target: ['Payment method valid?'], why: 'The other branch (Yes, the default flow).' },
      { p: 0, phrase: 'unlocks the scooter', tag: 'activity', target: ['Unlock scooter'], why: 'A service task.' },
      { p: 0, phrase: 'tells the rider that the ride has started', tag: 'message', accept: ['event', 'activity'], target: ['Ride started'], why: 'The process sends and goes on at once: a throwing intermediate message event (a send task is also right).' },
      { p: 0, phrase: 'waits until the rider ends the ride', tag: 'message', accept: ['event'], target: ['Ride end requested'], why: 'The process stops until a message comes from the rider: a catching intermediate message event.' },
      { p: 0, phrase: 'asks the rider for a photo of the parked scooter', tag: 'message', accept: ['activity'], target: ['Ask for parking photo'], why: 'A send task plus a message flow to the rider.' },
      { p: 0, phrase: 'one of two things happens first', tag: 'decision', accept: ['event'], target: ['Parking photo received', '10 minutes'], why: 'The rider decides, not the company: it can only wait and react to whichever event comes first. That is an event-based gateway, followed by the events it waits for.' },
      { p: 0, phrase: 'the photo arrives', tag: 'message', accept: ['event'], target: ['Parking photo received'], why: 'A catching message event after the event-based gateway, with a message flow from the rider.' },
      { p: 0, phrase: '10 minutes pass', tag: 'event', target: ['10 minutes'], why: 'A timer event after the event-based gateway: the other way the race can end.' },
      { p: 0, phrase: 'a support agent', tag: 'role', target: ['Support'], why: 'A role: the Support lane.' },
      { p: 0, phrase: 'checks it', tag: 'activity', target: ['Check parking photo'], why: 'A person working with the app: a user task.' },
      { p: 0, phrase: 'If the scooter is badly parked', tag: 'decision', target: ['Parked correctly?'], why: 'An exclusive gateway in the Support lane, the lane of the task before it.' },
      { p: 0, phrase: 'asks the rider for a new photo', tag: 'message', accept: ['activity'], target: ['Ask for new photo'], why: 'A send task plus a message flow to the rider.' },
      { p: 0, phrase: 'waits again for whichever comes first', tag: 'decision', accept: ['event'], target: ['Parking photo received', '10 minutes'], why: 'A loop: the flow goes back to an exclusive join in front of the event-based gateway, and the race starts again.' },
      { p: 0, phrase: 'If no photo has come within 10 minutes', tag: 'event', target: ['10 minutes'], why: 'The timer branch of the race.' },
      { p: 0, phrase: 'the field team', tag: 'role', target: ['Field team'], why: 'A third role: a third lane.' },
      { p: 0, phrase: 'reparks the scooter', tag: 'activity', target: ['Repark scooter'], why: 'Work by hand, outside: a manual task.' },
      { p: 0, phrase: 'Once the scooter is parked correctly', tag: 'decision', target: ['Charge ride'], why: 'Two ways meet and only one of them comes: an exclusive join before Charge ride.' },
      { p: 0, phrase: 'charges the ride', tag: 'activity', target: ['Charge ride'], why: 'A service task.' },
      { p: 0, phrase: 'sends the rider a receipt', tag: 'message', accept: ['event', 'activity'], target: ['Receipt sent'], why: 'The process ends by sending: a message end event and a message flow to the rider.' },
      { p: 1, phrase: "the scooter sharing company's process", tag: 'participant', target: ['Scooter sharing'], why: 'The organisation whose process we model: the white-box pool with the lanes.' },
      { p: 1, phrase: 'its app does the automated steps', tag: 'role', target: ['App'], why: 'The system is a lane: its steps are service tasks.' },
      { p: 1, phrase: 'The rider is outside it', tag: 'participant', target: ['Rider'], why: 'Outside the process: a black-box pool; messages end at its border.' },
    ],
    decisions: [
      '"Whichever comes first" is an event-based gateway: the rider decides, so the company waits for the photo or 10 minutes, whichever happens first. An exclusive gateway would need data the company does not have yet.',
      'The bad-photo loop goes back to an exclusive join in front of the event-based gateway, so the 10 minutes start again.',
      'The two branches of the race meet in an exclusive join before Charge ride: only one of them runs.',
      'Ride started is a throwing intermediate message event (a send task is equally good). A receive task with an interrupting 10-minute timer on its border is an accepted alternative to the event-based gateway.',
    ],
    synonyms: {
      'Scooter sharing': ['Sharing company', 'Scooter company'],
      Rider: ['Customer', 'User'],
      App: ['System', 'Platform', 'Operations'],
      Support: ['Support agent', 'Customer support'],
      'Field team': ['Field service', 'Operations team'],
      'Unlock requested': ['Unlock request received', 'Ride requested'],
      'Check payment method': ['Verify payment method', 'Check payment'],
      'Payment method valid?': ['Payment OK?', 'Valid payment?'],
      'Unlock refused': ['Unlock declined', 'Refuse unlock'],
      'Unlock scooter': ['Release scooter'],
      'Ride started': ['Confirm ride start', 'Ride start confirmed'],
      'Ride end requested': ['Ride ended', 'End of ride requested'],
      'Ask for parking photo': ['Request parking photo', 'Request photo'],
      'Parking photo received': ['Photo received'],
      '10 minutes': ['10 minutes passed', 'No photo in 10 minutes'],
      'Check parking photo': ['Review parking photo', 'Check photo'],
      'Parked correctly?': ['Correctly parked?', 'Parking OK?'],
      'Ask for new photo': ['Request new photo'],
      'Repark scooter': ['Move scooter', 'Park scooter'],
      'Charge ride': ['Charge rider', 'Bill ride', 'Take payment'],
      'Receipt sent': ['Send receipt', 'Ride completed'],
    },
    reference: model(scooterRide),
  },
]

export const caseById = (id: string) => CASES.find((c) => c.id === id)

/** Where each span sits in its paragraph: [start, end) character offsets (spans are found in order). */
export function spanRanges(c: TrainerCase): { start: number; end: number }[] {
  const from: Record<number, number> = {}
  return c.spans.map((s) => {
    const text = c.text[s.p] ?? ''
    const start = text.indexOf(s.phrase, from[s.p] ?? 0)
    if (start < 0) return { start: -1, end: -1 }
    from[s.p] = start + s.phrase.length
    return { start, end: start + s.phrase.length }
  })
}

/** Is `tag` a right answer for the span? */
export const tagFits = (s: TagSpan, tag: Tag) => s.tag === tag || !!s.accept?.includes(tag)
