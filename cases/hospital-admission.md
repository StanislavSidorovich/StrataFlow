# Hospital: patient admission

## 1. Meta

- id: `hospital-admission`
- title: Hospital: patient admission
- difficulty: ★★ (case 5 of the ladder)
- concepts trained: collapsed sub-processes with a page of their own (level 1 and level 2), a data object as input and as output, a data store, an inclusive (OR) split and join and when to avoid it; repeated: four lanes, XOR with a default flow, a skip branch closed by an XOR join, user and manual tasks
- reference model: `hospital-admission.flow.json` (laid out by Auto layout, lints clean, round-trips through BPMN XML); drawn by `drawHospital` in `tests/fixtures/cases.ts`
- domain link: StrataSQL's Hospital case (patients, doctors, wards, beds, tests)

## 2. Case text

> A patient comes to the hospital with a referral letter from their family doctor, and the admissions clerk registers the patient. Registering works like this: the clerk looks the patient up in the patient database. If the patient is new, the clerk creates an entry for the patient. Then the clerk prints a wristband, and the patient is registered.
>
> A doctor examines the patient, reading the referral letter. Depending on the findings, the diagnostics team takes a blood test, an X-ray, or both. Each test adds to the test results. When all the ordered tests are done, the doctor reviews the test results. If the patient does not need to stay, the doctor writes a treatment plan and the patient is sent home. Otherwise the patient is admitted to a ward. Admitting works like this: a ward nurse assigns a bed and takes the patient to the ward.
>
> We model the hospital's process. Registering and admitting are sub-processes: one step on the main diagram, with their own steps on a page of their own.

## 3. Text → model mapping

| Phrase | Element | Why |
|---|---|---|
| "A patient comes to the hospital" | start event **Patient arrived** | What starts the process. ✱ The patient is not drawn as a pool: the case keeps its new ideas (sub-processes, data, OR). |
| "a referral letter" | data object **Referral letter** | A document the process uses. |
| "the admissions clerk" | lane **Admissions** | A role. |
| "registers the patient" | collapsed sub-process **Register patient** | The text says how registering works, step by step: one step on the main diagram, its steps on its page. |
| "looks the patient up" | user task **Look up patient** (page of Register patient) | Work with a system. |
| "the patient database" | data store **Patient database**, read by Look up patient | Kept data the process reads and writes, that outlives one case: a data store. |
| "If the patient is new" | XOR **Patient known?**, branches **No** / **Yes** (default) | |
| "creates an entry for the patient" | user task **Create patient entry**, writes to Patient database | |
| "Then" | exclusive join before Print wristband | The No branch does one more task; both branches meet again. |
| "prints a wristband" | manual task **Print wristband** | |
| "the patient is registered" | end event **Patient registered** (on the page) | The end of the sub-process; the main process goes on after it. |
| "A doctor" | lane **Doctor** | |
| "examines the patient, reading the referral letter" | user task **Examine patient** + data association Referral letter → it | The letter is an input of the task. |
| "Depending on the findings … a blood test, an X-ray, or both" | inclusive gateway **Tests needed?**, branches **Blood test** / **X-ray** with conditions | One or more of the ways: an inclusive (OR) gateway. |
| "the diagnostics team" | lane **Diagnostics** | |
| "takes a blood test" | manual task **Take blood test** | |
| "an X-ray" | manual task **Take X-ray** | |
| "Each test adds to the test results" | data object **Test results**, output of both tests | |
| "When all the ordered tests are done" | inclusive join | It waits for the branches that were started, and only for them. |
| "reviews the test results" | user task **Review test results** + data association Test results → it | |
| "If the patient does not need to stay" | XOR **Stay needed?**, branches **No** / **Yes** (default) | In the Doctor lane, as the task before it. |
| "writes a treatment plan" | user task **Write treatment plan** | |
| "the patient is sent home" | end event **Patient sent home** | |
| "admitted to a ward" | collapsed sub-process **Admit to ward** | |
| "a ward nurse" | lane **Ward** | |
| "assigns a bed" | user task **Assign bed** (page of Admit to ward) | |
| "takes the patient to the ward" | manual task **Take patient to ward** | |
| "Admitting works like this" | end event **Patient on ward** on the page, **Patient admitted** on the main diagram | Every page has its own start and end event. |
| "the hospital's process" | pool **Hospital** | |

