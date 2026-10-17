// Help cards (SPEC §8): one BPMN idea per card, in the words of the NOVA BPM course (Dumas et al. 2013,
// Chapter 3) where it has a rule. Learning content: CC BY-NC-SA 4.0.
//
// miniModel is a tiny left-to-right flow: tokens joined by " > ". A token is a shape kind with an
// optional label after ":" (start, end, task, sub, xor, and, or, evb, msg, msgEnd, timer, error,
// errEnd, terminate, data, store, note). Branches are shown as "a | b" inside one token pair: kept simple.

export interface HelpCard {
  id: string
  title: string
  oneLiner: string
  /** A few short paragraphs. */
  body: string[]
  /** Words in a case text that hint at this element. */
  whenToUse: string[]
  miniModel?: string
  typicalMistake: string
  seeAlso: string[]
  /** Cases that use the idea, besides the ones found in the reference models (`data/caseRefs.ts`). */
  caseRefs?: string[]
}

export const HELP_CARDS: HelpCard[] = [
  {
    id: 'process',
    title: 'Process',
    oneLiner: 'A chain of steps that turns a trigger into an outcome for someone.',
    body: [
      'A process starts with one event (an order arrives, a month begins) and ends in one or more outcomes (order shipped, order rejected). Between them sit the activities, the decisions and the waits.',
      'Name a process with a noun phrase: "order fulfilment", "claim handling". The course writes it in small letters.',
    ],
    whenToUse: ['"every time a customer…"', '"from … until …"', 'a case text that tells a story with a beginning and an end'],
    miniModel: 'start:Order received > task:Check order > task:Ship order > end:Order shipped',
    typicalMistake: 'Drawing a whole department instead of one process: if there is no single trigger, it is several processes.',
    seeAlso: ['pool', 'start-event', 'end-event', 'model-size'],
  },
  {
    id: 'pool',
    title: 'Pool',
    oneLiner: 'One participant: an organisation or a party that runs its own process.',
    body: [
      'Each pool holds the process of one party: the shop, the customer, the bank. Pools talk only through message flows (dashed lines); a sequence flow never leaves its pool.',
      'Use one pool per independent party. Departments of one company are usually lanes, not pools.',
    ],
    whenToUse: ['two companies or a company and a customer', '"sends to", "receives from"', 'a party whose inside you do or do not know'],
    typicalMistake: 'Making each department a pool and joining them with message flows: inside one organisation use lanes and sequence flows.',
    seeAlso: ['lane', 'black-box-pool', 'sequence-vs-message'],
  },
  {
    id: 'lane',
    title: 'Lane',
    oneLiner: 'A role, a team or a system inside a pool: who does the step.',
    body: [
      'Lanes split a pool into bands, one per role (Clerk, Warehouse, ERP system). Put each task in the lane of whoever does it; that is where hand-offs between roles become visible.',
      'Course rule: an exclusive split sits in the lane of the task before it, the one that decides. Parallel splits and joins can sit anywhere.',
      'An empty lane says a role takes no part: put its steps in it, or delete it.',
    ],
    whenToUse: ['role names: "the clerk", "the manager", "the system"', '"passes the file to…"'],
    typicalMistake: 'A task drawn across two lanes, or in the lane of who receives the result instead of who does the work.',
    seeAlso: ['pool', 'task'],
  },
  {
    id: 'black-box-pool',
    title: 'Black-box pool',
    oneLiner: 'A pool shown empty: we know it is there, not how it works inside.',
    body: [
      'Customers, suppliers and authorities are usually black boxes: their messages matter, their process does not. Message flows then end on the pool border.',
      'A white-box pool shows its process; its message flows end on the steps that send or receive.',
    ],
    whenToUse: ['"the customer", "the supplier", "the bank" whose steps the case does not describe'],
    miniModel: 'msg:Order received > task:Check order > msgEnd:Answer sent',
    typicalMistake: 'Inventing steps for the other party that the case never mentions.',
    seeAlso: ['pool', 'message-event', 'sequence-vs-message'],
  },
  {
    id: 'task',
    title: 'Task',
    oneLiner: 'One unit of work, named verb + object: "Check invoice".',
    body: [
      'A task is work that someone does in one go. Name it with an imperative verb and an object, at most about five words, first word capitalised: "Approve order", "Send invoice".',
      'Avoid nouns ("Approval"), -ing forms ("Checking invoice") and empty verbs ("Handle", "Process", "Do"): say what really happens.',
    ],
    whenToUse: ['a verb in the case text with someone doing it: "the clerk checks the form"'],
    miniModel: 'start > task:Check invoice > end',
    typicalMistake: 'Naming the task after the document ("Invoice") or the department ("Accounting").',
    seeAlso: ['task-types', 'naming', 'sub-process'],
  },
  {
    id: 'task-types',
    title: 'Task types',
    oneLiner: 'A marker in the corner says who or what does the work.',
    body: [
      'User: a person with a system. Manual: a person, no system. Service: a system on its own. Send / receive: the task only sends or waits for a message. Script and business rule: an engine runs code or a decision table.',
      'The course mostly uses plain tasks; add a type when it tells the reader something. A task that only sends or only receives may better be a message event.',
    ],
    whenToUse: ['"the system calculates" (service)', '"enters into the system" (user)', '"by hand", "on paper" (manual)'],
    typicalMistake: 'A send task followed by an untyped end event: an end message event says the same with one shape.',
    seeAlso: ['task', 'message-event'],
  },
  {
    id: 'sub-process',
    title: 'Sub-process',
    oneLiner: 'An activity that is itself a small process: collapsed shows +, its steps sit on a page of their own.',
    body: [
      'Group steps into a sub-process when the diagram gets large or a part is a unit of its own ("Handle payment"). In Quaera Flow select the steps and press Ctrl+G; double-click the sub-process to open its page.',
      'Inside, a sub-process has its own start and end events. Its steps stay in one pool, and in BPMN it has no lanes inside.',
      'Level 1 of a process architecture is often a line of collapsed sub-processes with no gateways; level 2 opens each one.',
    ],
    whenToUse: ['"the … procedure", "the … stage"', 'more than ~30 steps on one diagram', 'a part reused or described separately'],
    miniModel: 'start > sub:Check claim > sub:Settle claim > end',
    typicalMistake: 'A sequence flow from outside going straight to a step inside the sub-process: flows end on the sub-process border.',
    seeAlso: ['model-size', 'call-activity', 'process'],
  },
  {
    id: 'call-activity',
    title: 'Call activity',
    oneLiner: 'Calls a process defined elsewhere, so it can be reused (thick border).',
    body: [
      'A sub-process belongs to one process; a call activity points to a global process that several processes call ("Check customer credit").',
      'Bizagi saves such reusable sub-processes in a separate diagram (a separate .bpmn file on export). Quaera Flow reads them as plain tasks for now.',
    ],
    whenToUse: ['the same procedure appears in several processes'],
    typicalMistake: 'Copying the same steps into each process instead of calling one shared process.',
    seeAlso: ['sub-process'],
  },
  {
    id: 'start-event',
    title: 'Start event',
    oneLiner: 'Where the process begins: a thin circle, named "noun + past participle".',
    body: [
      'Every process (top level of each pool with steps) gets an explicit start event. Name it with what happened: "Order received", "Month ended".',
      'Its trigger says why it starts: none (just starts), message (something arrived from another party), timer (a date or a period), signal, conditional.',
      'A start event has no incoming flow. Several start events are allowed when the process starts in several ways.',
    ],
    whenToUse: ['"when an order arrives"', '"every Monday"', '"once the form is submitted"'],
    miniModel: 'start:Order received > task:Check order',
    typicalMistake: 'Drawing a flow back into the start event to repeat the process: loop back to a gateway after the start instead.',
    seeAlso: ['end-event', 'message-event', 'timer-event', 'soundness'],
  },
  {
    id: 'end-event',
    title: 'End event',
    oneLiner: 'Where a path ends: a thick circle, named after the outcome.',
    body: [
      'The course always draws an explicit end event. When a process can end in different ways, give each its own end event and name the end state: "Order shipped", "Order rejected".',
      'An end event has no outgoing flow. Its trigger can throw something at the end: a message (answer sent), an error, or terminate (stop every path at once).',
    ],
    whenToUse: ['"the case is closed"', '"the customer is informed and…" (end message)', 'every outcome the text mentions'],
    miniModel: 'task:Ship order > end:Order shipped',
    typicalMistake: 'Several unnamed end events: the reader cannot tell which outcome is which.',
    seeAlso: ['start-event', 'terminate-event', 'happy-path'],
  },
  {
    id: 'intermediate-event',
    title: 'Intermediate event',
    oneLiner: 'Something that happens on the way: a double circle. Catching waits, throwing makes it happen.',
    body: [
      'A catching intermediate event (empty marker) waits: for a message, for a date, for a period. A throwing one (filled marker) sends or signals and goes on at once.',
      'Name it like any event: noun + past participle ("Payment received", "3 days passed").',
    ],
    whenToUse: ['"waits for…"', '"after two days"', '"sends a notice and goes on"'],
    miniModel: 'task:Send invoice > msg:Payment received > task:Ship order',
    typicalMistake: 'A task "Wait for payment": waiting is an event, not work.',
    seeAlso: ['message-event', 'timer-event', 'event-based-gateway', 'boundary-event'],
  },
  {
    id: 'message-event',
    title: 'Message event',
    oneLiner: 'An envelope: a message from or to another pool starts, waits for or ends the process.',
    body: [
      'Use a message event when the step only sends or only receives. Catching: empty envelope (start, intermediate, boundary). Throwing: filled envelope (intermediate, end).',
      'A message always crosses pools: draw the message flow (dashed) from the sender to the receiver.',
    ],
    whenToUse: ['"receives an e-mail / a form / an order"', '"informs the customer"'],
    miniModel: 'msg:Order received > task:Check order > msgEnd:Confirmation sent',
    typicalMistake: 'A message event with no message flow to or from another party.',
    seeAlso: ['sequence-vs-message', 'black-box-pool', 'intermediate-event'],
  },
  {
    id: 'timer-event',
    title: 'Timer event',
    oneLiner: 'A clock: start at a time, wait for a time, or react when time runs out.',
    body: [
      'Timer start: "every Monday", "on the 1st of the month". Intermediate timer: wait ("24 hours"). Timer on the border of an activity: a deadline while the work runs.',
      'Name it with the time: "Friday 17:00", "14 days".',
    ],
    whenToUse: ['"every…", "after … days"', '"if no answer within…"'],
    miniModel: 'timer:Every Monday > task:Prepare report > end:Report sent',
    typicalMistake: 'A task "Wait 3 days": waiting is a timer event.',
    seeAlso: ['boundary-event', 'event-based-gateway'],
  },
  {
    id: 'error-event',
    title: 'Error event',
    oneLiner: 'A lightning bolt: something went wrong and the normal path stops.',
    body: [
      'An error end event inside a sub-process throws the error; an error boundary event on that sub-process catches it and leads to the handling path. Error boundary events are always interrupting.',
    ],
    whenToUse: ['"if the payment fails"', '"in case the server is down"'],
    miniModel: 'sub:Pay order > error:Payment failed > task:Notify customer',
    typicalMistake: 'Using an error end event at the top level of a process where nobody catches it: use a named end event instead.',
    seeAlso: ['boundary-event', 'end-event'],
  },
  {
    id: 'terminate-event',
    title: 'Terminate end event',
    oneLiner: 'A filled circle: ends the whole process at once, every other path included.',
    body: ['Normally a process ends when every path has reached an end. A terminate end event stops it the moment one path gets there, for example after a cancellation while parallel work still runs.'],
    whenToUse: ['"the whole order is cancelled"', '"stop everything"'],
    miniModel: 'task:Cancel order > terminate:Order cancelled',
    typicalMistake: 'Using terminate everywhere: on a single path a plain end event does the same and reads simpler.',
    seeAlso: ['end-event', 'parallel-gateway'],
  },
  {
    id: 'boundary-event',
    title: 'Boundary event',
    oneLiner: 'An event on the border of an activity: a deadline, an error or a message while it runs.',
    body: [
      'Interrupting (solid double line): the activity stops and the flow leaves through the event. Non-interrupting (dashed): the activity goes on and a second path starts.',
      'A boundary event always needs an outgoing flow: what happens when it occurs.',
    ],
    whenToUse: ['"if not done within 2 days"', '"if the customer cancels while…"', '"meanwhile, send a reminder"'],
    miniModel: 'task:Send invoice > timer:14 days > task:Send reminder > end:Reminder sent',
    typicalMistake: 'A boundary event that leads nowhere, or one drawn next to the task instead of on its border.',
    seeAlso: ['timer-event', 'error-event', 'message-event'],
  },
  {
    id: 'exclusive-gateway',
    title: 'Exclusive gateway (XOR)',
    oneLiner: 'A diamond (with ×): exactly one of the ways is taken.',
    body: [
      'As a split it is a decision: name the gateway with a question ("Order complete?") and each branch with an answer or condition ("Yes", "No", "amount > 1,500"). One branch may be the default (a slash): taken when no other holds.',
      'As a join it lets through each arriving path, one at a time: it closes an exclusive split and is the right join for a rework loop.',
      'Course rule: put the split in the lane of the task that decides.',
    ],
    whenToUse: ['"if … otherwise…"', '"depending on…"', '"either … or…"'],
    miniModel: 'task:Check order > xor:Complete? > task:Ship order',
    typicalMistake: 'Branches without names: the reader cannot tell which way is which.',
    seeAlso: ['default-flow', 'split-join', 'inclusive-gateway', 'loop'],
  },
  {
    id: 'parallel-gateway',
    title: 'Parallel gateway (AND)',
    oneLiner: 'A diamond with +: all ways at once; the join waits for all of them.',
    body: [
      'A parallel split starts every branch; the order in which they run does not matter. A parallel join waits until every branch has arrived, then goes on once.',
      'Branches of a parallel split need no names. A parallel join must only close a parallel split.',
    ],
    whenToUse: ['"meanwhile", "at the same time"', '"both … and…"', '"in any order"'],
    miniModel: 'start > and > task:Pack goods | Send invoice > and > end',
    typicalMistake: 'A parallel join after an exclusive split: only one branch arrives and the join waits forever (deadlock).',
    seeAlso: ['split-join', 'exclusive-gateway'],
  },
  {
    id: 'inclusive-gateway',
    title: 'Inclusive gateway (OR)',
    oneLiner: 'A diamond with ○: one or more of the ways, each by its own condition.',
    body: [
      'Each branch carries a condition; every branch whose condition holds is taken. The OR join waits for exactly the branches that were started.',
      'Use an OR join only after an OR split. Many modellers avoid OR when XOR or AND says it, since an OR join is hard to read.',
    ],
    whenToUse: ['"one or more of…"', '"and/or"', '"if needed also…"'],
    miniModel: 'task:Assess claim > or > task:Check fraud | Inspect car > or > task:Pay claim',
    typicalMistake: 'Closing an OR split with an AND join (deadlock when not all branches run) or with an XOR join (what follows runs twice).',
    seeAlso: ['split-join', 'exclusive-gateway', 'parallel-gateway'],
  },
  {
    id: 'event-based-gateway',
    title: 'Event-based gateway',
    oneLiner: 'A diamond with a pentagon: wait and take the way of whichever event comes first.',
    body: [
      'After it come only catching events (message, timer, signal) or receive tasks. The first one to happen wins; the others are dropped.',
      'Course rule (exercise 3.7): when one party decides with an exclusive gateway and sends different messages, the other party needs an event-based gateway to wait for either message, or it deadlocks.',
    ],
    whenToUse: ['"waits for the answer, but at most 5 days"', '"either accepts or rejects (the other party decides)"'],
    miniModel: 'msgEnd:Offer sent > evb > msg:Offer accepted | timer:5 days',
    typicalMistake: 'A task or an exclusive gateway right after it: an event-based gateway can only wait for events.',
    seeAlso: ['message-event', 'timer-event', 'exclusive-gateway'],
  },
  {
    id: 'split-join',
    title: 'Split and join',
    oneLiner: 'Every split is closed by a join of the same kind: XOR by XOR, AND by AND, OR by OR.',
    body: [
      'A split opens branches, a join brings them back together. Mismatched kinds break the process: an AND split closed by an XOR join lets the rest run several times (lack of synchronisation); an XOR split closed by an AND join waits forever (deadlock).',
      'One gateway, one job: do not split and join in the same diamond. Branches can also end in their own end events instead of joining.',
      'Implicit gateways the course allows: several flows straight out of a task (AND split) and several flows straight into a task (XOR join). Drawing the gateway is clearer.',
    ],
    whenToUse: ['each "if", "meanwhile", "and/or" in the case opens a split; find where the branches meet'],
    miniModel: 'xor:OK? > task:Fix | Approve > xor > end',
    typicalMistake: 'A rework loop that goes back into an AND join: the join waits for a branch that is still looping.',
    seeAlso: ['exclusive-gateway', 'parallel-gateway', 'inclusive-gateway', 'soundness'],
  },
  {
    id: 'default-flow',
    title: 'Default flow',
    oneLiner: 'A slash on a branch of a decision: taken when no other condition holds.',
    body: ['Only exclusive, inclusive and complex gateways (and activities with conditional flows) have one. It saves writing "otherwise" as a condition and guarantees the process never gets stuck at the decision.'],
    whenToUse: ['"otherwise", "in all other cases"'],
    typicalMistake: 'Two default flows, or a default on a parallel gateway: there is nothing to choose there.',
    seeAlso: ['exclusive-gateway', 'sequence-flow'],
  },
  {
    id: 'sequence-flow',
    title: 'Sequence flow',
    oneLiner: 'A solid arrow: the order of steps inside one process.',
    body: ['Sequence flows connect events, activities and gateways of one pool (and one sub-process level). Name them only after a decision: the answer or the condition.'],
    whenToUse: ['"then", "after that", "next"'],
    typicalMistake: 'A sequence flow from one pool into another: between parties only message flows.',
    seeAlso: ['sequence-vs-message', 'default-flow'],
  },
  {
    id: 'sequence-vs-message',
    title: 'Sequence flow vs message flow',
    oneLiner: 'Solid inside a pool, dashed between pools: never the other way round.',
    body: [
      'A sequence flow orders the steps of one party. A message flow carries something from one party to another (a form, an e-mail, goods); it does not say what comes next.',
      'In Quaera Flow just draw "a line": between pools it becomes a message flow by itself.',
    ],
    whenToUse: ['"sends", "receives", "informs", "replies" between parties → message flow'],
    miniModel: 'msgEnd:Invoice sent > msg:Payment received',
    typicalMistake: 'A message flow between two lanes of the same pool: lanes are one party, use a sequence flow.',
    seeAlso: ['sequence-flow', 'message-event', 'pool'],
  },
  {
    id: 'data-object',
    title: 'Data object',
    oneLiner: 'A page with a folded corner: a document or information a step uses or produces.',
    body: [
      'An arrow (dotted) from a task to the data object: the task writes it; from the data object to a task: the task reads it. A state in brackets shows how it changes: Invoice [approved].',
      'Add data only when it helps the reader: a model full of documents hides the flow.',
    ],
    whenToUse: ['"fills in the form"', '"the approved invoice"', '"based on the report"'],
    miniModel: 'task:Check invoice > data:Invoice [approved] > task:Pay invoice',
    typicalMistake: 'Using a data object as a step in the flow: data hangs on tasks with dotted lines, the sequence goes task to task.',
    seeAlso: ['data-store', 'annotation'],
  },
  {
    id: 'data-store',
    title: 'Data store',
    oneLiner: 'A cylinder: information that lives longer than the process, such as a database.',
    body: ['Use it for systems and registers ("CRM", "Claims register") that tasks read from or write to. Unlike a data object it exists before and after a single case.'],
    whenToUse: ['"looks up in the system"', '"records in the register"'],
    typicalMistake: 'Drawing a system as a lane and as a data store at once: pick what the reader needs.',
    seeAlso: ['data-object'],
  },
  {
    id: 'annotation',
    title: 'Text annotation',
    oneLiner: 'A note in a bracket: explains a step without changing the process.',
    body: ['Put details that would make a task name too long into an annotation linked by a dotted line: rules, times, examples.'],
    whenToUse: ['a detail that matters to the reader but is not a step'],
    typicalMistake: 'Writing the process in annotations instead of drawing it.',
    seeAlso: ['naming', 'task'],
  },
  {
    id: 'loop',
    title: 'Loops and multi-instance',
    oneLiner: 'Repeat work: a loop back through an XOR join, a loop marker, or three bars for "for each".',
    body: [
      'A rework loop: an exclusive split ("OK?") leads back to an exclusive join before the work. Every loop needs a way out, or the process never ends.',
      'A loop marker (circular arrow) on a task repeats it while a condition holds. Multi-instance (three bars: parallel |||, sequential ≡) runs the task once for each item: each order line, each reviewer.',
    ],
    whenToUse: ['"until…", "repeat", "if not complete, return to…"', '"for each item"'],
    miniModel: 'xor > task:Check claim > xor:Complete? > end',
    typicalMistake: 'A loop with no exit, or a loop back into a parallel join (deadlock).',
    seeAlso: ['exclusive-gateway', 'split-join', 'soundness'],
  },
  {
    id: 'soundness',
    title: 'A process that always works',
    oneLiner: 'Every step reachable from a start, every path reaching an end, no deadlock, nothing running twice.',
    body: [
      'The course calls this behavioural correctness (Chapter 4: syntactic quality). A step with no incoming flow never runs; a step with no outgoing flow stops the process without an end; an AND join after an XOR split waits forever; an XOR join after an AND split lets the rest run twice.',
      'The Check panel lists such problems; click one to see where it is.',
    ],
    whenToUse: ['before handing in a model'],
    typicalMistake: 'A task left over from an earlier version, not connected to anything.',
    seeAlso: ['split-join', 'start-event', 'end-event', 'loop'],
  },
  {
    id: 'naming',
    title: 'Naming conventions',
    oneLiner: 'Tasks: verb + object. Events: noun + past participle. Gateways: a question. Branches: the answer.',
    body: [
      'Task: "Check invoice" (imperative, ≤ 5 words, first word capitalised). Event: "Invoice received". Exclusive gateway: "Invoice correct?" with branches "Yes" / "No". Process: a noun phrase, "invoice handling".',
      'Different steps get different names; the same step is drawn once.',
    ],
    whenToUse: ['every label you type'],
    typicalMistake: '"Invoice" as a task name, "Checking" as an event, a gateway called "Decision".',
    seeAlso: ['task', 'start-event', 'exclusive-gateway'],
  },
  {
    id: 'model-size',
    title: 'Size and the 7PMG',
    oneLiner: 'Keep diagrams small: above ~30 steps, split into sub-processes.',
    body: [
      'The 7 Process Modeling Guidelines (Chapter 4): use as few elements as possible; minimise routing paths per element; one start and one end event where possible; keep it structured (each split has a matching join); avoid OR gateways; verb-object labels; decompose above 30 elements.',
    ],
    whenToUse: ['the diagram no longer fits the screen'],
    typicalMistake: 'One huge diagram with every exception: move details into sub-processes.',
    seeAlso: ['sub-process', 'naming', 'split-join'],
  },
  {
    id: 'happy-path',
    title: 'Happy path and exceptions',
    oneLiner: 'Draw the normal case first, left to right; then add the exceptions.',
    body: [
      'The happy path is what usually happens when all goes well. Draw it in a straight line first. Then add decisions, deadlines (boundary timers) and errors one by one, each ending in a named end state.',
    ],
    whenToUse: ['starting any model'],
    miniModel: 'start:Order received > task:Check order > task:Ship order > end:Order shipped',
    typicalMistake: 'Starting with the exceptions and losing the main line.',
    seeAlso: ['end-event', 'boundary-event', 'as-is-to-be'],
  },
  {
    id: 'as-is-to-be',
    title: 'AS-IS and TO-BE',
    oneLiner: 'AS-IS shows how the work is done today; TO-BE shows the improved process.',
    body: [
      'Model the AS-IS honestly, with its waits, rework and hand-offs: they are what analysis finds (Chapter 5: value-added, business value-added, non-value-added; waste). The TO-BE then removes or changes them (Chapter 7: redesign).',
    ],
    whenToUse: ['"currently…", "today the clerk…" (AS-IS)', '"should", "proposed" (TO-BE)'],
    typicalMistake: 'Drawing the ideal process and calling it AS-IS.',
    seeAlso: ['happy-path', 'process', 'simulation'],
    caseRefs: ['expense-claim'],
  },
  {
    id: 'simulation',
    title: 'Cycle time and flow analysis',
    oneLiner: 'How long a case takes on average, how much of it is real work, and what it costs.',
    body: [
      'Give each activity its duration (processing time: someone works on it) and its waiting time (the case lies in a queue, waits for a hand-over or for the customer). Give each branch of a decision the share of cases that take it. Simulate → Times and costs does the sums; Play a case runs one case step by step.',
      'The rules (flow analysis, course Chapter 6, quantitative analysis): in a sequence, times add up. After an exclusive decision, each branch counts with its probability: 0.3 × 20 + 0.7 × 40. After a parallel split, the longest branch sets the time, but the costs of all branches add up. A rework loop taken back with probability r makes its part last T / (1 − r).',
      'Cycle time efficiency = theoretical cycle time (processing only) / cycle time. Below 10–20 % is common: most of a case is waiting, and that is where redesign starts.',
      'A lane is a resource pool: utilisation = new cases per time unit × work per case in the lane / people in the lane. Near 100 % queues grow fast; above 100 % they never stop growing.',
      'Keep as AS-IS remembers the figures; change the model into the TO-BE and every figure shows the change.',
    ],
    whenToUse: ['"takes 10 minutes", "on average"', '"in 30 % of the cases"', '"two clerks", "50 orders a day"', 'comparing AS-IS with TO-BE'],
    miniModel: 'start > task:Check claim > xor > task:Pay | Assess > xor > end',
    typicalMistake: 'Adding the times of parallel branches (only the longest counts for time), or forgetting the waiting time, which is usually most of the cycle time.',
    seeAlso: ['as-is-to-be', 'parallel-gateway', 'exclusive-gateway', 'lane'],
    caseRefs: ['expense-claim'],
  },
]

