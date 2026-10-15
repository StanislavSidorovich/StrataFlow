# Expense claim: AS-IS → TO-BE

## 1. Meta

- id: `expense-claim` (two models: `expense-claim-as-is`, `expense-claim-to-be`)
- title: Expense claim: AS-IS → TO-BE
- difficulty: ★★★ (case 7 of the ladder)
- concepts trained: durations, waiting times, branch probabilities and costs; cycle time, processing time, cycle time efficiency, cost per case (flow analysis); a rework loop; redesign heuristics (automation, triage, parallelism, fewer hand-offs); AS-IS vs TO-BE comparison
- reference models: `expense-claim-as-is.flow.json`, `expense-claim-to-be.flow.json` (laid out by Auto layout, lint clean, round-trip through BPMN XML with their figures). Open one, then Simulate → Times and costs.
- time unit: hours; a working day has 8 hours

## 2. Case text

> Employees of a consulting company pay travel costs themselves and claim them back. Today the employee fills in a paper expense form and staples the receipts to it (about 20 minutes), then leaves it in the manager's tray. The form lies there for about two working days before the manager checks it (10 minutes). In one case out of four something is missing: the manager sends the form back, and the employee completes it (15 minutes) about a working day later and puts it back in the tray, where it waits again. A complete form goes to Finance by internal mail, which takes a working day. A finance clerk enters the claim into the accounting system (15 minutes) and checks the receipts against the travel policy (10 minutes). The money is paid with the monthly payment run: on average the claim waits ten working days for it, and preparing the payment takes 5 minutes. An hour costs 30 EUR for an employee, 60 EUR for a manager and 40 EUR for a finance clerk.
>
> The company wants claims paid within a week and at half the cost. Proposal: employees submit the claim in an expense app with photos of the receipts (10 minutes). The app checks at once that every field and photo is there; only 5 % of claims come back, and the employee completes them within two hours (6 minutes). The manager approves only claims above 200 EUR (three in ten), within half a day (5 minutes), while Finance checks the receipts at the same time, also within half a day. Payments go out weekly: a claim waits two and a half working days on average, and paying takes 3 minutes.

## 3. Text → model mapping

| Phrase | Element | Why |
|---|---|---|
| "consulting company" | pool **Company** | One organisation; the roles are lanes. |
| "the employee", "the manager", "a finance clerk" | lanes **Employee**, **Manager**, **Finance** | Roles that do the work. |
| "pay travel costs themselves and claim them back" | start event **Expenses incurred** | The trigger: costs were paid, now they are claimed. |
| "fills in a paper expense form … (about 20 minutes)" | task **Fill in expense form**, duration 0.33 h | Duration = the time someone works on it. |
| "lies there for about two working days before the manager checks it (10 minutes)" | task **Check expense form**, waiting 16 h, duration 0.17 h | The two days are waiting time, not work: they belong in the waiting column. |
| "In one case out of four something is missing" | exclusive gateway **Form complete?**, branch **No** 25 % | A probability on the branch. |
| "the employee completes it … about a working day later … puts it back in the tray" | task **Complete expense form** (waiting 8 h, 0.25 h) and a flow back to a merging gateway before **Check expense form** | A rework loop: the form goes through the check again. |
| "goes to Finance by internal mail, which takes a working day" | waiting 8 h on **Enter claim** | Transport is waiting too. |
| "enters the claim … checks the receipts" | tasks **Enter claim**, **Check receipts** | |
| "monthly payment run … ten working days" | task **Pay claim**, waiting 80 h, duration 0.08 h | |
| "An hour costs …" | the cost of each task = its hourly rate × its duration | Cost is per run; the analysis counts the runs. |
| "submit the claim in an expense app" | user task **Submit claim in app** (TO-BE) | The form and the internal mail disappear. |
| "The app checks at once" | lane **Expense app**, service task **Check completeness** | A system lane: automation. |
| "only 5 % of claims come back … within two hours" | **Claim complete?** No 5 %, task **Complete claim** (waiting 2 h) | The loop stays but is rarely taken and short. |
| "approves only claims above 200 EUR (three in ten)" | exclusive gateway **Above 200 EUR?** Yes 30 %, task **Approve claim** | Triage: the manager sees only what matters. |
| "while Finance checks the receipts at the same time" | parallel split and join around the approval and **Check receipts** | Parallelism: the longest branch sets the time. |
| "Payments go out weekly" | **Pay claim** waiting 20 h | |

## 4. Reference process

AS-IS (`expense-claim-as-is`):

Pools:
- **Company** (white box), lanes: **Employee**, **Manager**, **Finance**

Nodes (type, name, lane, figures in hours and EUR):
- start event (none): **Expenses incurred**, Employee
- task: **Fill in expense form**, Employee, duration 0.33, cost 10
- exclusive gateway (merge, no name), Manager
- task: **Check expense form**, Manager, waiting 16, duration 0.17, cost 10
- exclusive gateway: **Form complete?**, Manager
- task: **Complete expense form**, Employee, waiting 8, duration 0.25, cost 7.5
- task: **Enter claim**, Finance, waiting 8, duration 0.25, cost 10
- task: **Check receipts**, Finance, duration 0.17, cost 6.8
- task: **Pay claim**, Finance, waiting 80, duration 0.08, cost 3.2
- end event (none): **Claim paid**, Finance

