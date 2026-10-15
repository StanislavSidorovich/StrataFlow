# Online shop: order fulfilment

## 1. Meta

- id: `shop-order`
- title: Online shop: order fulfilment
- difficulty: ★★ (case 3 of the ladder)
- concepts trained: parallel gateway (AND) split and join, a receive task, a timer boundary event (non-interrupting) for the payment deadline, a data object; repeated: XOR with a default flow, message events and flows to a black-box pool, lanes
- reference model: `shop-order.flow.json` (laid out by Auto layout, lints clean, round-trips through BPMN XML); drawn by `tests/fixtures/order-fulfilment.ts`, also the stage 1 acceptance model
- domain link: StrataSQL's Online Shop case (customers, orders, products, invoices)

## 2. Case text

> When an order from a customer arrives, a sales clerk checks in the system whether every item is in stock. If an item is missing, the order is rejected and the customer is told so. Otherwise two things happen at the same time: the warehouse packs the goods and prints a packing slip, while sales sends the invoice to the customer. When both are done, sales waits for the customer's payment. If no payment has come 14 days after that, sales sends the customer a reminder, and goes on waiting. Once the payment has arrived, the warehouse ships the order. The order is now shipped.
>
> We model the online shop's process. The customer is outside it: we only see what the customer sends to the shop and receives from it.

## 3. Text → model mapping

| Phrase | Element | Why |
|---|---|---|
| "online shop" (title) | pool **Online shop** | The organisation whose process we model. |
| "customer" | pool **Customer** (black box) | Another participant; we see only its messages. |
| "a sales clerk", "sales" | lane **Sales** | A role. |
| "the warehouse" | lane **Warehouse** | A second role. |
| "an order from a customer arrives" | message start event **Order received** + message flow Customer → it | |
| "checks in the system whether every item is in stock" | user task **Check stock** | A person works with a system: user task. A plain task is also right. |
| "If an item is missing … Otherwise" | XOR **In stock?**, branches **No** / **Yes** (default) | |
| "the order is rejected and the customer is told so" | message end event **Order rejected** + message flow to Customer | Ends by sending a message (see case 2). |
| "two things happen at the same time" | parallel gateway (AND) split | `at the same time`, `while` = both branches run, in any order. |
| "packs the goods" | manual task **Pack goods** (Warehouse) | Work by hand, no system. |
| "prints a packing slip" | data object **Packing slip**, output of Pack goods | A document the task produces; not a task of its own. |
| "sends the invoice to the customer" | send task **Send invoice** + message flow to Customer | |
| "When both are done" | parallel gateway (AND) join | Waits for both branches. |
| "waits for the customer's payment" | receive task **Receive payment** + message flow Customer → it | The process waits for a message; the deadline below needs an activity to sit on. |
| "If no payment has come 14 days after that … goes on waiting" | non-interrupting timer boundary event **14 days** on Receive payment | A deadline while waiting = timer on the border of the waiting activity. "Goes on waiting" = non-interrupting (dashed). |
| "sends the customer a reminder" | message end event **Reminder sent** + message flow to Customer | The reminder branch ends after sending; the main path keeps waiting. |
| "the warehouse ships the order" | manual task **Ship order** (Warehouse) | |
| "The order is now shipped." | end event **Order shipped** | |

## 4. Reference process

Pools:
- **Online shop** (white box), lanes: **Sales**, **Warehouse**
- **Customer** (black box, no steps)

Nodes (type, name, lane):
- message start event: **Order received**, Sales
- user task: **Check stock**, Sales
- exclusive gateway: **In stock?**, Sales
- message end event: **Order rejected**, Sales
- parallel gateway (split), Sales
- manual task: **Pack goods**, Warehouse
- send task: **Send invoice**, Sales
- parallel gateway (join), Warehouse
- receive task: **Receive payment**, Sales
- timer boundary event, non-interrupting: **14 days**, on Receive payment
- message end event: **Reminder sent**, Sales
- manual task: **Ship order**, Warehouse
- end event (none): **Order shipped**, Warehouse
- data object: **Packing slip**, Warehouse

