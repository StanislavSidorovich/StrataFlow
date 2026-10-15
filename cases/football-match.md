# Football: match day

## 1. Meta

- id: `football-match`
- title: Football: match day
- difficulty: ★★★ (case 6 of the ladder)
- concepts trained: three pools (the club's process and two black boxes), an error end event inside a sub-process caught by an error boundary event on its border, multi-instance activities (parallel: one per player at once; sequential: one per coach, one after another); repeated: a collapsed sub-process with its page, a message start event, a message end event with two message flows, AND split and join, three lanes
- reference model: `football-match.flow.json` (laid out by Auto layout, lints clean, round-trips through BPMN XML); drawn by `drawFootball` in `tests/fixtures/cases.ts`
- domain link: StrataSQL's Football case (clubs, players, matches, officials)

## 2. Case text

> Match day at a football club starts when the league confirms the fixture. First the security team prepares the stadium. Preparing works like this: the team inspects the stands. If a stand is unsafe, the preparation stops with an error. Otherwise the team sets up the gates, and the stadium is ready.
>
> If the stadium is unsafe, the match office calls off the match and tells the league and the visiting club. Otherwise the match office checks the registration of every player in the squad in the league's online system: one check per player, all at the same time. Then security opens the gates and the club hosts the match. After the match, the press office holds a press conference with each coach, one after the other. Meanwhile the match office sends the result to the league. When both are done, match day is closed.
>
> We model the home club's process. The league and the visiting club are outside it: we only see the messages they send and receive.

## 3. Text → model mapping

| Phrase | Element | Why |
|---|---|---|
| "a football club" / "the home club's process" | pool **Home club** (white box) | The organisation whose process we model. |
| "the league confirms the fixture" | message start event **Fixture confirmed** + message flow League → it | A message from another participant starts the process. |
| "the league" | pool **League** (black box) | Another participant; we see only its messages. |
| "the security team" | lane **Security** | A role. |
| "prepares the stadium" + "Preparing works like this" | collapsed sub-process **Prepare stadium** | Told step by step: a sub-process with its own page. |
| "inspects the stands" | manual task **Inspect stands** (page) | |
| "If a stand is unsafe" | XOR **Stands safe?**, branches **No** / **Yes** (default) (page) | |
| "the preparation stops with an error" | error end event **Stand unsafe** (page) | The sub-process ends abnormally and throws an error to the level above. |
| "sets up the gates" | manual task **Set up gates** (page) | |
| "the stadium is ready" | end event **Stadium ready** (page) | The normal end of the sub-process. |
| "If the stadium is unsafe" | error boundary event **Stadium unsafe** on Prepare stadium | It catches the error thrown inside: the sub-process stops and the process takes the exception path. |
| "the match office" | lane **Match office** | |
| "calls off the match" | user task **Call off match** | |
| "tells the league and the visiting club" | message end event **Match called off** + message flows to League and to Visiting club | One event may send to several participants. |
| "the visiting club" | pool **Visiting club** (black box) | A third participant. |
| "checks the registration of every player" + "one check per player, all at the same time" | service task **Check player registration**, multi-instance parallel (three vertical bars) | One task, done once for each player, all at once; the online system does it: a service task. |
| "security opens the gates" | manual task **Open gates** | |
| "the club hosts the match" | task **Host match** | |
| "the press office" | lane **Press office** | |
| "holds a press conference with each coach, one after the other" | manual task **Hold press conference**, multi-instance sequential (three horizontal bars) | Once for each coach, one after another. |
| "Meanwhile" | AND split after Host match | Both ways run at the same time. |
| "sends the result to the league" | send task **Send result** + message flow to League | |
| "When both are done" | AND join | |
| "match day is closed" | end event **Match day closed** | |

## 4. Reference process

Pools:
- **Home club** (white box), lanes: **Match office**, **Security**, **Press office**
- **League** (black box, no steps)
- **Visiting club** (black box, no steps)

Nodes (type, name, lane), main diagram:
- message start event: **Fixture confirmed**, Match office
- collapsed sub-process: **Prepare stadium**, Security
- error boundary event (interrupting): **Stadium unsafe**, on Prepare stadium
- user task: **Call off match**, Match office
- message end event: **Match called off**, Match office
- service task, multi-instance parallel: **Check player registration**, Match office
- manual task: **Open gates**, Security
- task: **Host match**, Match office
- parallel gateway (split), Match office
- manual task, multi-instance sequential: **Hold press conference**, Press office
- send task: **Send result**, Match office
- parallel gateway (join), Match office
- end event: **Match day closed**, Match office

Page of **Prepare stadium** (Security):
- start event (no name)
- manual task: **Inspect stands**
- exclusive gateway: **Stands safe?**
- error end event: **Stand unsafe**
- manual task: **Set up gates**
- end event: **Stadium ready**

Sequence flows:
- Fixture confirmed → Prepare stadium → Check player registration → Open gates → Host match → AND split
- AND split → Hold press conference → AND join; AND split → Send result → AND join; AND join → Match day closed
- Stadium unsafe (boundary) → Call off match → Match called off
- Page: start → Inspect stands → Stands safe?; Stands safe? → Stand unsafe, name **No**, condition "a stand is unsafe"; Stands safe? → Set up gates, name **Yes**, default flow; Set up gates → Stadium ready

Message flows:
- League → Fixture confirmed
- Match called off → League
- Match called off → Visiting club
- Send result → League

## 5. Key decisions and alternatives

- ✱ **Error end + error boundary event** for "stops with an error … If the stadium is unsafe": the sub-process ends with an error end event; the error boundary event on its border catches it, the sub-process stops and the exception path starts (always interrupting). The course has error events at the end and on the boundary. An XOR after the sub-process ("Stadium safe?") is also correct but repeats the decision made inside; the error shows that this is an exception, not a normal outcome.
- ✱ **Escalation events are not used.** The course lists them only in the overview; an escalation (a non-interrupting "tell the manager" from inside a sub-process) would be the same shape with a dashed border. The case keeps error only.
- ✱ **Multi-instance, parallel** for "every player … one check per player, all at the same time": one task with three vertical bars instead of a task per player (the number of players is not fixed). **Multi-instance, sequential** for "with each coach, one after the other": three horizontal bars. A **loop** marker (circular arrow) would mean "again while a condition holds", which the text does not say.
- ✱ The registration check runs in the league's online system: a service task in the Match office lane, no message flows per player (the system is not a participant that decides anything). With message flows, the league would be asked once per player.
- ✱ Two black-box pools, **League** and **Visiting club**: both are outside participants we know only by their messages. **Match called off** sends to both: one message end event with two message flows.
- ✱ The registrations are checked only once the stadium is ready, so that a called-off match ends the process cleanly. Run in parallel with the stadium, the error would leave the other branch waiting at the AND join; that needs the two inside one more sub-process with the error boundary on it (a level more than the case needs).

## 6. AS-IS problems / TO-BE ideas

- The stands are inspected on match day, so a problem calls off the match with no time to fix it. TO-BE: inspect the day before (a timer start event: "1 day before kick-off") and fix what is found.
- Player registrations are checked only after the stadium: a missing registration is found late. TO-BE: check them as soon as the fixture is confirmed, in parallel with the preparation, inside one sub-process "Get ready" with the error boundary on it.
- The press conferences hold the press office for long. TO-BE: hold both coaches' statements at once (multi-instance parallel), or one joint conference (no marker).

## 7. Hints per level, synonyms

Level 1 (tagging): other participants = "the league", "the visiting club"; roles = "the security team", "the match office", "the press office"; error = "stops with an error", "If the stadium is unsafe"; repeats = "one check per player, all at the same time", "with each coach, one after the other"; parallel = "Meanwhile", "When both are done"; messages = "the league confirms the fixture", "tells the league and the visiting club", "sends the result to the league".

Level 2 (complete the process, lanes and tasks given):
- What: an exception. Where: "the preparation stops with an error". Why: the sub-process cannot finish normally. Answer: an error end event **Stand unsafe** on the page of **Prepare stadium**, and an error boundary event **Stadium unsafe** on its border leading to **Call off match**.
- What: a task done once per item. Where: "one check per player, all at the same time". Answer: **Check player registration** with the parallel multi-instance marker (Properties → Repeats).
- What: one after another. Where: "with each coach, one after the other". Answer: **Hold press conference** with the sequential multi-instance marker.

Level 3 (from scratch): the three pools and the lanes; the happy path (fixture, stadium, registrations, gates, match, press and result, closed); the page of Prepare stadium; then the error and the call-off; then the markers and the messages.

Synonyms:
- Home club: Football club, Club, Home team
- League: Football league, Federation
- Visiting club: Away club, Visiting team, Away team
- Match office: Club office, Operations, Match operations
- Security: Security team, Stadium security
- Press office: Media office, Press, Communications
- Fixture confirmed: Fixture received, Match confirmed
- Prepare stadium: Stadium preparation, Get stadium ready
- Inspect stands: Check stands, Inspect stadium
- Stands safe?: Stand safe?, Stadium safe?
- Stand unsafe: Unsafe stand, Stadium not safe
- Set up gates: Prepare gates
- Stadium ready: Stadium prepared
- Stadium unsafe: Unsafe stadium, Error unsafe
- Call off match: Cancel match, Postpone match
- Match called off: Match cancelled, Cancellation sent
- Check player registration: Check registrations, Verify player registration, Check players
- Open gates: Open stadium
- Host match: Play match, Hold match
- Hold press conference: Press conference, Hold press conferences
- Send result: Report result, Send match result
- Match day closed: Match day over, Match day ended
