# Lessons from StrataSQL

StrataSQL (https://model.quaera.app, repo github.com/StanislavSidorovich/StrataSQL, local `../../4. dbms (2)/StrataSQL`) was built in about two weeks (2026-10-02 → 10-14, ~540 tests, v0.10). This file is what to reuse and what to avoid. When in doubt, open the StrataSQL file named here and copy the pattern.

## How we work

- **Spec → stages → acceptance criteria → tests.** SPEC.md is the contract; ROADMAP.md is the checklist and the place for decisions. Start each session from ROADMAP "Next steps".
- **Pure core.** `src/core/` has no React. Every rule gets a Vitest test. Cases are the regression suite (reference models must pass every check).
- **(?) points**: Claude decides what is clearest for students, marks ✱, records it in ROADMAP "Decisions". No need to ask.
- **Data before features.** After launch: Cloudflare Web Analytics beacon (only on the production hostname), a Google Form for feedback (Help → Send feedback), one observed session with a classmate. Don't keep adding features nobody asked for.
- **Wrap-up**: "комит, пуш, память, роадмап". Tag after big work (v0.x.0). "Built with" line per sprint.
- Owner's leftovers "for a new chat": if the context is fine, ask or just do them here.
- Mistakes in feedback are framed as guidance, not blame: an unfinished element is "not done yet", not "wrong". A linter warning is a question.

## Architecture worth copying (StrataSQL paths)

| What | Where in StrataSQL | Notes |
|---|---|---|
| Store with undo/redo | `src/ui/store.ts` | Zustand + immer; `doc` counter ties a file handle to one loaded document |
| Edit operations | `src/core/ops.ts` | Pure functions over the model |
| Linter | `src/core/lint.ts`, `src/ui/lint/` | Issue → help card id + element ids to highlight; dock under the canvas |
| Help cards | `src/data/help.ts`, `src/ui/help/` | Mini-model rendered as a real diagram |
| Cases | `src/data/cases.ts`, `src/data/examples/*`, `cases/*.md` | Text + tagged phrases (span → element, why) + synonyms + hints |
| Walkthrough | `src/data/walkthrough.ts`, `src/ui/trainer/Walkthrough.tsx` | Each step = subset of the reference; last step equals it (tested). Predict-then-see questions before some steps |
| Build with hints | `src/data/coach.ts` | Next missing item from the comparator, in walkthrough order; ladder What → Where → Why → Answer; "Do it for me" |
| Comparator | `src/core/compare.ts` | Structural, not name-based; stems, short forms, synonyms. Took many fixes from real student attempts: test with the owner early |
| Text cues | `src/data/textcues.ts` | Patterns + word list, no NLP library; scored against the cases' spans (precision ≥ 0.85) |
| My task | `src/data/mytask.ts` | Own text, self-tagging by selection, keys 1–6 |
| Lessons (Learn) | `src/data/lessons.ts`, `src/ui/trainer/Lesson.tsx` | guess → gist → trap → test yourself; then practice |
| Story mode | `src/data/story.ts`, `src/ui/story/` | Beats by NAME; frames = model snapshots; only new lines animate (pathLength 1 + dashoffset); Present = fullscreen + `.is-presenting` |
| Story recording | `trailer/v2/record-story.mjs` | Playwright, headed full screen (headless shrank to 800×600); ~2:15 at CRF 24 ≈ 11 MB |
| Compare versions | `src/core/changes.ts`, `src/ui/changes/` | new green, changed violet, numbered; base saved in file |
| Share link | `src/core/shareLink.ts` | compact JSON + deflate-raw + base64url in `#m=`; strip the fragment after load |
| Files | `src/ui/fileSave.ts` | showSaveFilePicker first (keeps user activation), then build content; Save as / Ctrl+S |
| Import of a foreign tool's XML | `src/core/import/`, `src/core/export/powerdesigner.ts` | Own reader/writer for interoperability, tested on the owner's real files in `tests/fixtures/`; owner opens the export in the real tool |
| PWA | `vite.config.ts` plugin + `src/pwa/sw.js` | Precache list written at build; Update button on new deploy; `ignoreVary` needed for `vite preview` |
| Side columns | `src/ui/SideDock.tsx` | Hide (‹ ›), resize, autoHide below 1200 px, overlay in portrait |
| Floating draw bar | `src/ui/canvas/CanvasTools.tsx` | Keys for tools; can dock into the top bar |
| Tablet | `src/ui/viewport.ts` | keyboard fit (visualViewport), portrait layout, `pointer: coarse` bigger handles |
| Appearance | `src/ui/Appearance.tsx` | Text size via CSS `zoom` on panels only, never on the React Flow canvas (breaks coordinates) |

## Pitfalls already paid for

- A Zustand selector returning a new object (`?? {}`) loops React. Return stable values.
- React Flow + CSS `zoom` = wrong coordinates. Scale fonts, not the canvas.
- `fitView` with `maxZoom 1`; keep the user's pan when side columns resize (`KeepOnScreen.tsx`), no auto-centring.
- Menus close on `pointerdown`; dropdowns must be shifted back on screen (`useKeepInView.ts`).
- Trainer task vs user's own model: keep the user's model in a backup while a task runs, restore on exit; New/Open during a task must leave the task first.
- Ctrl+Z inside a text field = browser's field undo, not the app's.
- Comparator false "missing" came from names: stem words, accept short forms, `_on/_at` = date. Expect the same with task names ("Check invoice" vs "Invoice check").
- Vitest silences console.log: write debug output to a file.

## UI checks

- Built-in browser pane works for DOM checks (`read_page`, `javascript_tool`); screenshots there can time out or the pane is tiny (~533×333).
- Playwright MCP at 1366×820 is the reliable fallback. `require` is not available in run_code; downloads land in `.playwright-mcp/` (gitignore it). Dialogs: handle with browser_handle_dialog in the next call.
- File import test trick: fetch a fixture from the dev server, wrap in DataTransfer, set `input[type=file].files`, dispatch `change`.
- Touch: newContext({hasTouch, isMobile}); drags via CDP Input.dispatchTouchEvent.
- Give entities/nodes `data-testid` from the start.

## Deploy (as done for model.quaera.app)

1. `.github/workflows/deploy.yml`: test + build, upload-pages-artifact v5, deploy-pages v5 (Node 20 actions deprecated).
2. Pages with build_type=workflow (`gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`).
3. Custom domain: `gh api -X PUT repos/<owner>/<repo>/pages -f cname=flow.quaera.app`; the owner adds a CNAME at Cloudflare (DNS only, grey cloud); then `https_enforced=true` once the cert is issued. Claude in Chrome failed on Cloudflare before: the owner does the DNS step by hand.
4. After each push check that the Pages run is green.

## Licensing and public content

- Code Apache-2.0, learning content CC BY-NC-SA 4.0 (same split as Quaera). Keep third-party attributions (React Flow; bpmn.io if used).
- Course material only with the professor's permission. A graded group project's solution never goes public before grading (StrataSQL removed Ride Hailing for this reason; the Vet clinic project stayed private).
- Trademarks line in README/About (Bizagi is a trademark of Bizagi; BPMN is an OMG standard).
- Public texts without em dashes; give post texts in a plain ```text block.
