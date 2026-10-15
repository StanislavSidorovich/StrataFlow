// Trainer cases (SPEC §9–10): the machine form of `cases/*.md`. The case text, the phrases that map to
// model elements (level 0 links, level 1 tagging, "where" hints), synonyms for the comparison and the key
// decisions. The reference model is the case's `.flow.json`. Content: CC BY-NC-SA 4.0 (LICENSE-CONTENT).
import type { FlowModel } from '../core/metamodel'
import { parseModel } from '../core/serialize'
import libraryLend from '../../cases/library-lend.flow.json?raw'
import hotelBooking from '../../cases/hotel-booking.flow.json?raw'
import shopOrder from '../../cases/shop-order.flow.json?raw'
import scooterRide from '../../cases/scooter-ride.flow.json?raw'
import hospitalAdmission from '../../cases/hospital-admission.flow.json?raw'
import footballMatch from '../../cases/football-match.flow.json?raw'

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
  {
    id: 'hospital-admission',
    title: 'Hospital: patient admission',
    difficulty: 2,
    concepts: ['sub-processes on pages of their own', 'data objects and a data store', 'inclusive gateway (OR) and when to avoid it', 'four lanes'],
    text: [
      'A patient comes to the hospital with a referral letter from their family doctor, and the admissions clerk registers the patient. Registering works like this: the clerk looks the patient up in the patient database. If the patient is new, the clerk creates an entry for the patient. Then the clerk prints a wristband, and the patient is registered.',
      'A doctor examines the patient, reading the referral letter. Depending on the findings, the diagnostics team takes a blood test, an X-ray, or both. Each test adds to the test results. When all the ordered tests are done, the doctor reviews the test results. If the patient does not need to stay, the doctor writes a treatment plan and the patient is sent home. Otherwise the patient is admitted to a ward. Admitting works like this: a ward nurse assigns a bed and takes the patient to the ward.',
      "We model the hospital's process. Registering and admitting are sub-processes: one step on the main diagram, with their own steps on a page of their own.",
    ],
    spans: [
      { p: 0, phrase: 'A patient comes to the hospital', tag: 'event', target: ['Patient arrived'], why: 'What starts the process: a start event. The patient is not a pool in this case, so the arrival is a plain start event.' },
      { p: 0, phrase: 'a referral letter', tag: 'data', target: ['Referral letter'], why: 'A document the process uses: a data object, linked to the task that reads it.' },
      { p: 0, phrase: 'the admissions clerk', tag: 'role', target: ['Admissions'], why: 'A role: a lane.' },
      { p: 0, phrase: 'registers the patient', tag: 'activity', target: ['Register patient'], why: 'The next sentence tells how registering works step by step: one step on the main diagram, a collapsed sub-process, with its steps on its own page.' },
      { p: 0, phrase: 'the clerk', tag: 'role', target: ['Admissions'], why: 'The same role: the steps of the page sit in the Admissions lane, with the sub-process.' },
      { p: 0, phrase: 'looks the patient up', tag: 'activity', target: ['Look up patient'], why: 'The first task on the page of Register patient.' },
      { p: 0, phrase: 'the patient database', tag: 'data', target: ['Patient database'], why: "Kept data that outlives this patient's case and other processes use: a data store (a cylinder). Look up patient reads it." },
      { p: 0, phrase: 'If the patient is new', tag: 'decision', target: ['Patient known?'], why: 'An exclusive gateway on the page; the No branch does one more task.' },
      { p: 0, phrase: 'the clerk', tag: 'role', target: ['Admissions'], why: 'The Admissions lane.' },
      { p: 0, phrase: 'creates an entry for the patient', tag: 'activity', target: ['Create patient entry'], why: 'A task that writes to the data store: the arrow goes from the task to Patient database.' },
      { p: 0, phrase: 'Then', tag: 'decision', target: ['Print wristband'], why: 'Both branches meet again: an exclusive join before Print wristband.' },
      { p: 0, phrase: 'the clerk', tag: 'role', target: ['Admissions'], why: 'The Admissions lane.' },
      { p: 0, phrase: 'prints a wristband', tag: 'activity', target: ['Print wristband'], why: 'Work by hand: a manual task.' },
      { p: 0, phrase: 'the patient is registered', tag: 'event', target: ['Patient registered'], why: 'The end event of the page. The main process goes on after the sub-process.' },
      { p: 1, phrase: 'A doctor', tag: 'role', target: ['Doctor'], why: 'A role: a lane.' },
      { p: 1, phrase: 'examines the patient', tag: 'activity', target: ['Examine patient'], why: 'A task.' },
      { p: 1, phrase: 'reading the referral letter', tag: 'data', target: ['Referral letter'], why: 'The letter is an input of the task: a data association from Referral letter to Examine patient.' },
      { p: 1, phrase: 'Depending on the findings', tag: 'decision', target: ['Tests needed?'], why: 'A decision after Examine patient, in the Doctor lane. Which kind? The end of the sentence tells: "or both".' },
      { p: 1, phrase: 'the diagnostics team', tag: 'role', target: ['Diagnostics'], why: 'A third role: a lane.' },
      { p: 1, phrase: 'takes a blood test', tag: 'activity', target: ['Take blood test'], why: 'A manual task on one branch of the split.' },
      { p: 1, phrase: 'an X-ray', tag: 'activity', target: ['Take X-ray'], why: 'A manual task on the other branch.' },
      { p: 1, phrase: 'or both', tag: 'decision', target: ['Tests needed?'], why: '"Or both": one or more of the ways run. That is an inclusive (OR) gateway, a diamond with a circle; not an XOR (only one) and not an AND (always both).' },
      { p: 1, phrase: 'adds to the test results', tag: 'data', target: ['Test results'], why: 'A data object written by both tests.' },
      { p: 1, phrase: 'When all the ordered tests are done', tag: 'decision', target: ['Review test results'], why: 'An inclusive (OR) join: it waits for the tests that were ordered, and only for them.' },
      { p: 1, phrase: 'the doctor', tag: 'role', target: ['Doctor'], why: 'Back in the Doctor lane.' },
      { p: 1, phrase: 'reviews the test results', tag: 'activity', accept: ['data'], target: ['Review test results'], why: 'A task that reads Test results.' },
      { p: 1, phrase: 'If the patient does not need to stay', tag: 'decision', target: ['Stay needed?'], why: 'An exclusive gateway in the Doctor lane, as the task before it.' },
      { p: 1, phrase: 'the doctor', tag: 'role', target: ['Doctor'], why: 'The Doctor lane.' },
      { p: 1, phrase: 'writes a treatment plan', tag: 'activity', target: ['Write treatment plan'], why: 'A task.' },
      { p: 1, phrase: 'the patient is sent home', tag: 'event', target: ['Patient sent home'], why: 'One outcome: an end event.' },
      { p: 1, phrase: 'Otherwise', tag: 'decision', target: ['Stay needed?'], why: 'The other branch (Yes, the default flow).' },
      { p: 1, phrase: 'admitted to a ward', tag: 'activity', target: ['Admit to ward'], why: 'Told step by step in the next sentence: a second collapsed sub-process.' },
      { p: 1, phrase: 'a ward nurse', tag: 'role', target: ['Ward'], why: 'A fourth role: the Ward lane, where Admit to ward sits.' },
      { p: 1, phrase: 'assigns a bed', tag: 'activity', target: ['Assign bed'], why: 'A task on the page of Admit to ward.' },
      { p: 1, phrase: 'takes the patient to the ward', tag: 'activity', target: ['Take patient to ward'], why: 'Work by hand: a manual task; the page ends with Patient on ward, the main diagram with Patient admitted.' },
      { p: 2, phrase: "the hospital's process", tag: 'participant', target: ['Hospital'], why: 'The organisation whose process we model: the pool.' },
      { p: 2, phrase: 'sub-processes', tag: 'activity', target: ['Register patient', 'Admit to ward'], why: 'A sub-process is an activity with steps of its own; collapsed, it shows a + and opens on a page.' },
    ],
    decisions: [
      '"A blood test, an X-ray, or both" is an inclusive (OR) gateway: one or more ways run, and the OR join waits only for the ones started. Use it only where the text really allows any combination: an XOR or an AND is easier to read, and an OR join belongs right after its OR split.',
      'Registering and admitting are told step by step: each is a collapsed sub-process with its steps on a page of its own (double-click to open). Each page has its own start and end event.',
      'Patient database is a data store (kept, shared with other processes); Referral letter and Test results are data objects (this case only). The arrow points from what is read to the task, from the task to what is written.',
      'The patient is not a pool here, so the arrival is a plain start event; with a Patient pool it would be a message start event.',
    ],
    synonyms: {
      Hospital: ['Clinic', 'Hospital admissions'],
      Admissions: ['Admission desk', 'Reception', 'Admissions clerk'],
      Doctor: ['Physician', 'Doctors'],
      Diagnostics: ['Diagnostics team', 'Laboratory', 'Lab'],
      Ward: ['Ward nurse', 'Nursing'],
      'Patient arrived': ['Patient arrives', 'Patient came in'],
      'Register patient': ['Registration', 'Admit patient'],
      'Look up patient': ['Find patient', 'Search patient record', 'Look up patient record'],
      'Patient known?': ['Patient in records?', 'Existing patient?', 'New patient?'],
      'Create patient entry': ['Create record', 'Register new patient'],
      'Print wristband': ['Hand out wristband'],
      'Patient registered': ['Registration done'],
      'Examine patient': ['Examine', 'First examination'],
      'Tests needed?': ['Which tests?', 'Order tests'],
      'Take blood test': ['Blood test', 'Do blood test'],
      'Take X-ray': ['X-ray', 'Do X-ray'],
      'Review test results': ['Review results', 'Check test results'],
      'Stay needed?': ['Admit patient?', 'Stay in hospital?'],
      'Write treatment plan': ['Make treatment plan', 'Prescribe treatment'],
      'Patient sent home': ['Patient discharged', 'Sent home'],
      'Admit to ward': ['Admission to ward', 'Ward admission'],
      'Assign bed': ['Allocate bed', 'Give bed'],
      'Take patient to ward': ['Bring patient to ward', 'Move patient to ward'],
      'Patient on ward': ['On ward', 'Patient in bed'],
      'Patient admitted': ['Admitted'],
      'Patient database': ['Patient database', 'Hospital records'],
      'Referral letter': ['Referral'],
      'Test results': ['Results'],
    },
    reference: model(hospitalAdmission),
  },
  {
    id: 'football-match',
    title: 'Football: match day',
    difficulty: 3,
    concepts: ['three pools (two black boxes)', 'error end event and error boundary event', 'multi-instance, parallel and sequential', 'AND split and join'],
    text: [
      'Match day at a football club starts when the league confirms the fixture. First the security team prepares the stadium. Preparing works like this: the team inspects the stands. If a stand is unsafe, the preparation stops with an error. Otherwise the team sets up the gates, and the stadium is ready.',
      "If the stadium is unsafe, the match office calls off the match and tells the league and the visiting club. Otherwise the match office checks the registration of every player in the squad in the league's online system: one check per player, all at the same time. Then security opens the gates and the club hosts the match. After the match, the press office holds a press conference with each coach, one after the other. Meanwhile the match office sends the result to the league. When both are done, match day is closed.",
      "We model the home club's process. The league and the visiting club are outside it: we only see the messages they send and receive.",
    ],
    spans: [
      { p: 0, phrase: 'a football club', tag: 'participant', target: ['Home club'], why: 'The organisation whose process we model: the white-box pool with the lanes.' },
      { p: 0, phrase: 'the league confirms the fixture', tag: 'message', accept: ['event'], target: ['Fixture confirmed'], why: 'A message from the league starts the process: a message start event and a message flow from the League pool.' },
      { p: 0, phrase: 'the security team', tag: 'role', target: ['Security'], why: 'A role: a lane.' },
      { p: 0, phrase: 'prepares the stadium', tag: 'activity', target: ['Prepare stadium'], why: 'Told step by step in the next sentence: a collapsed sub-process with its own page.' },
      { p: 0, phrase: 'inspects the stands', tag: 'activity', target: ['Inspect stands'], why: 'The first task on the page of Prepare stadium: a manual task.' },
      { p: 0, phrase: 'If a stand is unsafe', tag: 'decision', target: ['Stands safe?'], why: 'An exclusive gateway on the page.' },
      { p: 0, phrase: 'stops with an error', tag: 'event', target: ['Stand unsafe'], why: 'The sub-process ends abnormally: an error end event (a lightning bolt in a thick circle). It throws the error to the level above.' },
      { p: 0, phrase: 'Otherwise', tag: 'decision', target: ['Stands safe?'], why: 'The other branch (Yes, the default flow).' },
      { p: 0, phrase: 'sets up the gates', tag: 'activity', target: ['Set up gates'], why: 'A manual task.' },
      { p: 0, phrase: 'the stadium is ready', tag: 'event', target: ['Stadium ready'], why: 'The normal end of the page; the main process goes on after Prepare stadium.' },
      { p: 1, phrase: 'If the stadium is unsafe', tag: 'event', accept: ['decision'], target: ['Stadium unsafe'], why: 'Not a gateway: an error boundary event on the border of Prepare stadium catches the error thrown inside. The sub-process stops and this path starts.' },
      { p: 1, phrase: 'the match office', tag: 'role', target: ['Match office'], why: 'A role: a lane.' },
      { p: 1, phrase: 'calls off the match', tag: 'activity', target: ['Call off match'], why: 'A user task on the exception path.' },
      { p: 1, phrase: 'tells the league and the visiting club', tag: 'message', accept: ['event'], target: ['Match called off'], why: 'The process ends by telling two participants: one message end event with two message flows.' },
      { p: 1, phrase: 'Otherwise', tag: 'event', accept: ['decision'], target: ['Stadium unsafe'], why: 'No error: the normal flow leaves the sub-process. No gateway is needed, the boundary event is the other way.' },
      { p: 1, phrase: 'the match office', tag: 'role', target: ['Match office'], why: 'The Match office lane.' },
      { p: 1, phrase: 'checks the registration of every player', tag: 'activity', target: ['Check player registration'], why: 'One task for every player: a multi-instance activity. The online system does it: a service task.' },
      { p: 1, phrase: 'one check per player, all at the same time', tag: 'activity', accept: ['parallel'], target: ['Check player registration'], why: 'Once per item, all at once: the parallel multi-instance marker (three vertical bars, Properties → Repeats). Not an AND gateway: the number of players is not fixed.' },
      { p: 1, phrase: 'security opens the gates', tag: 'activity', accept: ['role'], target: ['Open gates'], why: 'A manual task in the Security lane.' },
      { p: 1, phrase: 'the club hosts the match', tag: 'activity', target: ['Host match'], why: 'A task.' },
      { p: 1, phrase: 'the press office', tag: 'role', target: ['Press office'], why: 'A third role: a lane.' },
      { p: 1, phrase: 'holds a press conference with each coach, one after the other', tag: 'activity', target: ['Hold press conference'], why: 'Once per coach, one after another: the sequential multi-instance marker (three horizontal bars).' },
      { p: 1, phrase: 'Meanwhile', tag: 'parallel', target: ['Hold press conference', 'Send result'], why: 'Both ways run at the same time: an AND split after Host match.' },
      { p: 1, phrase: 'the match office', tag: 'role', target: ['Match office'], why: 'The Match office lane.' },
      { p: 1, phrase: 'sends the result to the league', tag: 'message', accept: ['activity'], target: ['Send result'], why: 'A send task plus a message flow to the League pool.' },
      { p: 1, phrase: 'When both are done', tag: 'parallel', target: ['Match day closed'], why: 'An AND join waits for both branches.' },
      { p: 1, phrase: 'match day is closed', tag: 'event', target: ['Match day closed'], why: 'The end event.' },
      { p: 2, phrase: "the home club's process", tag: 'participant', target: ['Home club'], why: 'The white-box pool.' },
      { p: 2, phrase: 'The league', tag: 'participant', target: ['League'], why: 'Outside the process: a black-box pool.' },
      { p: 2, phrase: 'the visiting club', tag: 'participant', target: ['Visiting club'], why: 'A second black-box pool.' },
      { p: 2, phrase: 'the messages they send and receive', tag: 'message', target: ['Fixture confirmed', 'Match called off', 'Send result'], why: 'Message flows end at the border of a black-box pool.' },
    ],
    decisions: [
      '"Stops with an error" is an error end event on the page of Prepare stadium; "If the stadium is unsafe" is the error boundary event on its border that catches it. An XOR after the sub-process would repeat the decision made inside.',
      '"Every player … all at the same time" is one task with the parallel multi-instance marker; "each coach, one after the other" the sequential one. A loop marker would mean "again while a condition holds".',
      'League and Visiting club are black-box pools; Match called off sends to both with two message flows.',
      'Escalation events are not used (the course lists them only in its overview).',
    ],
    synonyms: {
      'Home club': ['Football club', 'Club', 'Home team'],
      League: ['Football league', 'Federation'],
      'Visiting club': ['Away club', 'Visiting team', 'Away team'],
      'Match office': ['Club office', 'Operations', 'Match operations'],
      Security: ['Security team', 'Stadium security'],
      'Press office': ['Media office', 'Press', 'Communications'],
      'Fixture confirmed': ['Fixture received', 'Match confirmed'],
      'Prepare stadium': ['Stadium preparation', 'Get stadium ready'],
      'Inspect stands': ['Check stands', 'Inspect stadium'],
      'Stands safe?': ['Stand safe?', 'Stadium safe?'],
      'Stand unsafe': ['Unsafe stand', 'Stadium not safe'],
      'Set up gates': ['Prepare gates'],
      'Stadium ready': ['Stadium prepared'],
      'Stadium unsafe': ['Unsafe stadium', 'Error unsafe'],
      'Call off match': ['Cancel match', 'Postpone match'],
      'Match called off': ['Match cancelled', 'Cancellation sent'],
      'Check player registration': ['Check registrations', 'Verify player registration', 'Check players'],
      'Open gates': ['Open stadium'],
      'Host match': ['Play match', 'Hold match'],
      'Hold press conference': ['Press conference', 'Hold press conferences'],
      'Send result': ['Report result', 'Send match result'],
      'Match day closed': ['Match day over', 'Match day ended'],
    },
    reference: model(footballMatch),
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