Sequence flows:
- Expenses incurred → Fill in expense form → merge → Check expense form → Form complete?
- Form complete? → Complete expense form, name **No**, condition "a receipt or a field is missing", 25 %
- Complete expense form → merge
- Form complete? → Enter claim, name **Yes**, default flow
- Enter claim → Check receipts → Pay claim → Claim paid

TO-BE (`expense-claim-to-be`):

Pools:
- **Company** (white box), lanes: **Employee**, **Expense app**, **Manager**, **Finance**

Nodes:
- start event (none): **Expenses incurred**, Employee
- user task: **Submit claim in app**, Employee, duration 0.17, cost 5
- exclusive gateway (merge, no name), Expense app
- service task: **Check completeness**, Expense app, duration 0, cost 0.2
- exclusive gateway: **Claim complete?**, Expense app
- user task: **Complete claim**, Employee, waiting 2, duration 0.1, cost 3
- parallel gateway (split), Expense app
- exclusive gateway: **Above 200 EUR?**, Expense app
- task: **Approve claim**, Manager, waiting 4, duration 0.08, cost 5
- exclusive gateway (merge, no name), Manager
- task: **Check receipts**, Finance, waiting 4, duration 0.17, cost 6.8
- parallel gateway (join), Finance
- task: **Pay claim**, Finance, waiting 20, duration 0.05, cost 2
- end event (none): **Claim paid**, Finance

Sequence flows:
- Expenses incurred → Submit claim in app → merge → Check completeness → Claim complete?
- Claim complete? → Complete claim, name **No**, condition "a receipt photo or a field is missing", 5 %
- Complete claim → merge
- Claim complete? → parallel split, name **Yes**, default flow
- parallel split → Above 200 EUR?; parallel split → Check receipts
- Above 200 EUR? → Approve claim, name **Yes**, condition "the claim is above 200 EUR", 30 %
- Above 200 EUR? → merge, name **No**, default flow
- Approve claim → merge → parallel join; Check receipts → parallel join
- parallel join → Pay claim → Claim paid

Message flows: none. Data: none.

## 5. Key decisions and alternatives

- ✱ One pool, lanes per role, also for the TO-BE app (a system lane): the case is about time inside the company, not about talking to the employee as an outside party.
- ✱ The rework loop goes back through a merging exclusive gateway in front of the check (no flow straight into the task), so the loop is visible and the split has a matching join.
- ✱ Waits are typed on the task that waits (the tray before the check, the mail before Finance, the payment run before paying). Bizagi puts such waits on the task too; an intermediate timer event would be the alternative when the wait is a fixed date.
- ✱ The manager never rejects a claim: the case stays about time and cost. Adding a rejection branch is a good exercise.
- ✱ In the TO-BE the limit check sits in the app lane before the approval, in parallel with the receipts check; the two branches meet in a parallel join before payment.

## 6. AS-IS problems / TO-BE ideas

Flow analysis of the two models (Simulate → Times and costs, hours):

| | AS-IS | TO-BE | Change |
|---|---|---|---|
| Cycle time | 113.1 h (about 14 working days) | 24.5 h (about 3 working days) | −78 % |
| Processing time | 1.14 h | 0.40 h | −65 % |
| Waiting time | 112.0 h | 24.1 h | −78 % |
| Cycle time efficiency | 1.0 % | 1.6 % | |
| Cost per case | 45.83 EUR | 15.67 EUR | −66 % |

How the numbers come about (AS-IS): the check part is a rework loop, X = 16.17 + 0.25 × (8.25 + X), so X = 24.31 h, and the check runs 1.33 times per case. Then 0.33 + 24.31 + 8.25 + 0.17 + 80.08 = 113.14 h.

AS-IS problems: almost all of the time is waiting (the tray, the internal mail and above all the monthly payment run); a quarter of the forms loop back; Finance types in what the employee already wrote; the manager checks every claim.

TO-BE ideas (redesign heuristics): task automation (the app checks completeness), task elimination (no typing in Finance, no internal mail), triage (approval only above 200 EUR), parallelism (approval and receipts check at the same time), shorter batches (weekly instead of monthly payment). The cycle time efficiency stays low because the weekly run still dominates: a daily run would be the next step. Goal check: paid within a week (24.5 h ≈ 3 days, yes), half the cost (−66 %, yes).

## 7. Hints per level, synonyms

- Trainer levels 0–3 work on the AS-IS (the first paragraph's phrases). Level R (Redesign) starts from the AS-IS with its figures; the goals are a cycle time of at most 40 h (a week of working hours) and a cost of at most 22.90 per claim (half of 45.83). Its score: each goal reached 30, closeness to the TO-BE (steps, flows, figures and branch shares) 40, so another design that reaches both goals passes too.
- Start with the AS-IS: type the durations and waits from the text, then compare your cycle time with the table above. The most common mistake is to put the two days in the duration column.
- Then press Keep as AS-IS, open the TO-BE (or redesign the AS-IS yourself) and read the changes on each figure.
- Synonyms: Fill in expense form = Complete form, Fill in claim; Check expense form = Review form, Check form; Enter claim = Register claim, Book claim; Check receipts = Verify receipts; Pay claim = Reimburse employee, Transfer money; Submit claim in app = Submit claim.
