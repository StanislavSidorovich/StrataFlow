# StrataFlow

Browser-based BPMN 2.0 process modeling tool with help cards, a trainer and story mode. Sister app of StrataSQL (data modeling, https://model.quaera.app). Full spec: `SPEC.md`. Progress and decisions: `ROADMAP.md`. Start every session from `ROADMAP.md` → "Next steps".

- Work stage by stage (SPEC §12); a stage is done only when its acceptance criteria pass. Target live URL: https://flow.quaera.app (GitHub Pages custom domain, DNS on Cloudflare, deployed by GitHub Actions on push to main). Part of Quaera (quaera.app). Code Apache-2.0, learning content CC BY-NC-SA 4.0.
- `src/core/` is pure TypeScript, no React imports. Every edit operation (SPEC §6), linter check (SPEC §7) and BPMN XML mapping gets a Vitest test.
- The cases in `cases/` are the regression suite: their reference models must lint clean, round-trip through BPMN XML unchanged, and be built step by step by the walkthrough.
- Modeling conventions follow the NOVA IMS Business Process Management course (Bizagi Modeler, BPMN 2.0, pools and lanes). Where the course is unknown yet, follow Bruce Silver's *BPMN Method and Style* and the 7 Process Modeling Guidelines (7PMG); write the choice in ROADMAP "Decisions".
- Points marked (?) in cases may be settled by Claude, choosing what is clearest for students; mark the choice ✱ in the case and list it under "Decisions" in ROADMAP.md.
- Read `docs/lessons-from-stratasql.md` before building a feature that StrataSQL already has (story mode, walkthrough, tagging, share link, PWA, file formats): reuse the pattern, not the bugs.
- Private: the owner's graded group project (BPM course, weekly progress reporting process) and anything about the owner's employer never go into this public repo, `cases/` or examples before grading. Private files live in `/private/` (gitignored).
- The owner writes in Russian; reply in Russian. Code, UI, docs and commit messages are in English. Public texts (posts, README copy) without em dashes.
- End of a work block = "комит, пуш, память, роадмап": commit, push, update memory, update ROADMAP.md (with a "Built with: <model> (Claude Code), effort <level>." line per sprint). A git tag after each big task.
