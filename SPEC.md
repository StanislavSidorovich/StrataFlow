# StrataFlow — Specification

> A modern, browser-based **BPMN 2.0 process modeling** tool with a built-in trainer, contextual help and story mode.
> Positioned as a lightweight, learnable companion to Bizagi Modeler for students and small teams. Sister app of StrataSQL (data modeling).

Status: draft v0.1 (2026-10-14). Owner: Stanislav Sidorovich. Everything here may change in the first sessions; changes are recorded in ROADMAP "Decisions".

---

## 1. Why

- Bizagi Modeler is the course tool (NOVA IMS, Business Process Management 2026/27). It is free but Windows-heavy, and it gives no guidance on *how* to model: why a gateway, which event, when a pool and when a lane.
- Daily friction in Bizagi: turning several selected tasks into a sub-process means cut → new sub-process → paste → reconnect by hand. Layout is manual.
- Students get stuck on the same things: **XOR vs AND vs OR gateways, split/join pairs, events (timer, message, boundary), pools vs lanes, sequence vs message flow, sub-processes, exceptions**, and on turning a text description into a process.
- StrataFlow lets you (1) model for real, (2) get instant feedback from a linter that explains BPMN rules, (3) learn through cases with text tagging, walkthroughs and hints, (4) present a process step by step (story mode) and record it as a video.

**Non-goal:** replacing Bizagi for course submission. Deliverables are still produced where the course requires; StrataFlow exports BPMN 2.0 XML that Bizagi (and Camunda, bpmn.io) can open.

## 2. Users

| User | Needs |
|---|---|
| Student learning BPMN | Guided cases, hints, help card per element with a mini-diagram, linter that explains |
| Student group | A shared, readable process to discuss; story mode to present AS-IS / TO-BE; share by link/file |
| Analyst / PMO | Fast process sketch from text, one-click layout, sub-process grouping, export to BPMN XML / PNG |

## 3. Product modes

1. **Editor**: free modeling on a canvas, properties panel, linter dock, BPMN XML / image export.
2. **Help**: one card per concept (definition, mini-diagram, when to use, text signals, typical mistake). Opened from `?` next to any property, from linter issues, and from a glossary.
3. **Trainer**: cases with levels (see §9), lessons (Learn), "My task" (own text).
4. **Story**: a process told beat by beat for presenting and recording (see §10.1).
5. **Simulate** (later): token play-through, then time/resource analysis for AS-IS vs TO-BE.

## 4. Scope

### MVP (stages 1–3)
- Editor: pools, lanes (nested), tasks (with type markers), sub-processes (collapsed / expanded), start / intermediate / end / boundary events (none, message, timer, error, signal, conditional, terminate), gateways (exclusive, parallel, inclusive, event-based), sequence flows (conditions, default), message flows, data objects, data stores, text annotations, groups.
- **Group into sub-process** (select → one click) and **Ungroup** (inline it back). See §6.
- **Auto layout** (one click, left-to-right, lanes kept).
- BPMN 2.0 XML import/export with diagram interchange (DI); `*.flow.json` save/load, autosave, undo/redo.
- Linter (§7) + help cards (§8).

