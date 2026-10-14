# Design notes

StrataFlow should feel like a sibling of StrataSQL: same fonts, tokens, top bar, side columns and dialogs, so a student who knows one app knows the other. Take the tokens from StrataSQL's `src/index.css` (`:root` and the dark theme), then add the BPMN ones below.

## Look

- Font: Inter / Segoe UI / system-ui; code: Cascadia Code / Consolas.
- Base tokens (light): `--app-bg #f6f7f9`, `--panel-bg #fff`, `--panel-border #e3e6eb`, `--text #1d2330`, `--muted #6b7385`, `--accent #2563eb`, `--accent-soft #e6eefe`, `--canvas-bg #fbfbfc`. Lint: error `#d0342c`, warning `#c27a00`, info `#2563eb`. Changes: new green, changed violet. Dark theme as in StrataSQL.
- Brand accent for StrataFlow: proposal teal `#0d9488` (StrataSQL's `--walk-new`) for the logo mark only, so the two apps are told apart at a glance; the UI accent stays blue. ✱ to confirm with the owner.
- BPMN shapes (neutral, standard notation, not Bizagi's colours):
  - Task: rounded rectangle, white, border `#4b5568`, type marker top left (user, service, send…).
  - Event: circle; start thin border (green tint `#e1f5ec` fill optional), intermediate double border, end thick border (red tint optional); trigger icon inside, filled = throwing.
  - Gateway: diamond with marker (X, +, O, pentagon).
  - Pool / lane: horizontal bands, name in a vertical header strip on the left; lanes alternate a very light tint.
  - Sequence flow: solid, filled arrow, orthogonal; default flow with a slash; conditional with a small diamond at the source.
  - Message flow: dashed, open circle at start, open arrow at end.
  - Data object: page with folded corner; data store: cylinder; annotation: open bracket.
- Text tags in the trainer (as StrataSQL's `--tag-*`): role/lane amber, activity blue, event green, decision (XOR) violet, parallel (AND) teal, data grey, message cyan, rule rose.

## Layout of the screen

Copy StrataSQL's frame (decided after comparing Figma, Excalidraw, tldraw, ChartDB):

- **Top bar in three zones**: left = logo, File, Examples, Trainer; centre = views (Process · Simulate later · XML); right = model name, Saved, Help, Aa (text size + Light/Dark).
- **Floating draw bar** on the canvas (palette): Task, Sub-process, Start, Intermediate, End, Gateway, Pool/Lane, Data, Annotation, Flow; keys (T, S, E…). Can dock into the top bar.
- **Left column** = trainer / task text / story beats (hide ‹ ›, resize). **Right column** = properties (hide, resize, overlay on narrow screens). **Dock under the canvas** = Model check.
- **Context pad** next to a selected element (as in bpmn.io): append task / gateway / event, change type, delete, "Group into sub-process" when several are selected.
- Undo/redo in the zoom controls; minimap only from ~15 nodes.

## First screen

StrataSQL opens straight into the app with a **welcome card** (no separate landing page), and that worked: the visitor sees the product at once. Do the same:

- Welcome card: one line on what it is ("Learn BPMN by doing: from a text to a process you can present"), three choices: **Learn the basics** (lessons) · **Watch a process built** (walkthrough of the first case) · **Start an empty process**. Small print: unofficial student project, link to StrataSQL ("design the data model too").
- Empty canvas hint: "Double-click to add a task, or open an example."
- Help → Tour (coach marks), About (disclaimer, author, licenses, trademarks), Send feedback, Install as app.
- The quaera.app homepage (Quaera repo) gets a card linking to flow.quaera.app, next to model.quaera.app.

## Story / Present look

As in StrataSQL story mode: earlier beats dimmed, the focused element highlighted, a comment card with a dotted leader, new flows drawn with a line animation, a token as a small filled circle moving along sequence flows. Present = full screen, nothing but the diagram and the card.
