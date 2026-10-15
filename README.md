# StrataFlow

Browser-based **BPMN 2.0 process modeling** with help cards, a trainer and a story mode for presenting a process step by step. A lightweight, learnable companion to Bizagi Modeler for business process management courses.

- Spec: [SPEC.md](SPEC.md) · Progress: [ROADMAP.md](ROADMAP.md) · Cases: [cases/](cases/)
- Status: **preview** at https://flow.quaera.app: editor, BPMN import/export (Bizagi Modeler and bpmn.io), auto layout, model check with help cards, a trainer (7 cases, each watched built step by step, then 4 levels with hints and Do it for me; a redesign level for the AS-IS → TO-BE case; My task for your own text; case files `*.flow-case.json`; 7 lessons, tour), and Simulate: play a case step by step, cycle time, waiting, efficiency, cost and lane utilisation (flow analysis), AS-IS vs TO-BE.
- Sister app: [StrataSQL](https://model.quaera.app), data modeling (CDM → PDM → SQL). Both are part of **[Quaera](https://quaera.app)**.
- **Unofficial student project**, not affiliated with or endorsed by NOVA IMS.

## License

Code: [Apache-2.0](LICENSE) · Learning content (cases, explanations, hints, help cards): [CC BY-NC-SA 4.0](LICENSE-CONTENT).

Open-source packages used (React, React Flow, bpmn-moddle, elkjs and others) keep their own licences: the built app ships them in `third-party-licenses.txt` (Help → Third-party licences). elkjs is used unmodified under EPL-2.0, source at https://github.com/kieler/elkjs.

BPMN is a standard of the Object Management Group. Bizagi is a trademark of its owner; StrataFlow is not affiliated with Bizagi.