export const cardById = (id: string) => HELP_CARDS.find((c) => c.id === id)

/** The card for an element type, used by the ? next to a selected shape. */
export function cardForElement(el: { type: string; kind?: string; position?: string; trigger?: string; collapsed?: boolean }): string {
  switch (el.type) {
    case 'task':
      return 'task'
    case 'subProcess':
      return 'sub-process'
    case 'gateway':
      return ({ exclusive: 'exclusive-gateway', parallel: 'parallel-gateway', inclusive: 'inclusive-gateway', eventBased: 'event-based-gateway' } as Record<string, string>)[el.kind ?? ''] ?? 'split-join'
    case 'event':
      if (el.position === 'boundary') return 'boundary-event'
      if (el.trigger === 'message') return 'message-event'
      if (el.trigger === 'timer') return 'timer-event'
      if (el.trigger === 'error') return 'error-event'
      if (el.trigger === 'terminate') return 'terminate-event'
      return el.position === 'start' ? 'start-event' : el.position === 'end' ? 'end-event' : 'intermediate-event'
    case 'dataObject':
      return 'data-object'
    case 'dataStore':
      return 'data-store'
    case 'annotation':
      return 'annotation'
    case 'pool':
      return 'pool'
    case 'lane':
      return 'lane'
    case 'sequence':
      return 'sequence-flow'
    case 'message':
      return 'sequence-vs-message'
    case 'data':
      return 'data-object'
    case 'association':
      return 'annotation'
    default:
      return 'process'
  }
}
