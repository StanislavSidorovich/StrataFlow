# Scooter sharing: a ride

## 1. Meta

- id: `scooter-ride`
- title: Scooter sharing: a ride
- difficulty: ★★ (case 4 of the ladder)
- concepts trained: event-based gateway (whichever comes first: a message or a timer), intermediate events (throwing and catching message, timer), a rework loop closed by an exclusive join, three lanes; repeated: message start and end events, a black-box pool, XOR with a default flow, send / service / user / manual tasks
- reference model: `scooter-ride.flow.json` (laid out by Auto layout, lints clean, round-trips through BPMN XML); drawn by `drawScooter` in `tests/fixtures/cases.ts`
- domain link: StrataSQL's Scooter Sharing case (riders, scooters, rides, payments)

## 2. Case text

> A rider asks the app to unlock a scooter. The app checks the rider's payment method. If it is not valid, the app refuses the unlock and tells the rider. Otherwise the app unlocks the scooter and tells the rider that the ride has started. The app then waits until the rider ends the ride, and asks the rider for a photo of the parked scooter. Now one of two things happens first: the photo arrives, or 10 minutes pass. If the photo arrives, a support agent checks it. If the scooter is badly parked, the agent asks the rider for a new photo, and the app waits again for whichever comes first. If no photo has come within 10 minutes, someone from the field team goes out and reparks the scooter. Once the scooter is parked correctly, the app charges the ride and sends the rider a receipt.
>
> We model the scooter sharing company's process; its app does the automated steps. The rider is outside it: we only see what the rider sends to the company and receives from it.

## 3. Text → model mapping

| Phrase | Element | Why |
|---|---|---|
| "A rider" | pool **Rider** (black box) | Another participant; we see only its messages. |
| "asks the app to unlock a scooter" | message start event **Unlock requested** + message flow Rider → it | A message from the rider starts the process. |
| "The app" | lane **App** | The company's system does the automated steps: a lane of its own (Bizagi models often give a system a lane). |
| "checks the rider's payment method" | service task **Check payment method** | Done by the system without a person: service task. |
| "If it is not valid … Otherwise" | XOR **Payment method valid?**, branches **No** / **Yes** (default) | |
| "refuses the unlock and tells the rider" | message end event **Unlock refused** + message flow to Rider | Ends by sending a message. |
| "unlocks the scooter" | service task **Unlock scooter** | |
| "tells the rider that the ride has started" | throwing intermediate message event **Ride started** + message flow to Rider | The process sends and goes on at once: a throwing intermediate event (a send task is also right). |
| "waits until the rider ends the ride" | catching intermediate message event **Ride end requested** + message flow Rider → it | The process stops until a message comes. |
| "asks the rider for a photo of the parked scooter" | send task **Ask for parking photo** + message flow to Rider | |
| "one of two things happens first: the photo arrives, or 10 minutes pass" | event-based gateway, then **Parking photo received** (catching message) and **10 minutes** (timer) | The rider decides, not the company: the company cannot test a condition, it can only wait and react to whichever event comes first. |
| "a support agent" | lane **Support** | A role. |
| "checks it" | user task **Check parking photo** | A person working with the app: user task. |
| "If the scooter is badly parked" | XOR **Parked correctly?**, branches **No** / **Yes** (default) | In the Support lane, as the task before it (course rule for XOR splits). |
| "asks the rider for a new photo" | send task **Ask for new photo** + message flow to Rider | |
| "the app waits again for whichever comes first" | flow back to an exclusive join in front of the event-based gateway | A rework loop: it goes back through an XOR join (an AND join would wait forever). |
| "someone from the field team" | lane **Field team** | A third role. |
| "goes out and reparks the scooter" | manual task **Repark scooter** | Work by hand, outside. |
| "Once the scooter is parked correctly" | exclusive join (from Yes and from Repark scooter) | Only one of the two branches comes: an XOR join. |
| "the app charges the ride" | service task **Charge ride** | |
| "sends the rider a receipt" | message end event **Receipt sent** + message flow to Rider | The process ends by sending: a message end event. |
| "the scooter sharing company's process" | pool **Scooter sharing** | The organisation whose process we model. |

## 4. Reference process

Pools:
- **Scooter sharing** (white box), lanes: **App**, **Support**, **Field team**
- **Rider** (black box, no steps)

Nodes (type, name, lane):
- message start event: **Unlock requested**, App
- service task: **Check payment method**, App
- exclusive gateway: **Payment method valid?**, App
- message end event: **Unlock refused**, App
- service task: **Unlock scooter**, App
- throwing intermediate message event: **Ride started**, App
- catching intermediate message event: **Ride end requested**, App
- send task: **Ask for parking photo**, App
- exclusive gateway (join, the loop comes back here), App
- event-based gateway, App
- catching intermediate message event: **Parking photo received**, App
- timer intermediate event: **10 minutes**, App
- user task: **Check parking photo**, Support
- exclusive gateway: **Parked correctly?**, Support
- send task: **Ask for new photo**, Support
- manual task: **Repark scooter**, Field team
- exclusive gateway (join), App
- service task: **Charge ride**, App
- message end event: **Receipt sent**, App