## 4. Reference process

Pools:
- **Hospital** (white box), lanes: **Admissions**, **Doctor**, **Diagnostics**, **Ward**

Nodes (type, name, lane), main diagram:
- start event: **Patient arrived**, Admissions
- collapsed sub-process: **Register patient**, Admissions
- user task: **Examine patient**, Doctor
- data object: **Referral letter**, Doctor
- inclusive gateway (split): **Tests needed?**, Doctor
- manual task: **Take blood test**, Diagnostics
- manual task: **Take X-ray**, Diagnostics
- inclusive gateway (join), Diagnostics
- data object: **Test results**, Diagnostics
- user task: **Review test results**, Doctor
- exclusive gateway: **Stay needed?**, Doctor
- user task: **Write treatment plan**, Doctor
- end event: **Patient sent home**, Doctor
- collapsed sub-process: **Admit to ward**, Ward
- end event: **Patient admitted**, Ward

Page of **Register patient** (Admissions):
- start event (no name)
- user task: **Look up patient**
- exclusive gateway: **Patient known?**
- user task: **Create patient entry**
- exclusive gateway (join)
- manual task: **Print wristband**
- end event: **Patient registered**
- data store: **Patient database**

Page of **Admit to ward** (Ward):
- start event (no name)
- user task: **Assign bed**
- manual task: **Take patient to ward**
- end event: **Patient on ward**

Sequence flows:
- Patient arrived → Register patient → Examine patient → Tests needed?
- Tests needed? → Take blood test, name **Blood test**, condition "the doctor orders a blood test"
- Tests needed? → Take X-ray, name **X-ray**, condition "the doctor orders an X-ray"
- Take blood test → inclusive join; Take X-ray → inclusive join
- inclusive join → Review test results → Stay needed?
- Stay needed? → Write treatment plan, name **No**, condition "the patient can be treated at home"; Write treatment plan → Patient sent home
- Stay needed? → Admit to ward, name **Yes**, default flow; Admit to ward → Patient admitted
- Register patient's page: start → Look up patient → Patient known?; Patient known? → Create patient entry, name **No**, condition "the patient is not in the records"; Patient known? → join, name **Yes**, default flow; Create patient entry → join → Print wristband → Patient registered
- Admit to ward's page: start → Assign bed → Take patient to ward → Patient on ward

Data associations:
- Patient database → Look up patient; Create patient entry → Patient database
- Referral letter → Examine patient
- Take blood test → Test results; Take X-ray → Test results; Test results → Review test results

## 5. Key decisions and alternatives

