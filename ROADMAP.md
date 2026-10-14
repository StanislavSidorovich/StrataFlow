# StrataFlow — Roadmap

Stages follow SPEC §12. A stage is done only when its acceptance criteria pass. Each sprint entry ends with "Built with: <model> (Claude Code), effort <level>."

| Stage | Status | Acceptance |
|---|---|---|
| 0. Setup | ✅ | Repo + Vite app + CI deploy at flow.quaera.app; D1/D2 decided by a spike (done 2026-10-14) |
| 1. Editor | ⏳ next | First case's reference process drawn, saved, reloaded; undo/redo |
| 2. Interop + productivity | ⬜ | Lossless BPMN XML round-trip of every case; Bizagi file opens; our export opens in Bizagi and bpmn.io; auto layout; group into / ungroup sub-process |
| 3. Linter + Help | ⬜ | P01–P17 with tests; cases lint clean; ≥ 20 help cards; `?` everywhere |
| 4. Trainer | ⬜ | 3 cases × levels 0–3; text cues; comparator; tour; lessons |
| 5. Story | ⬜ | Story files, Present, token beats, in-app story editor, recording script |
| 6. Simulate | ⬜ | Token play; time analysis; AS-IS vs TO-BE KPIs |
| 7. AI | ⏭ optional | Behind a user-provided API key |

## Next steps (by priority)

1. **Stage 1, editor.** Start from the stage 0 viewer (`src/ui/canvas/`, `src/core/bpmn/read.ts`): store with undo/redo (StrataSQL `src/ui/store.ts`), ops in `src/core/ops.ts` with tests, palette + context pad, properties panel, `*.flow.json` save/load + autosave. Decide how nodes sit in pools/lanes (React Flow `parentId` vs absolute + lane lookup by position) at the start.
   - Small stage 0 leftovers: event label can overlap the lane header when an event sits next to it; boundary events do not move with their host yet; the bundle is 500 kB (lazy-load bpmn-moddle on Open).
2. Course material: received 2026-10-14 in `/private/course/` (gitignored); read its `README.md` first (course follows Dumas et al. 2013; Bizagi `.bpm` + `.bpmn` exports; findings and what is still missing). Turn it into SPEC §13 answers. Chapters 3–5 and the exercise 3.7 diagram added the same day (findings in that README, "Chapter 3–5 findings"; 3.7 solved in `exercises/exercise-3.7-solution.md`). Syllabus, practical assignment and Hammer (1990) added too: there is no separate style guide (Chapter 3 conventions rule); deliverables are Bizagi files, so Bizagi-openable BPMN export is a hard requirement. Chapters 6–8 (quantitative analysis, redesign, process mining) come later in the semester.
3. Write the first 3 own cases in `cases/` (see `cases/README.md`), easy → hard.

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
