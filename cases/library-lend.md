# Library: lend a book

## 1. Meta

- id: `library-lend`
- title: Library: lend a book
- difficulty: ★ (case 1 of the ladder)
- concepts trained: start and end event, task, exclusive gateway (XOR) with named branches and a default flow, one pool with two lanes, a handoff between lanes
- reference model: `library-lend.flow.json` (laid out by Auto layout, lints clean, round-trips through BPMN XML)
- domain link: StrataSQL's Library case (members, books, loans)

## 2. Case text

> A member comes to the front desk of the city library and asks to borrow a book. The librarian at the front desk checks the member's library card. If the card is missing or has expired, the loan is refused. Otherwise an assistant from the stacks fetches the book from the shelves and brings it to the desk. The librarian then records the loan in the library system, stamps the due date in the book and hands the book over to the member. The book is now lent.

## 3. Text → model mapping

| Phrase | Element | Why |
|---|---|---|
| "city library" | pool **City library** | The organisation whose process this is. One pool: we model only what the library does. |
| "the librarian at the front desk" | lane **Front desk** | A role that does work. Lanes are named after roles, not people. |
| "an assistant from the stacks" | lane **Stacks** | A second role; the book has to travel between the two lanes. |
| "asks to borrow a book" | start event **Loan requested** | What starts the process. Event name = noun + past participle. |
| "checks the member's library card" | task **Check library card** | Verb + noun, imperative. |
| "If the card is missing or has expired … Otherwise" | exclusive gateway **Card valid?** with branches **No** / **Yes** | `if … otherwise` = one of two ways (XOR). The gateway asks a question, the branches answer it. |
| "the loan is refused" | end event **Loan refused** | One way the process ends. Nothing more happens in the library, so no task is needed. |
| "fetches the book from the shelves and brings it to the desk" | task **Fetch book** (lane Stacks) | One task: bringing it back is part of fetching. |
| "records the loan in the library system" | task **Record loan** | |
| "stamps the due date in the book" | task **Stamp due date** | |
| "hands the book over to the member" | task **Hand over book** | |
| "The book is now lent." | end event **Book lent** | The good outcome. Each end event names the outcome it stands for. |

## 4. Reference process

Pools:
- **City library** (white box), lanes: **Front desk**, **Stacks**

Nodes (type, name, lane):
- start event (none): **Loan requested**, Front desk
- task: **Check library card**, Front desk
- exclusive gateway: **Card valid?**, Front desk
- end event (none): **Loan refused**, Front desk
- task: **Fetch book**, Stacks
- task: **Record loan**, Front desk
- task: **Stamp due date**, Front desk
- task: **Hand over book**, Front desk
- end event (none): **Book lent**, Front desk

Sequence flows:
- Loan requested → Check library card
- Check library card → Card valid?
- Card valid? → Loan refused, name **No**, condition "the card is missing or expired"
- Card valid? → Fetch book, name **Yes**, default flow
- Fetch book → Record loan
- Record loan → Stamp due date
- Stamp due date → Hand over book
- Hand over book → Book lent

Message flows: none. Data: none.

## 5. Key decisions and alternatives

- ✱ The member is not drawn as a pool. Case 1 trains one pool and its lanes; pools talking to each other (message flows) are the new idea of case 2. So the start event is a plain (none) start event.
- ✱ "The loan is refused" is an end event, not a task plus an end event. The text names no work, only an outcome. Adding a task **Refuse loan** before the end event is also right.
- ✱ The decision is a question with Yes / No branches and Yes as the default flow. **Card valid?** with **Valid** / **Missing or expired** is equally good. A gateway named "Check card" is wrong: the check is the task before it.
- ✱ **Record loan**, **Stamp due date** and **Hand over book** are three tasks because the text names three acts. Merging them into one task **Lend book** is an acceptable coarser model; the comparison accepts it as a synonym of the three.
- No join gateway: the two branches end in their own end events, so nothing has to be merged (course: a split is closed by a join of the same type or by end events of its own).
- The XOR sits in the Front desk lane, the lane of the task before it (course convention).

## 6. AS-IS problems / TO-BE ideas

- Two handoffs (Front desk → Stacks → Front desk): the member waits while the assistant walks to the shelves. TO-BE: the member reserves the book online, the stacks fetch it in advance, the desk only records and hands it over.
- The card is checked only at the desk, after the member has waited in the queue. TO-BE: a self-service kiosk checks the card and records the loan; the desk handles only refusals.
- **Record loan** and **Stamp due date** do the same thing twice (the system already knows the due date). TO-BE: print a due-date slip from the system.

## 7. Hints per level, synonyms

Level 1 (tagging): roles = "librarian at the front desk", "assistant from the stacks"; decision = "If … Otherwise"; activities = "checks", "fetches", "records", "stamps", "hands over"; events = "asks to borrow", "is refused", "is now lent".

Level 2 (complete the process, lanes and tasks given):
- What: one decision is missing. Where: "If the card is missing or has expired … Otherwise". Why: two outcomes exclude each other. Answer: XOR **Card valid?** after **Check library card**, No → **Loan refused**, Yes → **Fetch book**.
- What: the process has two ways to end. Where: "is refused", "is now lent". Answer: two end events.

Level 3 (from scratch): start with the roles (two lanes), then the happy path left to right, then the refusal branch.

Synonyms:
- Check library card: Check card, Check membership, Verify library card, Check membership card
- Card valid?: Membership valid?, Card OK?, Valid card?
- Fetch book: Get book, Bring book, Retrieve book
- Record loan: Register loan, Enter loan, Log loan
- Stamp due date: Mark due date, Stamp book
- Hand over book: Give book, Hand book to member
- Lend book (coarse) = Record loan + Stamp due date + Hand over book
- Loan requested: Book requested, Member arrived; Book lent: Loan completed, Book handed over; Loan refused: Loan rejected