- ✱ "A blood test, an X-ray, or both" is an **inclusive (OR) gateway**: one or more of the ways run. The OR join after the tests waits for the branches that were started, and only for them. Course rule: an OR join only after an OR split.
- ✱ **Why to avoid the OR gateway where you can**: a reader has to know which branches were started to understand the join, and a reader (and many tools) gets an OR join wrong when it is not right after its OR split. When the text names a fixed choice ("either … or"), use an XOR; when everything runs, an AND. Here the doctor may order any combination, so OR is the one gateway that says it in one shape. The longer equivalent: an XOR with three branches (blood test only, X-ray only, both, the last one an AND split and join) repeats the tests.
- ✱ **Sub-processes**: "Registering works like this:" and "Admitting works like this:" describe a step in detail. Each is a **collapsed sub-process** with its steps on a page of its own (Bizagi: Edit Sub-Process; here: double-click). The main diagram stays at one level of detail (course: level 1 / level 2 models, 7PMG G7). An expanded sub-process drawn on the main diagram is also right; a flat model without sub-processes has the same steps but loses the levels.
- ✱ Each page has its own start event (no name: it starts when the sub-process starts) and its own end event, named after the outcome. The end event on the page (**Patient on ward**) and the one after the sub-process (**Patient admitted**) have different names, so P14 does not take them for duplicates.
- ✱ **Patient database** is a data store: it is kept beyond this case and other processes use it. **Referral letter** and **Test results** are data objects: they exist for this patient's case only. The arrows show direction: from the data to a task that reads it, from a task to the data it writes.
- ✱ The patient is not a pool. Case 2 already trained pools talking; here the new ideas are sub-processes, data and the OR gateway. With a Patient pool, the arrival would be a message start event.
- ✱ The OR split sits in the Doctor lane, where the decision is made (course: an (X)OR split in the lane of the task before it); the OR join may sit anywhere (here in Diagnostics).

## 6. AS-IS problems / TO-BE ideas

- The clerk looks every patient up by hand, and a new record is typed again from the referral letter. TO-BE: the family doctor sends the referral electronically; the record is created before the patient arrives.
- Each test waits for the diagnostics team in turn. TO-BE: the blood test is taken at the desk while the patient waits for the X-ray (the two branches already run in parallel in the model; the queue is the problem, which the model does not show until stage 6, Simulate).
- The doctor reviews results only when all tests are done. TO-BE: an urgent result goes to the doctor at once (a non-interrupting conditional or message event).

## 7. Hints per level, synonyms

Level 1 (tagging): roles = "the admissions clerk", "A doctor", "the diagnostics team", "a ward nurse"; decisions = "If the patient is new", "If the patient does not need to stay", "Otherwise", "or both"; data = "a referral letter", "the patient database", "the test results"; sub-processes = "registers the patient", "admitted to a ward".

Level 2 (complete the process, lanes and tasks given):
- What: one or more ways. Where: "a blood test, an X-ray, or both". Why: the doctor may order either test or both. Answer: an inclusive gateway **Tests needed?** after **Examine patient**, closed by an inclusive join before **Review test results**.
- What: data. Where: "Each test adds to the test results". Answer: a data object **Test results** written by both tests and read by **Review test results**.
- What: a sub-process page. Where: "Registering works like this". Answer: open **Register patient** (double-click) and draw its steps there, with a start and an end event.

Level 3 (from scratch): pool and lanes; the main diagram at one level (arrive, register, examine, tests, review, home or admit); then the two pages; then the data.

Synonyms:
- Hospital: Clinic, Hospital admissions
- Admissions: Admission desk, Reception, Admissions clerk
- Doctor: Physician, Doctors
- Diagnostics: Diagnostics team, Laboratory, Lab
- Ward: Ward nurse, Nursing
- Patient arrived: Patient arrives, Patient came in
- Register patient: Registration, Admit patient
- Look up patient: Find patient, Search patient record, Look up patient record
- Patient known?: Patient in records?, Existing patient?, New patient?
- Create patient entry: Create record, Register new patient
- Print wristband: Hand out wristband
- Patient registered: Registration done
- Examine patient: Examine, First examination
- Tests needed?: Which tests?, Order tests
- Take blood test: Blood test, Do blood test
- Take X-ray: X-ray, Do X-ray
- Review test results: Review results, Check test results
- Stay needed?: Admit patient?, Stay in hospital?
- Write treatment plan: Make treatment plan, Prescribe treatment
- Patient sent home: Patient discharged, Sent home
- Admit to ward: Admission to ward, Ward admission
- Assign bed: Allocate bed, Give bed
- Take patient to ward: Bring patient to ward, Move patient to ward
- Patient on ward: On ward, Patient in bed
- Patient admitted: Admitted
