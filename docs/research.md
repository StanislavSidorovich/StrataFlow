# Research: tools to learn from

Borrow ideas and UX patterns, never code, assets or screenshots. Check each tool live (built-in browser) in stage 0–1 and add notes here.

| Tool | Look at | Why |
|---|---|---|
| **Bizagi Modeler** (course tool) | Palette, pools/lanes, simulation levels (validation → time → resources → calendar), documentation export, BPMN export | Students come from it; export must open in it. Its pain: no "group into sub-process", manual layout |
| **bpmn.io / Camunda Modeler** | Context pad (append next element), replace menu (change type in place), keyboard, token simulation plugin, linting plugin (bpmnlint rules) | The best web BPMN editing UX; bpmnlint is a good source of rule ideas (we write our own) |
| **SAP Signavio Process Manager** | Quick model (table → diagram), dictionary of roles/terms, collaboration hub, comments | Text/table-first modeling, glossary |
| **draw.io / diagrams.net** | BPMN shape library, edge routing, keyboard duplicate-and-connect | Familiar baseline |
| **Lucidchart** | Swimlane handling, presentation mode | Lanes resize and presenting |
| **ARIS Express** | Free BPMN tool for students | What academic users expect |
| **Miro / FigJam BPMN templates** | Lightweight look, collaboration feel | Visual style |
| **Process mining tools (Celonis, Disco)** | Variant / path animations | Ideas for token animation and AS-IS analysis |

## Theory sources for help cards and linter

- OMG BPMN 2.0.2 specification (element semantics).
- Bruce Silver, *BPMN Method and Style* (Descriptive / Analytic levels, style rules, naming).
- Mendling, Reijers, van der Aalst, *Seven Process Modeling Guidelines (7PMG)*: few elements, few routing paths, one start/end, structured (split = join), avoid OR, verb-object labels, decompose above 50 elements.
- Dumas, La Rosa, Mendling, Reijers, *Fundamentals of Business Process Management* (likely close to the course: process identification, discovery, analysis, redesign, AS-IS / TO-BE).
- Weidlich et al., behavioural profiles (for the comparator: order relations between activities).

Write help cards and cases in our own words; cite sources in the card's "Learn more".
