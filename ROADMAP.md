# StrataFlow — Roadmap

Stages follow SPEC §12. A stage is done only when its acceptance criteria pass. Each sprint entry ends with "Built with: <model> (Claude Code), effort <level>."

| Stage | Status | Acceptance |
|---|---|---|
| 0. Setup | ⏳ next | Repo + Vite app + CI deploy at flow.quaera.app; D1/D2 decided by a spike |
| 1. Editor | ⬜ | First case's reference process drawn, saved, reloaded; undo/redo |
| 2. Interop + productivity | ⬜ | Lossless BPMN XML round-trip of every case; Bizagi file opens; our export opens in Bizagi and bpmn.io; auto layout; group into / ungroup sub-process |
| 3. Linter + Help | ⬜ | P01–P17 with tests; cases lint clean; ≥ 20 help cards; `?` everywhere |
| 4. Trainer | ⬜ | 3 cases × levels 0–3; text cues; comparator; tour; lessons |
| 5. Story | ⬜ | Story files, Present, token beats, in-app story editor, recording script |
| 6. Simulate | ⬜ | Token play; time analysis; AS-IS vs TO-BE KPIs |
| 7. AI | ⏭ optional | Behind a user-provided API key |

## Next steps (by priority)

1. **Stage 0, first session.**
   - Read `CLAUDE.md`, `SPEC.md`, `docs/lessons-from-stratasql.md`, `docs/design.md`, `docs/research.md`.
   - Scaffold the app by copying StrataSQL's setup (package.json deps, vite.config.ts incl. the PWA precache plugin, tsconfig, `.github/workflows/deploy.yml`, `.claude/launch.json` with dev on port **5174** so it does not clash with StrataSQL's 5173). No StrataSQL domain code.
   - Spike D1: one pool with two lanes, a task, an XOR gateway, a timer event and orthogonal flows on React Flow. Spike D2: parse a `.bpmn` (BPMN 2.0 XML with DI) with bpmn-moddle; check its license file.
   - Pages: enable (build_type=workflow), add custom domain `flow.quaera.app` via `gh api`; the owner adds the Cloudflare CNAME `flow → stanislavsidorovich.github.io` (DNS only) by hand; then enforce HTTPS.
2. Course material: received 2026-10-14 in `/private/course/` (gitignored); read its `README.md` first (course follows Dumas et al. 2013; Bizagi `.bpm` + `.bpmn` exports; findings and what is still missing). Turn it into SPEC §13 answers. Chapters 3–5 and the exercise 3.7 diagram added the same day (findings in that README, "Chapter 3–5 findings"; 3.7 solved in `exercises/exercise-3.7-solution.md`). Still to ask the owner: the professor's style rules / grading criteria.
3. Write the first 3 own cases in `cases/` (see `cases/README.md`), easy → hard.
4. Stage 1.

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
- 2026-10-14 ✱ Own cases only in the public repo; course cases only with the professor's permission; the graded group project never before grading.

## Sprints

### 2026-10-14 · Handoff from StrataSQL
Project folder, CLAUDE.md, SPEC v0.1, ROADMAP, lessons from StrataSQL, design notes, research list, case plan, licenses. Repo created. No code yet.
Built with: Claude Opus 5.5 (Claude Code), effort low.

### 2026-10-14 · Course chapters 3–5
Chapters 3–5 and exercise 3.7 copied to `/private/course/`, conventions extracted for SPEC §13, exercise 3.7 solved (cross-pool deadlock, event-based gateway fix). No code yet.
Built with: Claude Opus 5.5 (Claude Code), effort low.