Sequence flows:
- Unlock requested → Check payment method → Payment method valid?
- Payment method valid? → Unlock refused, name **No**, condition "no valid card or wallet"
- Payment method valid? → Unlock scooter, name **Yes**, default flow
- Unlock scooter → Ride started → Ride end requested → Ask for parking photo → XOR join → event-based gateway
- event-based gateway → Parking photo received → Check parking photo → Parked correctly?
- Parked correctly? → Ask for new photo, name **No**, condition "the scooter is badly parked"
- Ask for new photo → XOR join (the loop)
- Parked correctly? → XOR join before Charge ride, name **Yes**, default flow
- event-based gateway → 10 minutes → Repark scooter → XOR join before Charge ride
- XOR join → Charge ride → Receipt sent

Message flows:
- Rider → Unlock requested
- Unlock refused → Rider
- Ride started → Rider
- Rider → Ride end requested
- Ask for parking photo → Rider
- Rider → Parking photo received
- Ask for new photo → Rider
- Receipt sent → Rider

## 5. Key decisions and alternatives

- ✱ "Whichever comes first" is an **event-based gateway**, not an exclusive one. An exclusive gateway tests data the process already has; here the company does not know yet whether a photo will come. Course rule (Chapter 3, racing events, exercise 3.7): when the other party decides, wait for its possible messages with an event-based gateway.
- ✱ The timer sits after the event-based gateway, not on the border of a receive task. Both say "wait for the photo for at most 10 minutes". The gateway shows the two outcomes as equals and is the new idea of this case; a receive task **Receive parking photo** with an interrupting 10-minute boundary timer is also right (case 3 used that form with a non-interrupting timer).
- ✱ The loop goes back to an exclusive join in front of the event-based gateway, so the 10 minutes start again after each new request. A parallel join there would wait forever (P07).
- ✱ The two branches of the event-based gateway meet in an exclusive join before **Charge ride**: only one of them ever runs. Two end events with their own Charge ride would duplicate the task (P14).
- ✱ "The ride has started" is a throwing intermediate message event: the process tells the rider and goes on. A send task **Confirm ride start** is equally good.
- ✱ The app is a lane. Some teachers prefer lanes for people only; then the app's steps go in a lane **Operations** and keep their service-task type.
- A rider who never ends the ride is not modeled (a second timer on Ride end requested would need another event-based gateway): the case keeps one new idea.

## 6. AS-IS problems / TO-BE ideas

- A support agent checks every parking photo by hand. TO-BE: an image check in the app (service task) passes clear photos and sends only unclear ones to support.
- A badly parked scooter can loop many times. TO-BE: after the second bad photo, send the field team and charge a parking fee.
- The field team drives out for every missing photo. TO-BE: check the scooter's GPS position first; only a scooter outside a parking zone needs a visit.

## 7. Hints per level, synonyms

Level 1 (tagging): other participant = "A rider"; roles = "The app", "a support agent", "the field team"; decisions = "If it is not valid", "Otherwise", "If the scooter is badly parked"; race = "one of two things happens first", "whichever comes first"; messages = "asks the app to unlock", "tells the rider", "asks the rider for a photo", "the photo arrives", "sends the rider a receipt"; timer = "10 minutes pass".

Level 2 (complete the process, lanes and tasks given):
- What: the rider decides what happens next. Where: "one of two things happens first". Why: the company can only wait and react. Answer: an event-based gateway after **Ask for parking photo**, with **Parking photo received** and **10 minutes** after it.
- What: a loop. Where: "the app waits again for whichever comes first". Answer: **Ask for new photo** flows back to an exclusive join in front of the event-based gateway.
- What: two ways meet. Where: "Once the scooter is parked correctly". Answer: an exclusive join before **Charge ride**.

Level 3 (from scratch): pools and lanes; the happy path (unlock, ride, photo, check, charge); then the refusal; then the race with the timer; then the loop.

Synonyms:
- Scooter sharing: Sharing company, Scooter company
- Rider: Customer, User
- App: System, Platform, Operations
- Support: Support agent, Customer support
- Field team: Field service, Operations team
- Unlock requested: Unlock request received, Ride requested
- Check payment method: Verify payment method, Check payment
- Payment method valid?: Payment OK?, Valid payment?
- Unlock refused: Unlock declined, Refuse unlock
- Unlock scooter: Release scooter
- Ride started: Confirm ride start, Ride start confirmed
- Ride end requested: Ride ended, End of ride requested
- Ask for parking photo: Request parking photo, Request photo
- Parking photo received: Photo received
- 10 minutes: 10 minutes passed, No photo in 10 minutes
- Check parking photo: Review parking photo, Check photo
- Parked correctly?: Correctly parked?, Parking OK?
- Ask for new photo: Request new photo
- Repark scooter: Move scooter, Park scooter
- Charge ride: Charge rider, Bill ride, Take payment
- Receipt sent: Send receipt, Ride completed
