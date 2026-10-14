# StrataFlow — Roadmap

Stages follow SPEC §12. A stage is done only when its acceptance criteria pass. Each sprint entry ends with "Built with: <model> (Claude Code), effort <level>."

| Stage | Status | Acceptance |
|---|---|---|
| 0. Setup | ✅ | Repo + Vite app + CI deploy at flow.quaera.app; D1/D2 decided by a spike (done 2026-10-14) |
| 1. Editor | ✅ | Reference process (pools, lanes, XOR + AND, timer and message events, boundary event, data object) drawn, saved, reloaded; undo/redo (done 2026-10-14) |
| 2. Interop + productivity | ⏳ in progress (BPMN export done, opens in Bizagi and bpmn.io) | Lossless BPMN XML round-trip of every case; Bizagi file opens; our export opens in Bizagi and bpmn.io; auto layout; group into / ungroup sub-process |
| 3. Linter + Help | ⬜ | P01–P17 with tests; cases lint clean; ≥ 20 help cards; `?` everywhere |
| 4. Trainer | ⬜ | 3 cases × levels 0–3; text cues; comparator; tour; lessons |
| 5. Story | ⬜ | Story files, Present, token beats, in-app story editor, recording script |
| 6. Simulate | ⬜ | Token play; time analysis; AS-IS vs TO-BE KPIs |
| 7. AI | ⏭ optional | Behind a user-provided API key |

## Next steps (by priority)

