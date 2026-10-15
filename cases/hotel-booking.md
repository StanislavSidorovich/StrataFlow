# Hotel: booking and check-in

## 1. Meta

- id: `hotel-booking`
- title: Hotel: booking and check-in
- difficulty: ★ (case 2 of the ladder)
- concepts trained: message start, intermediate and end events, a send task, a second pool (the guest) as a black box, message flows between pools; repeated from case 1: lanes, XOR with named branches
- reference model: `hotel-booking.flow.json` (laid out by Auto layout, lints clean, round-trips through BPMN XML)
- domain link: StrataSQL's Hotel case (guests, rooms, bookings)

## 2. Case text

> A guest sends the hotel a booking request for a room type and dates. The reservations team checks whether a room of that type is available on those dates. If no room is free, the hotel declines the request and lets the guest know. Otherwise the reservations team reserves a room and sends the guest a confirmation. The hotel then waits for the guest. When the guest arrives at the reception, the receptionist checks the guest's ID and hands over the key card. The guest is now checked in.
>
> We model the hotel's process. The guest is outside it: we only see what the guest sends to the hotel and receives from it.

## 3. Text → model mapping

| Phrase | Element | Why |
|---|---|---|
| "the hotel" | pool **Hotel** (white box) | The organisation whose process we model. |
| "the guest … is outside it" | pool **Guest** (black box) | A separate participant. We do not know its steps, so the pool stays empty and message flows end at its border. |
| "the reservations team" | lane **Reservations** | A role inside the hotel. |
| "the receptionist" | lane **Reception** | A second role. |
| "sends the hotel a booking request" | message start event **Booking request received** + message flow Guest → it | The process starts when a message arrives from another pool. |
| "checks whether a room … is available" | task **Check room availability** | |
| "If no room is free … Otherwise" | XOR **Room available?**, branches **No** / **Yes** | One of two ways. |
| "declines the request and lets the guest know" | message end event **Request declined** + message flow to Guest | The process ends by sending a message. A send task followed by a plain end event says the same in two elements (course: prefer the message end event). |
| "reserves a room" | task **Reserve room** | |
| "sends the guest a confirmation" | send task **Send confirmation** + message flow to Guest | Here the process goes on after sending, so a send task (or an intermediate throwing message event) is needed. |
| "waits for the guest. When the guest arrives" | intermediate message event **Guest arrived** (catching), lane Reception, + message flow Guest → it | The process stops and waits for something from the other pool. |
| "checks the guest's ID" | task **Check guest ID** | |
| "hands over the key card" | task **Hand over key card** | |
| "The guest is now checked in." | end event **Guest checked in** | |

## 4. Reference process

Pools:
- **Hotel** (white box), lanes: **Reservations**, **Reception**
- **Guest** (black box, no steps)

Nodes (type, name, lane):
- message start event: **Booking request received**, Reservations
- task: **Check room availability**, Reservations
- exclusive gateway: **Room available?**, Reservations
- message end event: **Request declined**, Reservations
- task: **Reserve room**, Reservations
- send task: **Send confirmation**, Reservations
- intermediate message event (catching): **Guest arrived**, Reception
- task: **Check guest ID**, Reception
- task: **Hand over key card**, Reception
- end event (none): **Guest checked in**, Reception

Sequence flows:
- Booking request received → Check room availability
- Check room availability → Room available?
- Room available? → Request declined, name **No**, condition "no room of that type is free on those dates"
- Room available? → Reserve room, name **Yes**, default flow
- Reserve room → Send confirmation
- Send confirmation → Guest arrived
- Guest arrived → Check guest ID
- Check guest ID → Hand over key card
- Hand over key card → Guest checked in

Message flows:
- Guest → Booking request received
- Request declined → Guest
- Send confirmation → Guest
- Guest → Guest arrived

Data: none.

## 5. Key decisions and alternatives

- ✱ The guest is a black box. The text says what the guest sends and receives, not how the guest decides. A white-box Guest pool with its own steps is the topic of later cases (several pools, case 6).
- ✱ The refusal is a message end event, the confirmation a send task. Rule of thumb from the course: use a message event when the step only sends or receives; if the process ends right after sending, the end event itself sends. An intermediate throwing message event **Confirmation sent** instead of the send task is equally right.
- ✱ The arrival is a catching message event. Walking up to the desk is not a letter, but in BPMN a message is anything one participant gives another (also a person showing up). A plain task **Welcome guest** with no waiting event would hide the waiting time between booking and arrival, which can be weeks.
- ✱ **Hand over key card** has no message flow to the guest. Handing over the card could be drawn as one; we keep the four message flows the text stresses (request, answer, confirmation, arrival).
- What the model does not show: a guest who never arrives (no-show). That needs an event-based gateway or a timer and is case 4's idea.
- The XOR sits in Reservations, the lane of the task before it.

## 6. AS-IS problems / TO-BE ideas

- Availability is checked by hand for every request. TO-BE: an online booking engine checks availability and confirms at once (Check room availability, Reserve room and Send confirmation become one service task).
- The guest waits at the desk while the ID is checked. TO-BE: online check-in the day before; at the desk only the key card is handed over (or a mobile key).
- No-shows block rooms. TO-BE: a deadline (timer) after which an unpaid reservation is released (see case 4).

## 7. Hints per level, synonyms

Level 1 (tagging): roles = "reservations team", "receptionist"; other participant = "guest"; messages = "sends … a booking request", "lets the guest know", "sends the guest a confirmation", "the guest arrives"; decision = "If no room is free … Otherwise".

Level 2 (complete the process, lanes and tasks given):
- What: the process starts with a message. Where: "A guest sends the hotel a booking request". Why: it comes from another pool. Answer: message start event **Booking request received** and a message flow from the Guest pool.
- What: the process waits. Where: "waits for the guest. When the guest arrives". Answer: intermediate catching message event **Guest arrived** before **Check guest ID**.
- What: lines between pools. Why: sequence flows never cross a pool border. Answer: four message flows, all ending at the border of the Guest pool.

Level 3 (from scratch): two pools first (Hotel with two lanes, Guest empty), then the hotel's steps, then the message flows.

Synonyms:
- Booking request received: Request received, Booking requested, Reservation request received
- Check room availability: Check availability, Check free rooms, Check rooms
- Room available?: Room free?, Available?
- Request declined: Booking declined, Request refused (also as task Decline request / Send refusal + end event)
- Reserve room: Book room, Block room, Create reservation
- Send confirmation: Confirm booking, Send booking confirmation (also as throwing message event Confirmation sent)
- Guest arrived: Guest at reception, Guest checked in at desk
- Check guest ID: Check ID, Verify identity, Check passport
- Hand over key card: Give key card, Hand over key, Issue key card
- Guest checked in: Check-in completed
