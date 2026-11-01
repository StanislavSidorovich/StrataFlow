# Kaiyo Trading: distributor order

## 1. Meta

- id: `kaiyo-order`
- title: Kaiyo Trading: distributor order
- difficulty: ★★ (a reference model, not on the trainer ladder: it is read, not built)
- concepts shown: pool with lanes, black-box pool, message start and end events, message flows, exclusive gateway with a default flow, parallel split and join, non-interrupting timer boundary event, data store, annotations
- reference model: `kaiyo-order.flow.json`; opened by File → Example and by `https://flow.quaera.app/?example=kaiyo` (the link from quaera.app's data map)
- domain link: Kaiyo Trading, the dataset of Quaera (quaera.app); the same company as Model's `?example=quaera`

## 2. Case text

> A distributor sends Kaiyo Trading an order. Sales posts it in the ERP and checks the stock. If the stock does not cover the order, the distributor is told so. Otherwise two things happen at the same time: the warehouse packs and ships the goods, while finance sends the invoice. Finance then waits for the payment; when the payment is overdue, a reminder goes out and the wait goes on.

The dataset is synthetic and keeps results only, so the order of the steps is illustrative. The notes on the model name only what the data shows.

## 3. Text → model mapping

| Phrase | Element | Why |
|---|---|---|
| "Kaiyo Trading" | pool **Kaiyo Trading** | The organisation whose process we model. |
| "A distributor" | pool **Distributor** (black box) | Another company: we see only its messages. |
| "Sales", "the warehouse", "finance" | lanes **Sales**, **Warehouse**, **Finance** | Roles inside one organisation. |
| "sends ... an order" | message start event **Order received** | The process starts when a message arrives. |
| "If ... Otherwise" | XOR **Stock available?** | Only one branch runs. |
| "at the same time" | parallel split and join | Both branches run, and the join waits for both. |
| "when the payment is overdue" | timer boundary event **Payment overdue**, non-interrupting | The reminder goes out, the wait goes on. |

## 4. Reference process

- Pools: **Kaiyo Trading** (lanes Sales, Warehouse, Finance), **Distributor** (black box).
- Sales: Order received → Post order in ERP → Stock available? → No: Order declined; Yes (default): parallel split.
- Warehouse: Pack goods → Ship goods → parallel join.
- Finance: Send invoice → parallel join → Receive payment → Order paid. Boundary timer Payment overdue (non-interrupting) → Reminder sent.
- Data store: ERP, written by Post order in ERP.
- Annotations:
  - Post order in ERP: "fact_sellin: order_date and amounts"
  - Order declined: "No row in fact_sellin: every row there was shipped"
  - Ship goods: "The fact_sellin row is complete: ship_date, units, 2 to 11 days after the order"
  - Receive payment: "Invoices and payments are not in the dataset"

## 5. Key decisions and alternatives

- ✱ Only the order, not the distributors' monthly sell-out report: that is a process of its own with its own start, and it would double the picture.
- ✱ Checked against the dataset (2026-11-01): `fact_sellin` has 15 362 rows, none without `ship_date`; shipment comes 2 to 11 days after the order; one row per month, distributor and SKU, so an order of several SKUs gives several rows; no column for invoices or payments.
- ✱ Placed by hand, not by Auto layout: six message flows must not run through shapes in a model meant to be read at a glance.
- ✱ The overdue timer has no number of days: the dataset holds no payment terms, so none is invented.

## 6. AS-IS problems / TO-BE ideas

Not used: a reference model.

## 7. Hints per level, synonyms

Not used: the case is not in the trainer.
