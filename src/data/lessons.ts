// Lessons (Learn): short reading with questions, as in StrataSQL: guess → gist → trap → test yourself, then
// practice on a case. Each lesson builds on help cards (`help.ts`). Content: CC BY-NC-SA 4.0 (LICENSE-CONTENT).

export interface Question {
  q: string
  options: string[]
  /** Index of the right option. */
  answer: number
  /** Shown after answering, right or not. */
  explain: string
}

export interface Lesson {
  id: string
  title: string
  /** One line: what you can do after it. */
  goal: string
  /** Asked before the reading: a guess primes the reading. */
  guess: Question
  gist: string[]
  /** The most common mistake. */
  trap: string
  test: Question[]
  cards: string[]
  practice?: { caseId: string; level: 1 | 2 | 3 }
}

export const LESSONS: Lesson[] = [
  {
    id: 'tasks-events',
    title: 'Tasks and events',
    goal: 'Tell work (a task) from something that happens (an event), and name both the course way.',
    guess: {
      q: 'In "The book is now lent", what is "lent"?',
      options: ['A task: someone lends the book', 'An end event: the outcome the process reaches', 'A gateway'],
      answer: 1,
      explain: 'Nobody does anything in this sentence: it states a result. Results and triggers are events; work is a task.',
    },
    gist: [
      'A **task** is work someone does, in a lane. Name it verb + noun in the imperative: *Check library card*, *Send invoice*.',
      'An **event** is something that happens and takes no time: what starts the process (start event, thin circle), a wait or a deadline on the way (intermediate, double circle), an outcome (end event, thick circle). Name it noun + past participle: *Loan requested*, *Order shipped*.',
      'Every process has at least one start and one end event. Several outcomes get several end events, each named after its outcome.',
    ],
    trap: 'Naming an event like a task ("Ship order" as an end event) or a task like an event ("Order checked" as a task). The shape and the name must say the same thing.',
    test: [
      { q: 'Which name fits a task?', options: ['Invoice sent', 'Send invoice', 'Invoice'], answer: 1, explain: 'Verb + noun, imperative. "Invoice sent" is an event name; "Invoice" names a thing (data).' },
      { q: 'The text says "A customer places an order". How does the shop\'s process start?', options: ['With a task Place order', 'With a start event Order received', 'With an end event'], answer: 1, explain: 'Placing the order is the customer\'s act; for the shop it is something that happens: a start event.' },
      { q: 'A process can end in two ways (refused, lent). How many end events?', options: ['One, both branches join into it', 'Two, one per outcome', 'None, the last task ends it'], answer: 1, explain: 'One end event per outcome makes the result readable; the course allows several end events.' },
    ],
    cards: ['task', 'start-event', 'end-event', 'naming'],
    practice: { caseId: 'library-lend', level: 1 },
  },
  {
    id: 'xor',
    title: 'Decisions: the exclusive gateway',
    goal: 'Model "if … otherwise" with an XOR split, named branches and a default flow.',
    guess: {
      q: '"If the card has expired, the loan is refused. Otherwise the book is fetched." How many of these ways are taken each time?',
      options: ['Exactly one', 'Both', 'One or both'],
      answer: 0,
      explain: 'If … otherwise: the two ways exclude each other. That is an exclusive gateway (XOR, a diamond with ×).',
    },
    gist: [
      'The task before the gateway does the check (*Check library card*); the **gateway** only routes. Name it as a question (*Card valid?*) and its branches as answers (*Yes* / *No*).',
      'Mark one branch as the **default flow** (a slash at its start): it is taken when no other condition holds.',
      'Branches that come together again are merged by an XOR **join**. Branches that end in their own end events need no join.',
    ],
    trap: 'Putting the work into the gateway ("Check card" as the gateway name, no task before it). A gateway decides nothing by itself: it only chooses a way from data that is already there.',
    test: [
      { q: 'Which words point to an XOR?', options: ['at the same time, while', 'if, otherwise, depending on', 'after 14 days'], answer: 1, explain: '"At the same time" is AND; "after 14 days" is a timer.' },
      { q: 'Best name for the gateway after "Check stock"?', options: ['Check stock', 'In stock?', 'Stock'], answer: 1, explain: 'A question its branches answer.' },
      { q: 'Two XOR branches both continue to "Ship order". What goes before "Ship order"?', options: ['An XOR join (or the flows straight into the task)', 'An AND join', 'Nothing must join them'], answer: 0, explain: 'Close a split with a join of the same kind. An AND join would wait for a branch that never comes (deadlock).' },
    ],
    cards: ['exclusive-gateway', 'default-flow', 'split-join'],
    practice: { caseId: 'library-lend', level: 2 },
  },
  {
    id: 'pools-messages',
    title: 'Pools, lanes and messages',
    goal: 'Use a pool per participant, lanes for roles, and message flows between pools.',
    guess: {
      q: 'The hotel sends the guest a confirmation. Can a sequence flow go from the hotel\'s task into the guest\'s pool?',
      options: ['Yes', 'No, between pools only message flows', 'Only with a gateway'],
      answer: 1,
      explain: 'A sequence flow stays inside one pool (one process). Between participants, dashed message flows.',
    },
    gist: [
      'A **pool** is a participant: the organisation whose process you model, or an outside party (customer, supplier). An outside party whose steps we do not know is an empty pool, a **black box**; messages end at its border.',
      '**Lanes** split a pool by role (*Sales*, *Warehouse*). Name them after roles, not people.',
      'A **message flow** (dashed, open arrow) carries what one pool gives another: a request, an invoice, the guest arriving. It starts or ends at a message event, a send or receive task, or the black-box border.',
    ],
    trap: 'Drawing the customer as a lane of the shop. The customer is not a role inside the shop: it is a participant of its own (a pool).',
    test: [
      { q: 'The receptionist and the reservations team work for the hotel. They are…', options: ['two pools', 'two lanes of the Hotel pool', 'two tasks'], answer: 1, explain: 'Roles inside one organisation: lanes.' },
      { q: 'How does a process that starts when an order arrives begin?', options: ['A message start event with a message flow from the customer', 'A plain start event and a sequence flow from the customer', 'A receive task with nothing before it'], answer: 0, explain: 'The message comes from another pool: a message start event fed by a message flow.' },
      { q: 'Why is the Guest pool empty?', options: ['It was forgotten', 'We model the hotel\'s process and do not know the guest\'s steps', 'Pools are always empty'], answer: 1, explain: 'A black box: only its messages matter.' },
    ],
    cards: ['pool', 'lane', 'black-box-pool', 'sequence-vs-message', 'message-event'],
    practice: { caseId: 'hotel-booking', level: 2 },
  },
  {
    id: 'and',
    title: 'Parallel work: the AND gateway',
    goal: 'Model work that runs at the same time with an AND split and an AND join.',
    guess: {
      q: '"The warehouse packs the goods while sales sends the invoice." Does one wait for the other?',
      options: ['Packing first, then the invoice', 'Neither waits: both run', 'Only one of them happens'],
      answer: 1,
      explain: 'Both happen, in any order: a parallel gateway (AND, a diamond with +) split.',
    },
    gist: [
      'An **AND split** starts all its branches. An **AND join** waits until every branch has arrived, then goes on once.',
      'Cue words: *at the same time*, *meanwhile*, *while*, *both*. "When both are done" is the join.',
      'Close an AND split with an AND join. An XOR join after an AND split lets the process go on twice.',
    ],
    trap: 'An AND join after an XOR split: it waits for a branch that was never taken, and the process is stuck (deadlock).',
    test: [
      { q: 'After the AND join, how many times does "Receive payment" run?', options: ['Once', 'Twice, once per branch', 'It depends'], answer: 0, explain: 'The join waits for both branches and lets one token through.' },
      { q: 'Which cue means AND?', options: ['otherwise', 'meanwhile', 'until'], answer: 1, explain: '"Otherwise" is XOR, "until" a loop.' },
      { q: 'A task with two outgoing sequence flows and no gateway means…', options: ['both flows are taken (an implicit AND split)', 'one of them is taken', 'an error'], answer: 0, explain: 'The course allows it; an explicit AND gateway is clearer.' },
    ],
    cards: ['parallel-gateway', 'split-join', 'soundness'],
    practice: { caseId: 'shop-order', level: 2 },
  },
  {
    id: 'timers',
    title: 'Deadlines: timers and boundary events',
    goal: 'Put a deadline on a waiting activity, and choose interrupting or not.',
    guess: {
      q: '"If no payment has come 14 days after that, sales sends a reminder, and goes on waiting." Does the wait stop at the reminder?',
      options: ['Yes', 'No: the reminder goes out and the wait goes on'],
      answer: 1,
      explain: '"Goes on waiting" = the deadline does not stop the activity: a non-interrupting boundary event (dashed border).',
    },
    gist: [
      'A **timer event** (a clock) stands for a time or a deadline: *every Monday*, *after 2 days*, *by Friday*.',
      'A **boundary event** sits on the border of an activity and fires while the activity runs. Interrupting (solid): the activity stops and the process follows the boundary path. Non-interrupting (dashed): the activity goes on and a second path starts.',
      'A wait for a message with a deadline: a receive task (*Receive payment*) with the timer on its border.',
    ],
    trap: 'Putting the timer on a task that is already over (on "Send invoice"): it can never fire. The deadline belongs on the activity that waits.',
    test: [
      { q: 'An order is cancelled if not paid within 7 days. The timer on "Receive payment" is…', options: ['interrupting', 'non-interrupting'], answer: 0, explain: 'The wait ends: interrupting.' },
      { q: 'Which phrase is a timer?', options: ['when the payment arrives', 'every Friday', 'if the card has expired'], answer: 1, explain: 'A point or span of time.' },
      { q: 'Where may a boundary event sit?', options: ['On a gateway', 'On a task or sub-process', 'On a start event'], answer: 1, explain: 'Only activities run for a while; events and gateways take no time.' },
    ],
    cards: ['timer-event', 'boundary-event', 'intermediate-event'],
    practice: { caseId: 'shop-order', level: 3 },
  },
]

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id)