Sequence flows:
- Order received → Check stock
- Check stock → In stock?
- In stock? → Order rejected, name **No**, condition "an item is missing"
- In stock? → parallel split, name **Yes**, default flow
- parallel split → Pack goods
- parallel split → Send invoice
- Pack goods → parallel join
- Send invoice → parallel join
- parallel join → Receive payment
- Receive payment → Ship order
- 14 days → Reminder sent
- Ship order → Order shipped

Message flows:
- Customer → Order received
- Order rejected → Customer
- Send invoice → Customer
- Customer → Receive payment
- Reminder sent → Customer

Data associations:
- Pack goods → Packing slip (output)

## 5. Key decisions and alternatives

- ✱ The wait for payment is a receive task, not an intermediate message event. Both mean "wait for a message", but a timer boundary event can only sit on an activity. The alternative with events is an event-based gateway (payment received / 14 days), which is case 4's new idea; it fits an interrupting deadline (cancel the order) better than a reminder.
- ✱ The deadline is non-interrupting: the text says "goes on waiting". An interrupting timer would end the wait, so the order could never be shipped after a reminder.
- ✱ The 14 days run from the start of the wait (after packing and invoicing), as the text says "14 days after that". A timer on the whole order would need a sub-process (case 5).
- ✱ One reminder only. Repeated reminders every 14 days would need a loop (case 4).
- ✱ The parallel join sits in Warehouse and the split in Sales. The course allows AND gateways in any lane; only an XOR split belongs in the lane of the task before it.
- The packing slip is a data object, not a task **Print packing slip**: printing is part of packing here. Modeling it as a task inside the Warehouse branch is also right.
- Without the AND split (Pack goods then Send invoice in a line) the model is still correct but slower and says less: the text stresses "at the same time".
- An AND split must be closed by an AND join (or each branch ends in its own end event). An XOR join here would let the order through twice (P07 in the check).

## 6. AS-IS problems / TO-BE ideas

- Goods are packed before the order is paid; an unpaid order ties up stock and packing work. TO-BE: payment at checkout (card or wallet), so the invoice and the wait disappear and only paid orders reach the warehouse.
- The stock check is done by hand by a clerk. TO-BE: the shop system checks stock when the order is placed (service task) and the customer sees missing items before ordering.
- A single reminder and no end to the wait: an order whose payment never comes stays open forever. TO-BE: after a second deadline, cancel the order and put the goods back in stock (interrupting timer or event-based gateway).

## 7. Hints per level, synonyms

Level 1 (tagging): roles = "sales clerk", "sales", "the warehouse"; other participant = "customer"; parallel = "at the same time", "while", "When both are done"; timer = "14 days after that"; messages = "an order … arrives", "the customer is told", "sends the invoice", "the customer's payment", "sends … a reminder"; data = "packing slip".

Level 2 (complete the process, lanes and tasks given):
- What: two tasks run at once. Where: "at the same time … while". Why: neither waits for the other. Answer: AND split before **Pack goods** and **Send invoice**, AND join after them.
- What: a deadline. Where: "If no payment has come 14 days after that". Why: something happens while the process waits. Answer: timer boundary event **14 days** on **Receive payment**.
- What: the deadline does not stop the wait. Where: "goes on waiting". Answer: make the boundary event non-interrupting (dashed border).

Level 3 (from scratch): pools and lanes; the happy path (receive, check, pack ∥ invoice, wait for payment, ship); then the rejection; then the deadline.

Synonyms:
- Order received: Order placed, New order
- Check stock: Check availability, Check inventory, Check items in stock
- In stock?: All items in stock?, Available?
- Order rejected: Order declined (also as task Reject order + end event)
- Pack goods: Pack order, Pack items
- Packing slip: Delivery note, Pick list
- Send invoice: Issue invoice, Invoice customer
- Receive payment: Wait for payment, Payment received (as an intermediate message event, without the deadline)
- 14 days: Payment overdue, Payment deadline, 14 days passed
- Reminder sent: Send reminder (task + end event), Payment reminder sent
- Ship order: Dispatch order, Send goods, Ship goods
- Order shipped: Order dispatched, Order fulfilled