### Later
- Trainer levels 0–3 + lessons (stage 4), story mode + recording (stage 5), token simulation and time analysis (stage 6), AI review / generation behind a user's own API key (stage 7).
- Bizagi native `.bpm` import (only if cheap; BPMN XML exported from Bizagi is the main path).
- Process documentation export (HTML/PDF, like Bizagi's Word export).
- Link a process to a StrataSQL data model (data objects ↔ entities) for the same case domain.

### Explicitly out of scope
- Process execution engine, forms, BPM server, DMN / CMMN, real-time collaboration, accounts.

## 5. Metamodel (what a process model contains)

Semantic model and layout are kept apart, like BPMN's model vs DI:

```
FlowModel
 ├─ Participant (pool)   name, processRef, blackBox?           (a black-box pool has no inner flow)
 │   └─ Lane             name, children: Lane[]                 (nested lanes allowed)
 ├─ Process              id, nodes[], flows[]
 │   ├─ Task             name, kind: task|user|service|manual|send|receive|script|businessRule,
 │   │                   loop?: standard|parallelMI|sequentialMI, laneId
 │   ├─ SubProcess       name, collapsed, eventSub?, nodes[], flows[], laneId   (nested process)
 │   ├─ Event            position: start|intermediate|end|boundary,
 │   │                   trigger: none|message|timer|error|signal|conditional|escalation|terminate|link,
 │   │                   catching|throwing, interrupting (boundary/event sub), attachedTo?, laneId
 │   ├─ Gateway          kind: exclusive|parallel|inclusive|eventBased|complex, defaultFlow?, laneId
 │   └─ SequenceFlow     source, target, name, condition?
 ├─ MessageFlow          source, target (nodes or pools of DIFFERENT participants), name
 ├─ DataObject / DataStore  name, state?;  DataAssociation  node ↔ data
 ├─ TextAnnotation + Association;  Group (visual only)
 └─ Diagram              shape bounds per element (+ isExpanded, isHorizontal), edge waypoints
```

Rules of the metamodel:
- Sequence flows stay inside one process (one pool, one sub-process level). Across pools only message flows.
- A boundary event belongs to its activity; it moves with it.
- A collapsed and an expanded sub-process are the same object with a different `collapsed` flag (and different DI).
- Element ids are stable (`Task_1` style) so BPMN XML round-trips keep them.

## 6. Edit operations (each is a pure function in `src/core/ops.ts`, tested)

| Operation | Behaviour |
|---|---|
| Add / delete / reconnect | Deleting a node deletes its flows; deleting a pool deletes its process; deleting a lane moves its nodes to the parent lane |
| **Group into sub-process** | Selection must be in one process level. Incoming flows from outside → subprocess; inside, a start event connects to the former entry node(s); exit node(s) → end event; outgoing flows leave the sub-process. Several entries/exits: warn and offer (a) entry/exit gateways inside, (b) cancel. Message flows to inner nodes stay attached to the inner nodes (expanded) or move to the sub-process border (collapsed). The sub-process lands in the lane holding most selected nodes. Data associations follow their nodes |
| **Ungroup sub-process** | Inverse: inner nodes return to the parent level, inner start/end events removed when they are "none" events, flows reconnected |
| Collapse / expand | Same object; expanded shows children in place, collapsed shows a `+` marker and drill-down |
| Auto layout | Layered left-to-right layout per pool, lanes as bands, gateways aligned, crossings minimised (elkjs) |
| Convert type | Task ↔ sub-process, gateway kind, event trigger; flows kept |
| Insert on flow | Drop a node on a sequence flow splits it |
| Duplicate, align, distribute | As in StrataSQL |

## 7. Linter (model checks)

Each issue links to a help card and highlights elements. Severity: error = invalid BPMN, warning = likely mistake, info = style hint. A warning is a question, not a verdict.

| ID | Check | Severity |
|---|---|---|
| P01 | Process without a start event / without an end event (top level of a pool) | warning |
| P02 | Node not reachable from a start event, or no path to an end event | error |
| P03 | Sequence flow crosses a pool border (must be a message flow) | error |
| P04 | Message flow inside one pool | error |
| P05 | Gateway that both splits and joins (mixed gateway) | warning |
| P06 | Exclusive / inclusive split whose outgoing flows have no names / conditions, and no default | warning |
| P07 | Split and join of different kinds (AND split closed by XOR join: duplicate tokens; XOR split closed by AND join: deadlock) | warning |
| P08 | Activity with several incoming sequence flows and no join gateway (implicit merge) | info |
| P09 | Activity name not "verb + object" (e.g. "Invoice", "Approval") | info |
| P10 | Event-based gateway followed by something other than catching events / receive tasks | error |
| P11 | Boundary event without an outgoing flow | error |
| P12 | Start event with incoming flow, end event with outgoing flow | error |
| P13 | More than ~30 nodes on one level → suggest sub-processes (7PMG) | info |
| P14 | Duplicate names (two tasks or two end events with the same name) | warning |
| P15 | Empty lane / pool with flow but no lanes when roles are named in the case | info |
| P16 | Unlabeled end events when there are several (end states should be named) | info |
| P17 | Loop without an exit (cycle with no XOR/event leaving it) | warning |
| P18 | A pool always waits for a message the other pool sends only on some paths (course Ch. 3 racing events, exercise 3.7): needs an event-based gateway | warning |

## 8. Help cards

Fields: `id, title, oneLiner, whenToUse (text signals), miniModel (tiny flow JSON rendered as diagram), typicalMistake, seeAlso[], caseRefs[]`.

Initial set: process, pool, lane, task (and types), sub-process, call activity, start / end / intermediate events, timer, message, error, boundary event (interrupting vs not), exclusive / parallel / inclusive / event-based gateway, split vs join, default flow, sequence vs message flow, data object / store, annotation, loop and multi-instance, AS-IS vs TO-BE, happy path vs exceptions, black-box pool.

## 9. Trainer (stage 4)

Pedagogy as in StrataSQL: worked example → completion → faded scaffolding → independent problem.

| Level | Task | Feedback |
|---|---|---|
| 0 — Worked example | Case text with the reference process; text spans linked to elements | — |
| 1 — Text tagging | Click words, tag as role (lane), activity, event, decision (XOR), parallel (AND), data, message, rule | Immediate per tag; model veiled until all tagged (Peek) |
| 2 — Complete the process | Lanes and tasks given; add gateways, events, flows | Hint ladder: what → where (phrase marked) → why → answer |
| 3 — From scratch | Build the whole process | Comparison with the reference + linter |
| 4 — Own task | "My task": own text, self-tagging, coverage check | Cue questions |

**Text cues** (highlighted on request): `if / otherwise / in case / depending on / either…or` → XOR; `at the same time / meanwhile / in parallel / both / while` → AND; `one or more / any of` → OR; `every Monday / after 2 days / by Friday / deadline` → timer; `sends / notifies / e-mails` → message throw; `receives / waits for` → message catch; `until / again / repeat / resubmit` → loop; role nouns (`the clerk`, `the manager`) → lanes; verb + object → task.

**Comparison with the reference (level 3)**: match activities by name similarity (stems, synonyms from the case file), lanes by role names; then compare order relations between matched activities (A before B, A in parallel with B, A exclusive with B, a "behavioural profile"), gateway kinds, events and their triggers, message flows between pools. Layout and exact gateway count do not matter (an equivalent structure counts as right). Output: matched / missing / extra / different, each with a hint from the case file.

## 10. Case file format

Cases live in `cases/<id>.md` (human source) and `src/data/examples/<id>.ts` (machine form). Sections: meta (id, title, difficulty, concepts), case text (verbatim), text → model mapping (phrase → element, why), reference process, key decisions and alternatives, AS-IS problems / TO-BE ideas (where relevant), hints per level, synonyms.

Claude can generate files the app opens with File → Open:
- `*.flow.json`: a model (`format: "strata-flow"`).
- `*.flow-case.json`: a case with text, tagged phrases and reference (opens its walkthrough).
- `*.flow-story.json`: a story (§10.1).

### 10.1 Story files (`*.flow-story.json`)

Same idea as StrataSQL's `*.strata-story.json` (SPEC §10.1 there): beats name elements, never ids.

```json
{
  "format": "flow-story", "version": 1,
  "title": "Book loan: the process in 8 steps",
  "model": { "...": "a strata-flow model; leave it out to tell the story over the open model" },
  "beats": [
    { "title": "A member asks for a book", "show": ["Loan requested"], "quote": "A member asks at the desk for a book", "text": "A **message** start event." },
    { "title": "The librarian checks the card", "show": ["Check membership"], "flows": ["Card details"], "focus": "Check membership" },
    { "title": "Follow one report", "token": ["Loan requested", "Check membership", "Member valid?"] },
    { "title": "Not in the model yet", "ghosts": [{ "name": "Return reminder", "kind": "timer", "links": ["Lend book"] }] },
    { "title": "The whole process", "overview": true }
  ]
}
```

`show`, `flows` (held back until this beat), `focus`, `quote`, `text` (`**bold**`, `*italic*`, `` `code` ``), `ghosts` (dashed, never enter the model), `token` (animate a token along the named path), `overview`. Present mode = full screen, ← → / Space; videos recorded by a Playwright script.

## 11. Tech stack

- **React + TypeScript + Vite**, **Zustand** (+ immer) for the store and undo/redo, Tailwind CSS, lucide-react icons, Vitest. Same as StrataSQL.
- **Canvas**: @xyflow/react (React Flow) with custom BPMN node and edge types (orthogonal edges), as in StrataSQL. Rejected default: bpmn-js (full BPMN editor, but its license requires the bpmn.io watermark to stay visible, and teaching overlays, tagging and story mode are harder to fit). Re-check in stage 0 (decision D1).
- **BPMN XML**: bpmn-moddle (MIT, from bpmn.io; the parser only, no watermark) or an own reader/writer. Decide in stage 0 (D2).
- **Layout**: elkjs (layered algorithm) behind a pure function `layout(model) → Diagram`.
- **Core engine as pure TS** in `src/core/`: metamodel, ops, linter, comparator, BPMN XML I/O, story frames, layout adapter.
- Deploy: GitHub Pages (static), PWA (offline). No backend.

```
src/
  core/        metamodel.ts, ops.ts (incl. groupIntoSubprocess), lint.ts, compare.ts, bpmn/ (read, write), layout.ts, story.ts
  ui/          canvas/ (nodes, edges, palette), panels/, help/, trainer/, story/, onboarding/
  data/        help cards, cases, lessons, text cues
cases/         *.md source cases
tests/         core unit tests
```

## 12. Milestones & acceptance criteria

| Stage | Done when |
|---|---|
| 0. Setup | Repo + Vite app + CI deploy to Pages at flow.quaera.app; D1/D2 decided by a spike (BPMN shapes on React Flow, a Bizagi-exported `.bpmn` parsed) |
| 1. Editor | The reference process of the first case (pools, lanes, XOR + AND split/join, timer and message events, a boundary event, a data object) can be drawn, saved, reloaded; undo/redo |
| 2. Interop + productivity | BPMN XML round-trip of every case is lossless (tests); a file exported from Bizagi opens; our export opens in Bizagi (owner checks) and in bpmn.io; auto layout; group into / ungroup sub-process with tests for single and multi entry/exit |
| 3. Linter + Help | P01–P17 with tests; reference cases lint clean; ≥ 20 help cards; `?` on every property |
| 4. Trainer | 3 cases × levels 0–3; text cues; comparator right on references and seeded wrong models; welcome tour; lessons |
| 5. Story | `*.flow-story.json` opens, Present mode, token beats; in-app story editor; recording script makes an MP4 |
| 6. Simulate | Token play-through; time analysis (durations, probabilities, resources) → cycle time and waiting time; AS-IS vs TO-BE comparison |
| 7. AI | Optional, behind a user-provided API key: generate a process from text, review a student's model |

## 13. Open questions

- Course conventions: which BPMN subset and style rules does the BPM course use? (Owner to share slides / a Bizagi example.)
- Horizontal pools only (Bizagi default) or also vertical? (default: horizontal only)
- Show Bizagi-like look (colours, fonts) or a neutral BPMN look? (default: neutral, StrataSQL style)
- Language: English UI; Portuguese only on a real request (as in StrataSQL).