1. **Stage 2, interop + productivity.** Done: BPMN XML export with round-trip tests, opens in bpmn.io. **Our export opens in Bizagi as drawn** (owner's second check, 2026-10-14: both pools, one Loan slip with its line, labels in place). Cosmetic, open: Bizagi draws a wider pool header (~50 px) and lane names without a strip, so a step within ~20 px of a lane's left edge collides with the lane name there (the example's start event does); auto layout should keep a left margin. Left: auto layout (elkjs, lanes kept); group into / ungroup sub-process (SPEC §6) with tests for single and multi entry/exit. Also insert-on-flow, duplicate, align. Each future case in `cases/` gets added to `tests/bpmn-roundtrip.test.ts`.
   - Stage 1 leftovers: dragging an end of an existing flow onto another shape (the `reconnect` op exists, no UI yet); nested lanes cannot be created (they are read and kept); a node moved to another pool keeps a sequence flow that now crosses pools (the linter's P03 will catch it); event labels can overlap a lane header; bundle 480 kB (React + React Flow; bpmn-moddle already loads only on opening a .bpmn).
2. Course material: received 2026-10-14 in `/private/course/` (gitignored); read its `README.md` first (course follows Dumas et al. 2013; Bizagi `.bpm` + `.bpmn` exports; findings and what is still missing). Turn it into SPEC §13 answers. Chapters 3–5 and the exercise 3.7 diagram added the same day (findings in that README, "Chapter 3–5 findings"; 3.7 solved in `exercises/exercise-3.7-solution.md`). Syllabus, practical assignment and Hammer (1990) added too: there is no separate style guide (Chapter 3 conventions rule); deliverables are Bizagi files, so Bizagi-openable BPMN export is a hard requirement. Chapters 6–8 (quantitative analysis, redesign, process mining) come later in the semester.
3. Write the first 3 own cases (the stage 1 acceptance test draws the planned case 3, Online shop, through the ops: reuse it) in `cases/` (see `cases/README.md`), easy → hard.

## Ideas backlog (owner, 2026-10-14)

- Generate processes on request: Claude writes `*.flow.json` / `*.flow-case.json` / `*.flow-story.json`, the app opens them (as in StrataSQL). In-app generation with an API key = stage 7.
- Text tasks with highlighted key words (what is a task, which gateway, which event, which flow).
- Theory part (help cards + Learn lessons) and an intro/tour on how to use the app.
- Format conversion (BPMN XML; Bizagi `.bpm` only if cheap; PNG/SVG; later a documentation export).
- One click: a full process skeleton from start to end (template + auto layout).
- **Select several tasks → turn them into a sub-process** (Bizagi cannot; there you cut, create, paste and reconnect).
- Story recording: step-by-step highlighting of objects, drawing flows, comments; for presenting a group project and for videos.
- Learn from the best similar products (UI and features): see `docs/research.md`.

## Decisions

- 2026-10-14 ✱ Name **StrataFlow**, subdomain **flow.quaera.app**, public repo github.com/StanislavSidorovich/StrataFlow (owner's choice).
- 2026-10-14 ✱ Same stack and architecture as StrataSQL (pure TS core + React Flow canvas). D1 (React Flow vs bpmn-js) and D2 (bpmn-moddle vs own XML) to be confirmed in stage 0.
- 2026-10-14 ✱ BPMN XML is the interchange format with Bizagi; native `.bpm` is optional.
- 2026-10-14 ✱ Case domains mirror StrataSQL's (Library, Hotel, Online Shop, Hospital, Scooter Sharing, Football) so a student can see the data model and the process of the same business; later they can be linked.
- 2026-10-14 ✱ Modeling conventions = NOVA BPM Chapter 3 (Dumas et al. 2013) and the 7PMG from Chapter 4; Silver's Method and Style only where the course is silent. Chapter 5 (VA/BVA/NVA, waste, issue register) is a later analysis feature, not stage 1–3.
- 2026-10-14 ✱ **D1 = React Flow** (spike passed: pools, lanes, tasks with markers, events, gateways, data, sequence/message/data flows along DI waypoints, orthogonal routing after a move; real Bizagi exports look as in Bizagi). bpmn-js stays rejected (watermark, harder overlays).
- 2026-10-14 ✱ **D2 = bpmn-moddle 10** (MIT, plain licence without the bpmn.io watermark clause, parser only) for reading; our own mapping to FlowModel. Bizagi quirks handled: an empty "Main Process" pool in every file; lane x is relative to the pool (x = header width), y absolute. Writing BPMN: decide in stage 2 (moddle `toXML` likely).
- 2026-10-14 ✱ Brand icon: teal `#0d9488` mark (start event → task → gateway), SVG only for now; PNG icons for install later.
- 2026-10-14 ✱ Own cases only in the public repo; course cases only with the professor's permission; the graded group project never before grading.

- 2026-10-14 ✱ **Node placement: absolute coordinates** (as BPMN DI) and pool / lane / sub-process looked up from the shape's centre after every add or move (`place()` in `core/ops.ts`), not React Flow `parentId`. A pool move takes its lanes and nodes; a task move takes its boundary events; a sub-process move takes its content.
- 2026-10-14 ✱ The flow kind is chosen by the editor from its ends: annotation → association, data → data association, different pools (or a pool) → message flow, else sequence flow. The student draws "a line"; the linter later explains.
- 2026-10-14 ✱ Deleting a lane gives its room and its steps to the lane above (the one below for the first lane), so nothing on the canvas moves. Appending past a pool's end widens the pool.
- 2026-10-14 ✱ First visit opens the Library example (from `library-loan.flow.json`); later visits reopen what was there (localStorage). New and Open are undoable.

- 2026-10-14 ✱ **BPMN writer = bpmn-moddle `toXML`**, mapping in `core/bpmn/write.ts` mirrors the reader. A pool with steps gets a process named after it; lanes list every flow node in them, also inside sub-processes; data and annotations get their pool and lane from where they sit (BPMN has no lane for them); flows without stored waypoints are routed as the canvas draws them; a collapsed sub-process's content goes in a diagram of its own (as bpmn.io). "Lossless" = read(write(m)) equals m up to list order, plus waypoints for flows that had none; a second trip changes nothing.
- 2026-10-14 ✱ **An empty pool is a black box.** Every exported pool gets a process (Bizagi drops a pool without one); a process without steps reads back as a black box. Bizagi's empty "Main Process" pool is dropped only in Bizagi files. A start event stores `interrupting` only when false.
- 2026-10-14 ✱ **Export for Bizagi and bpmn.io at once** (after the owner's first Bizagi check): the drawing moves so the leftmost pool sits at x = 0 (Bizagi reads lane x relative to the pool, bpmn.io absolute; at 0 they agree; pools with other x still show shifted lanes in Bizagi); data objects only as DataObjectReference (Bizagi drew the bare DataObject a second time); each data association also written as a plain association along the same line (that is what Bizagi draws); label bounds where the canvas shows them. The reader reads Bizagi's bare drawn DataObject and merges its association with the data association.

## Sprints

### 2026-10-14 · Handoff from StrataSQL
Project folder, CLAUDE.md, SPEC v0.1, ROADMAP, lessons from StrataSQL, design notes, research list, case plan, licenses. Repo created. No code yet.
Built with: Claude Opus 5.5 (Claude Code), effort low.

### 2026-10-14 · Course chapters 3–5
Chapters 3–5, exercise 3.7, syllabus, assignment and Hammer (1990) copied to `/private/course/`, conventions extracted for SPEC §13, exercise 3.7 solved (cross-pool deadlock, event-based gateway fix). No code yet.
Built with: Claude Opus 5.5 (Claude Code), effort low.

### 2026-10-14 · Stage 0: app, D1/D2 spikes, deploy
Vite app copied from StrataSQL's setup (PWA plugin, Pages workflow, port 5174). Draft metamodel, BPMN reader on bpmn-moddle, BPMN shapes on React Flow; a read-only viewer opens a sample and any `.bpmn` (the owner's 6 Bizagi exports pass local tests). 13 tests. Pages enabled (workflow), Cloudflare CNAME `flow` (DNS only), cert approved, HTTPS enforced: live at https://flow.quaera.app. The cert stayed pending ~15 min until the custom domain was cleared and set again.
Built with: Claude Opus 5.5 (Claude Code), effort low.

### 2026-10-14 · Stage 1: editor
Edit ops in `core/ops.ts` (add, append, boundary event, pool, lane, connect with automatic flow kind, reconnect, reverse, move with followers, resize pool / lane / shape, rename, update and convert type, default flow, delete with cascade) and `*.flow.json` read/write with reference checks. Store with undo/redo, typing coalesced, autosave (StrataSQL pattern). UI: floating draw bar with keys, context pad (append task / XOR / AND / event / end, boundary event, delete), Properties panel per element, flows routed between facing sides, connection dots, resizers, New / Open (.flow.json or .bpmn) / Save / Save as / Example. Acceptance test draws an order-fulfilment process with every stage-1 element, saves, reloads, undoes. 43 tests. Checked in the browser with Playwright (draw, connect, message flow to a pool, boundary event follows its task, undo/redo, reload, save).
Built with: Claude Opus 5.5 (Claude Code), effort low.

### 2026-10-14 · Stage 2a: BPMN XML export
`writeBpmn` (bpmn-moddle `toXML` with DI: collaboration, processes, nested lane sets with flowNodeRef, every task / gateway / event kind, sub-processes expanded and collapsed, data objects with state, data stores, annotations, sequence / message / data / association flows, conditions, default flows, incoming / outgoing). Reader made lossless (empty pools, start-event interrupting, all diagrams, artifacts placed by geometry). Round-trip tests: order fulfilment, the example (.flow.json and the Bizagi-shaped .bpmn), every element type, pools with nested lanes, and the owner's 6 Bizagi exports locally. Fixed: appending a step inside an expanded sub-process pushed it out. Export BPMN button. Checked in the browser: the exported example opens in demo.bpmn.io with every shape and flow. 58 tests.
Built with: Claude Opus 5.5 (Claude Code), effort low.

### 2026-10-14 · Stage 2b: export fixed after the first Bizagi check
The owner opened the export in Bizagi: the black-box pool was missing, Loan slip was drawn twice and lost its line, the pool header doubled, labels overlapped. Fixed (see Decisions): a process for every pool, data as references plus a plain association line, drawing moved to x = 0, label bounds. The reader now keeps the data objects of real Bizagi files (it dropped them before) and merges their association with the data association. Tests for each rule; the owner's 6 Bizagi files still round-trip. Checked: the new export opens in demo.bpmn.io as drawn. 62 tests.
Built with: Claude Opus 5.5 (Claude Code), effort low.
