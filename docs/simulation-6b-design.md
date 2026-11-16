# Stage 6b: simulation like Bizagi's, explained (design)

Status: design, 2026-11-16, no code yet. Written by Opus for the implementers (Sonnet, one phase at a time; the engine phase by Opus). Read with SPEC §5 (metamodel), ROADMAP "Decisions" of 2026-10-15 (stage 6) and the v0.14.0 entry (Kaiyo figures, Little's law).

Inputs read for this design: `src/core/analysis.ts`, `play.ts`, `metamodel.ts`, `ops.ts` (`setSim`, `setProbability`, `setCapacity`, `setSimSettings`), `bpmn/read.ts` and `write.ts` (the `sf:` attributes), `ui/panels/Simulate.tsx`, `data/help.ts` (card `simulation`), `zip.ts`, `ui/files.ts` (`saveExport`); the owner's screenshots of Bizagi Modeler's simulation view and one exported results workbook (private, not in the repo; only the column layout is used here); the chapter 6 note in the family folder (`research/bpm-ch6-quantitative/NOTES.md`, features F4–F7).

**Privacy.** Nothing from the course (its exercises, diagrams, figures or names) goes into this repo. The example is Kaiyo Trading's distributor order (`cases/kaiyo-order.flow.json`, `#example=kaiyo`); its figures are invented teaching figures, labelled as such in the app.

## 0. What 6b is, in one paragraph

Stage 6 computes exact averages by flow analysis (Dumas et al.): no randomness, no queues, every lane "busy X %". Bizagi instead *runs* hundreds of invented cases (discrete-event simulation) in four levels: process validation, time analysis, resource analysis, calendar analysis. 6b adds that run to Flow, with the same four levels, and keeps Flow's point of difference: **every run result sits next to the formula that predicts it**, so the student sees why the numbers agree (level 2 = flow analysis), why they differ (queues at level 3; M/M/c says how much) and why two runs differ (randomness; runs, seed, interval). Flow stays a trainer next to Bizagi, not a replacement: assignments are still handed in from Bizagi.

## 1. Data model

### 1.1 Principle

Additive and optional. Every new field is optional; a file without it behaves exactly as today (same flow analysis, same tests, same Kaiyo numbers). The `.flow.json` `version` stays 1. In BPMN every new field is one more flat attribute in the existing namespace `https://flow.quaera.app/ns/sim` (prefix `sf`), next to `sf:duration`, `sf:wait`, `sf:cost`, `sf:repeats`, `sf:probability`, `sf:capacity`, `sf:timeUnit`, `sf:arrivals`. Other tools ignore them; an older Flow ignores them too.

The existing numbers keep their meaning: `duration` and `wait` stay **the mean**, which is what flow analysis uses. A distribution only adds the *shape* around that mean. This is the key choice: analysis and simulation read the same figure, so level 2 can be checked against the analysis.

### 1.2 Fields by element (Bizagi → Flow)

| Bizagi (where) | Flow field | Element | Exists? | Notes |
|---|---|---|---|---|
| Start event: arrival interval (mean, distribution) | `sim.arrivals` (rate per unit) + `sim.arrivalShape` | model settings | rate yes, shape new | Interval mean = 1 / arrivals. Kept on the model, not on the start event: Flow analyses one pool at a time and the pool's first start event receives the cases (see 1.4). The Run tab shows the field beside the start event's name, as Bizagi does. |
| Start event: max arrival count | `sim.cases` | model settings | new | Cases per run, default 200, 1–10 000. |
| (Bizagi: one run) | `sim.runs` | model settings | new | Replications, default 5, 1–20 (section 4.3). |
| (none) | `sim.seed` | model settings | new | Integer; same model + seed + settings = same result. |
| Task: processing time + distribution | `sim.duration` + `sim.durationShape` | task, sub-process | duration yes, shape new | |
| Task: wait time | `sim.wait` + `sim.waitShape` | task, catching intermediate event | wait yes, shape new | A fixed delay *before* the task asks for its resource (tray, hand-over, truck). Queueing for the resource comes on top and is found by the run, never typed. |
| Task: activity cost | `sim.cost` | task | yes | Cost per run of the task (Bizagi's "activity cost"). |
| Task: resource (AND/OR, quantity) | the task's own lane, 1 person | task | implied | Lane = resource pool, as the course and Dumas teach (lanes, not pools). No multi-resource AND/OR (section 1.5). |
| Resource: available quantity | `capacity` | lane | yes | Blank = 1, as in the analysis. Non-integer is rounded for the run (note). |
| Resource: fixed cost (per use) | `useCost` | lane | new | Added to every task run in the lane. |
| Resource: unit cost (per hour) | `hourlyCost` | lane | new | Always per **hour**, whatever the model's unit (label says so); × processing time converted with `convertTime`. |
| Gateway: outgoing probabilities | `probability` | sequence flow | yes | Exclusive and event-based: one branch, shares as `branchShares` (sum ≠ 100 % is scaled, with a note). Inclusive: each branch independently (section 3.3). |
| Boundary event: probability | `sim.fires` | boundary event | new | Share of the host's runs in which the event happens (0–1). Blank = never, so today's figures do not change. Closes the "boundary-event probabilities" leftover (F7). |
| Resource calendar, arrival calendar | `sim.workHours` (later) | model settings | reserved | Level 4, phase 6, only if the owner confirms the course needs it (open question 2). |

### 1.3 Shapes (distribution) in the metamodel

```ts
/** The spread of a time around its mean. Absent = constant (today's behaviour). */
export type Shape =
  | { kind: 'exp' }                                              // mean = the figure; sd = mean
  | { kind: 'normal'; sd: number; min?: number; max?: number }   // mean = the figure; cut to [min ?? 0, max ?? ∞]
  | { kind: 'uniform'; min: number; max: number }                // the figure = (min + max) / 2
  | { kind: 'triangular'; min: number; mode: number; max: number } // the figure = (min + mode + max) / 3

SimFigures += { durationShape?: Shape; waitShape?: Shape; fires?: number }
SimSettings += { arrivalShape?: 'exp' | 'const'; cases?: number; runs?: number; seed?: number }
Lane += { useCost?: number; hourlyCost?: number }
```

- One op per field, as today: `setShape(m, id, 'duration' | 'wait', shape | undefined)`, `setLaneCost(m, laneId, { useCost?, hourlyCost? })`, `setFires(m, id, p)`, and `setSimSettings` takes the new settings. For uniform and triangular the op **also writes the mean** into `duration` / `wait`, so the analysis stays right; changing the mean of a uniform or triangular shape by hand shifts min, mode and max by the same amount (keeps the width).
- A cut normal has a mean above μ when the cut at 0 bites (μ = 1, σ = 1 → about 1.29). `shapeMean(shape, figure)` in `core/random.ts` computes the real mean; the UI warns when it differs from the figure by more than 2 % ("the cut at 0 moves the average to 1.29 h; the analysis uses 1"). The analysis keeps using the figure (no silent change).
- BPMN: `sf:durationShape="normal" sf:durationSd="0.2" sf:durationMin="0.1" sf:durationMax="0.3"`, likewise `wait…`, `sf:fires`, `sf:useCost`, `sf:hourlyCost`, `sf:arrivalShape`, `sf:cases`, `sf:runs`, `sf:seed`. The reader drops a shape it does not know or whose numbers are invalid (constant, with a note in the Run tab), never fails the file. Round-trip test on a fixture with every field.

### 1.4 What one run covers

- **One pool**: the one the Simulate panel shows (`Analysis.poolId`). Other pools are not simulated; a receive task or a catching message event waits only its typed `wait` (the note says "messages from other pools are not simulated", as the analysis does).
- **Arrivals** go to the pool's first start event (document order). Other start events of the same level are not started; the Run tab lists them in a note. Event sub-processes are not started (note).
- **Sub-processes** run their content (start events at that level), like the analysis; a collapsed one without content uses its own `sim` figures. `repeats` with `loop: 'sequential' | 'standard'` runs the activity that many times one after the other; `loop: 'parallel'` runs that many copies at once and waits for all.

### 1.5 Deliberately not modelled

- Bizagi's multi-resource assignment (AND / OR, "2 doctors and 1 nurse") and per-task resource override: the course teaches lane = resource pool; one person of the task's lane covers it. A task outside every lane uses no resource (no queue; note).
- Resource priorities, pre-emption, batching, resources working on two tasks at once, absence. The chapter's own list of simulation simplifications; the help card names them.
- Bizagi's scenario files and its own simulation export. Reading simulation figures that Bizagi may write into a `.bpmn` (BPSim) is open question 3.

## 2. Shapes (distributions)

### 2.1 The set: constant + four

| Shape | Parameters (besides the mean) | When to use (help card text) |
|---|---|---|
| Constant | none | A machine or a fixed rule: "the system posts the order in 5 min". Also: when you only know an average. |
| Normal, cut at 0 | σ, optional min / max | Routine human work with a typical time and small spread: "packing takes 1 h, give or take 15 min". |
| Exponential | none (σ = mean) | Times with no "typical" value, many short and a few very long: assessing a request, a customer answering. And the time between random arrivals. |
| Uniform | min, max | "Anywhere between 2 and 4 hours, no idea which is likely." |
| Triangular | min, most likely, max | Three-point estimate from an interview: "usually 1 h, at best 30 min, at worst 3 h". The shape an analyst can get without data. |

**Why not all of Bizagi's (about 15: constant, normal, truncated normal, uniform, lognormal, beta, triangular, negative exponential, gamma, Erlang, Weibull, binomial, Poisson…).** The course's slides use fixed, normal and exponential; triangular and uniform are what a person can estimate in an interview. The others need fitting to measured data (goodness of fit), which the chapter note keeps out of scope; to a student they are names without a decision behind them. Binomial and Poisson are counts, not times. The help card says this and lists what Bizagi offers, so the student is not surprised there. Adding a shape later is one `Shape` case, one sampler and one row in the picker.

### 2.2 Poisson arrivals and exponential intervals (the card "Random arrivals")

If customers arrive independently of one another at an average rate λ, then **the number** arriving in a period of length t follows a Poisson distribution with mean λt, and **the time between two arrivals** follows an exponential distribution with mean 1/λ. They are two descriptions of one process (a Poisson process). Flow asks for the rate ("12 orders a day") and offers two arrival shapes: *Random (Poisson)*, the default, which draws exponential intervals; and *Regular*, a constant interval 1/λ (no arrival queues at all, useful to see that queues come from randomness).

Bizagi's start event asks for the *interval* and labels its distribution "Poisson" with a mean. Whether Bizagi then draws exponential intervals or a whole-number Poisson interval is not visible in the screenshots; it matters for comparing a Flow run with a Bizagi run (open question 1). The card shows the conversion both ways: 12 a day = 0.5 per hour = one every 2 h on average.

### 2.3 Random numbers with a seed

- `core/random.ts`: a small seeded generator (sfc32 or mulberry32, public domain, a few lines, no dependency) and samplers: constant; exponential `−mean·ln(1 − u)`; normal by Box–Muller, cut by redrawing (at most 100 tries, then a uniform draw inside [min, max] and a note "the cut leaves almost nothing of this normal"); uniform; triangular by inverse CDF.
- **Streams per element**: each element (each start event, task, gateway, boundary event) gets its own generator, seeded from `hash(seed, elementId, purpose)`. Adding a task does not change the arrival sequence, and a what-if run with a second packer sees the same orders with the same durations (common random numbers: the difference between two scenarios is the change, not the dice).
- `seed` default 1. "Run again with a new seed" increments it. Tests use fixed seeds and are exact (no flaky tolerance), but a change to the order of draws changes them: such a change must say so in its commit.

## 3. Engine

### 3.1 Where it runs

- `src/core/simulate.ts`: pure TypeScript, no DOM, no React (rule of `src/core/`). A class `Simulation(model, options)` with `step(maxEvents): boolean` (true when done) and `result(): SimResult`. The same code runs in a Web Worker and, as a fallback, on the main thread in slices.
- `src/ui/sim.worker.ts`: `new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })`. Protocol: `{ type: 'run', id, model, options }` → `{ type: 'progress', id, done, total }` every ~100 ms → `{ type: 'result', id, result }` or `{ type: 'error', id, message }`. Cancel = `worker.terminate()` and a new worker next time. Messages with an old `id` are dropped.
- Check the worker in the **production build** (`npm run build` + preview), not only in dev, and that the PWA precache lists the worker chunk (Lab's DuckDB worker broke only in the prod build; Flow offline must still run).

### 3.2 Discrete-event core

- Future event list: a binary heap ordered by (time, sequence number); the sequence number makes ties deterministic.
- Per case: id, arrival time, live tokens, per-join counters, visits counter. Per lane: capacity c, busy count, FIFO queue of waiting task runs, busy-time accumulator, queue-length time integral.
- A task run: typed wait (sampled from `wait` + `waitShape`) → request one unit of the lane (start at once or join the FIFO) → processing (sampled from `duration` + `durationShape`) → release (the next in the queue starts) → leave by the outgoing flows. Times recorded per run: ready, start, end (the chapter's three stamps); resource wait = start − ready.
- Joins: a parallel join waits for one token per incoming flow *of the same case*; an inclusive join waits for as many tokens as its matching split (`matchingJoin` from `analysis.ts`) started for that case; an exclusive join passes each token.
- A case ends when it has no live token (end events, implicit ends) or reaches a terminate end event at its top level (its other tokens are removed; their queued requests are withdrawn).
- Boundary event with `fires = p`: when the host's processing ends, with probability p the event happened during it: interrupting → the token leaves by the boundary path instead of the normal flow; non-interrupting → both. (The moment inside the processing is not modelled; the help card says so.) Timer boundary events with a typed wait are treated the same way: the probability decides, not the clock.
- Guards: at most 1 000 visits of one element per case (a loop with probability 1 never lets go): the case is counted **stuck** and its tokens removed. At most 2 000 000 events per replication; beyond, the run stops with "too many events; fewer cases?". A parallel join still missing tokens when nothing else can move → stuck (the same "Stuck" as token play).

### 3.3 Gateways

- Exclusive, event-based, complex: one branch, drawn with the shares of `branchShares` (same scaling and notes as the analysis; default flow takes what is left).
- Parallel split: every branch.
- Inclusive split: each branch independently with its probability; if no branch is drawn, the default flow (or the branch with the highest probability) is taken. Bizagi does the same thing in spirit; the analysis today treats inclusive as a decision, and that difference is written in the inclusive help card ("the analysis assumes one branch; the run lets several happen").

### 3.4 Levels (as Bizagi)

| Level | What it uses | What it answers | Needs |
|---|---|---|---|
| 1. Validate | flows, gateway probabilities, `fires` | Does every case reach an end? Which elements are never reached, where do cases get stuck, which gateway shares do not add up? Counts per element. | a start event |
| 2. Time | + durations, waits, shapes, arrivals | Cycle time per case with unlimited people: no queue at all. Its average must equal the flow analysis (constant times) or come close (random times; parallel branches make it a bit longer, section 4.4). | durations (missing = 0, listed) |
| 3. Resources | + lane capacities, costs | Queues for people: resource waiting per task, utilisation per lane, cost per case including lane costs. The new number Bizagi gives and the analysis cannot. | arrivals; lanes |
| 4. Calendar | + working hours | Later (phase 6, open question 2). Shown greyed with "later" so the student sees the ladder is the same as Bizagi's. | |

Each level adds one thing; the results of level n stay visible as a column when the student moves to level n + 1, so "what changed when I added resources" is one look. Level 1 complements Check (static rules): Check finds a gateway without a default; Validate finds that 7 % of the cases never end.

### 3.5 Limits and progress

- Cases per run 1–10 000, runs 1–20, cases × runs ≤ 100 000. Fields refuse values outside and say the limit.
- Progress bar (cases finished / total) and Cancel. Cancel throws the partial result away ("Cancelled; nothing kept"). A run of 10 000 Kaiyo cases is expected to take well under a second in the worker; the limits are there for heavy loops and big models.
- Typical size estimate for memory: per case only its cycle time and three sums are kept (for percentiles); per element and per lane only running aggregates. No per-case trace is kept (the token play already shows one case).

## 4. Results

### 4.1 What is shown

Process (the pool): cases started, completed, stuck; cycle time mean, min, max, σ, 90th percentile; split into processing, typed waiting and resource waiting; efficiency (processing / cycle time); cost per case (task costs + lane use costs + lane hourly costs); throughput (completed / (last completion − first arrival)); average work in process (time-weighted).

Per element (Bizagi's columns): type, instances started, instances completed, min / max / avg / total time, min / max / avg / σ / total time waiting for a resource, total fixed cost, total unit cost.

Per lane (resource): capacity, utilisation, total fixed cost, total unit cost, total cost, average and longest queue.

Definitions written in the tooltips and the help card:
- **Utilisation** = busy person-time ÷ (capacity × the arrival window), where the arrival window runs from the first to the last arrival. Using the whole run (until the last case drains) would make it lower than the steady-state ρ; Bizagi divides by the scenario's duration, so its figure can be lower than Flow's for the same model (the card says why).
- **Little's law check**: average WIP over the run vs throughput × mean cycle time. Over a run in which every case completes, the two are equal exactly (it is an identity on any sample path); the row shows both and the working, as v0.14.0 does for the analysis.

On the canvas (toggle "Show on diagram", off by default): a small badge per task with completed count, average time and average resource wait, as Bizagi draws them; the task with the longest resource wait gets the warning colour. Uses the existing overlay layer of token play.

### 4.2 Run next to the formula

A column "Formula" beside "Run" for cycle time, processing, waiting, cost per case and each lane's utilisation, from `analyseModel`. For a lane, a third number: **M/M/c estimate** of the resource wait, from `core/queue.ts` (Erlang C; c = capacity, λ = arrivals × runs through the lane per case, 1/μ = average work per run in the lane), labelled "estimate: one queue, random arrivals and times". This is F4 of the chapter note; the formula ships in phase 1 even before the run exists, as a line in the lanes table.

### 4.3 Randomness made visible

`runs` replications with seeds seed, seed + 1, …: the KPI tiles show the mean over runs and a 95 % interval (t distribution, n − 1 degrees of freedom); a small strip shows each run's mean cycle time as a dot. One run of 200 cases can be 60 % off the long-run value (chapter note, 1.4): the strip makes that visible without words. "Run again with a new seed" moves the dots.

### 4.4 Tests that tie the run to the theory (phase 2)

1. **Determinism**: same model, options and seed → deep-equal results; another seed → different.
2. **Level 2 = flow analysis**: a model with sequence, AND split and join, a rework loop and a sub-process, constant times, constant arrivals: mean cycle time, processing and cost equal `analyseModel` to 1e-9 (no decisions) and within 2 % with decisions (fixed seed, 20 000 cases). Every case in `cases/` at level 2 with its own figures: within 3 %.
3. **AND of random branches**: two parallel exponential branches of mean 1: mean of the max = 1.5, not 1 (shows why the run beats the formula with random times).
4. **M/M/1**: λ = 1.5, μ = 2 (one clerk posting orders, 0.5 h each, exponential arrivals and times), 20 000 cases, fixed seed: W within 5 % of 2 h, Wq within 10 % of 1.5 h, utilisation within 3 % of 0.75.
5. **M/M/2**: same λ and μ, capacity 2: Wq ≈ 0.0818 h, W ≈ 0.5818 h (Erlang C), utilisation 0.375. And `core/queue.ts` gives exactly these numbers (unit test, 1e-4).
6. **Little**: WIP = throughput × cycle time to 1e-9 on any run in which all cases complete.
7. **Edges**: stuck join, loop with probability 1 (stuck count), boundary `fires` 0 / 0.3 / 1, inclusive split never empty, terminate removes queued requests, overloaded lane (ρ > 1) still finishes N cases and its resource wait roughly doubles when N doubles.
8. **Kaiyo**: level 2 cycle time = 68.8 h with constant shapes; level 3 utilisation of Warehouse ≈ 68 % at 12 orders a day.

### 4.5 Export

- **Excel (.xlsx)**, written by Flow itself: SpreadsheetML parts packed with the existing `core/zip.ts` (stored, no compression; no dependency, Apache-2.0 code). Sheets, mirroring Bizagi's export so a student can lay the two side by side: **Resources** (Resource, Utilization, Total fixed cost, Total unit cost, Total cost), **<process name>** (Name, Type, Instances completed, Instances started, Min / Max / Avg / Total time (unit), Min / Max / Avg / Standard deviation / Total time waiting resource (unit), Total fixed cost), plus Flow's own **Summary** (level, cases, runs, seed, arrivals and shape, date, process KPIs with the Formula column) and **Runs** (one row per replication). Numbers are numeric cells with number formats (utilisation as a 0.00 % format, not a text "37.19 %" as Bizagi writes it), the unit in the header. Inline strings (no shared-strings table), XML escaped, sheet name cut to 31 characters without `[]:*?/\`. File name `<process> simulation L<level> seed<seed>.xlsx`. Saved through `saveExport` (new kind `xlsx`): the Save dialog in Chrome and Edge, a download elsewhere.
- **Copy table** on each table: tab-separated text to the clipboard, decimals with the browser locale's separator (pastes as numbers into a Portuguese or Russian Excel and into Google Sheets). This is also the way out when a download manager swallows the file.
- No CSV: a comma-separated file opens as one column in a Portuguese or Russian Excel (they expect `;`); xlsx and Copy avoid the question.
- Not in the `.flow.json` or the BPMN: results are not saved in the model (they depend on the seed and are cheap to recompute).

## 5. Learning (where the person sees it)

### 5.1 The arc: theory → do → compare

1. **Predict.** Before the first run at a level, the Run tab asks one guess in a field (Kaiyo: "Warehouse is busy 68 %. How long does an order wait for a packer, on average?"). The guess is kept beside the result; no score.
2. **Run.** Level 2, then level 3; each level's numbers stay as a column.
3. **Compare with the formula.** Formula column, M/M/c estimate, Little row: where they agree and the one sentence why they do not (queues; random parallel branches; randomness of a short run).
4. **What if.** Change one thing, run again with the same seed, read the difference (section 5.4).
5. **Name it.** The help card for the idea opens from the "?" beside each number.

### 5.2 Help cards (new, in `data/help.ts`, CC BY-NC-SA)

| id | Title | Core of the card |
|---|---|---|
| `sim-levels` | Simulation levels | Validate → Time → Resources → Calendar, what each adds, Bizagi uses the same ladder. |
| `sim-shape` | Shape of a duration | The five shapes, when to use which, the cut normal's mean, why not Bizagi's other ten. |
| `sim-arrivals` | Random arrivals (Poisson) | Rate vs interval, Poisson count ↔ exponential interval, 12 a day = one every 2 h; Regular arrivals have no queue. |
| `sim-queue` | Utilisation and queues | Queues come from spread, not from lack of capacity on average; the knee: at ρ 0.75 / 0.9 / 0.95 the wait is 3 / 9 / 19 × the work (M/M/1); M/M/c and why a second person cuts the wait far more than in half. |
| `sim-randomness` | Why two runs differ | Replications, seed, the 95 % interval, warm-up (the first cases find an empty process), "a run of 200 cases can be 60 % off". |
| `sim-what-if` | What-if scenarios | Change one thing, same seed, read the difference; the cheapest lever is often the typed wait, not the people. |

The existing card `simulation` ("Cycle time and flow analysis") gains a paragraph "Run it" pointing to `sim-levels`. All new cards list Kaiyo under "In the cases" through `caseRefs` (and case 7 for `sim-what-if`).

### 5.3 Kaiyo with ready figures and questions

`cases/kaiyo-order.flow.json` gets shapes, not new means (so the analysis figures of v0.14.0 do not move): Post order triangular 0.25 / 0.5 / 0.75 h; Pack goods normal σ 0.25 h; Ship goods triangular; Send invoice constant; arrivals Random (Poisson), 200 cases, 5 runs, seed 1. Lane costs stay as typed task costs (no hourly cost: the existing costs already include the people). Labelled teaching figures, as now.

Three questions, shown in the Run tab when the Kaiyo example is open (a small "Try this" box, dismissible; the example is recognised by its file, as `exampleLink.ts` opens it):
1. "At 12 orders a day the warehouse is busy 68 %. Guess the average wait for a packer, then run level 3."
2. "Peak season: 18 orders a day (What if: arrivals × 1.5). The warehouse goes to 101 %. What happens to the wait when you run 200 and then 400 cases?" (It grows with the run: no steady state above 100 %.)
3. "Add a second warehouse person (What if: Warehouse 2). Busy 51 %. How much of the wait is left, and is the cycle time much shorter? Why not?" (The 23 h and 47.5 h typed waits dominate: the real lever is the hand-over, not the people. This is the chapter's lesson that waiting, not work, is the target.)

### 5.4 What-if

A "What if" row in the Run tab: arrivals × factor, and a capacity per lane, **as overrides of the run, not edits of the model**. "Run both" runs the model and the what-if with the same seed and shows two columns with the differences in colour (lower is better for times and costs). "Apply to the model" writes the overrides as normal edits (undoable). The earlier "Keep as AS-IS" stays for the analysis; for runs, "Pin this run" keeps the current result as the comparison column (in memory, and in `localStorage` under `strataflow.sim.pinned` when available).

### 5.5 Lesson and walkthrough

- Lesson 8 "Simulate a process" in `data/lessons.ts` (same structure: guess, gist, trap, test, cards): guess = question 1 above; trap = "busy under 100 % means no queue"; test = three questions (Poisson ↔ exponential; why level 2 equals the formula; what doubling capacity does at ρ 0.75). Its practice opens the Kaiyo example on the Run tab at level 2. If the lesson pane does not stay open beside the canvas during practice, the three Kaiyo questions in 5.3 carry the practice.
- The case walkthrough builds the model from the text and has no figures step; it is not changed. Case 7 (expense claim) gets a sentence in its `.md`: "run both models at level 3" (the AS-IS has a monthly payment run, a good what-if), no new trainer level.

### 5.6 Link from the Quaera trainer

No new link. The trainer already opens `flow.quaera.app/#example=kaiyo` (`FLOW_KAIYO`), and the Kaiyo notice gains "Simulate → Run shows the queues". If the trainer later needs to land on the Run tab directly, the form is `#example=kaiyo&tab=run`, pushed in Flow first (the receiver), then in the trainer, and added to the transitions table in the family `CLAUDE.md`.

## 6. Edge cases

| Category | Case | Behaviour |
|---|---|---|
| Empty | No start event in the pool | Run disabled: "Draw a start event first" (same text as the panel today). |
| | Several start events | The first gets the cases; note lists the others. |
| | No end event | Tokens end where flows end (implicit end); level 1 notes it. |
| | No lanes, or a task outside every lane | No queue for it; level 3 note "add lanes to model who does the work". |
| | Task without duration | 0, listed under "missing figures" (as the analysis). |
| | Cases 0 or blank | Field refuses (minimum 1). |
| | Arrivals blank | Levels 1–2 run with 1 per unit and a note (arrivals do not change their result); level 3 disabled: "How many new cases per [unit]?". |
| Zero and bounds | Gateway shares not adding to 100 % | Scaled as `branchShares`, note; all 0 → equal shares, note. |
| | σ < 0, min > max, mode outside [min, max], negative min | Field red with the reason, nothing stored. σ = 0 → constant. |
| | Normal cut leaving almost nothing | Redraw at most 100 times, then uniform inside the cut, note. |
| | Capacity 0 or negative | Refused (minimum 1); 1.5 → 2 in the run, note. |
| | Utilisation > 100 % | The run still finishes N cases; red warning: "the queue grows with every case; it never settles". |
| | Endless loop (probability 1 back) | Cases stuck after 1 000 visits; level 1 names the loop. |
| | Boundary `fires` outside 0–1 | Refused; `"30"` typed in a % field = 30 %. |
| Duplicates | Double click on Run | Button disabled while running; run id drops late messages. |
| | Same seed again | Identical result (by design); "new seed" button beside. |
| | Model edited after a run | Result marked "Model changed since this run" (model reference differs), still readable. |
| Formats | `1,5`, `1.5`, `1 000`, `90%` | Comma and dot as decimal, spaces removed, `%` accepted; `1.000,5` is refused (red), not guessed. (Extend `num` in `Simulate.tsx` into one shared parser.) |
| | Units | Every number shows the model unit; hourly cost is per hour always; arrivals "per [unit]" with a "12 a day = 0.5 per hour" hint. |
| | Export decimals | xlsx numbers are numeric (Excel localises); Copy uses the locale separator. |
| Volume and time | 10 000 cases × 20 runs | Refused (max 100 000 cases in total); progress bar, Cancel, event cap 2 M per run. |
| | Big result tables | Only aggregates kept; badges drawn once at the end, not animated. |
| Failures | Worker cannot start (old browser, blocked) | Same engine on the main thread in slices of 20 000 events with `setTimeout`, note "running without a worker: the page may pause". |
| | Worker error | Message shown, Run enabled again; nothing kept. |
| | Offline (PWA) | Worker chunk is in the precache (checked in phase 3). |
| | `localStorage` unavailable | Pinned run and "Try this" dismissal live in memory only (try/catch everywhere). |
| | Download manager (IDM) catches the xlsx | Save dialog first where available; elsewhere the note says "If a download manager took the file, use Copy table". |

## 7. Phases

| Phase | What is ready at the end | Files | Tests | Version | Model |
|---|---|---|---|---|---|
| 1. Figures, shapes, formula | Shapes, `fires`, lane costs and run settings in the metamodel, ops, BPMN and `.flow.json` round-trip; seeded generator and samplers; Erlang C; analysis adds lane costs and boundary `fires` (both blank by default, so every existing number stays); Figures tab gets a Shape column with the picker and the lane table gets cost columns and the M/M/c estimate of the wait; one shared number parser. | `core/metamodel.ts`, `core/ops.ts`, `core/bpmn/read.ts`, `write.ts`, new `core/random.ts`, new `core/queue.ts`, `core/analysis.ts`, `ui/panels/Simulate.tsx` | round-trip of every new field; samplers: mean and variance of 100 000 draws within 1 %, cut normal never outside; `shapeMean`; Erlang C (M/M/1 and M/M/2 numbers of 4.4); existing analysis tests unchanged; analysis with `fires` and lane costs on a small model | v0.15.0 | Sonnet |
| 2. Engine | `core/simulate.ts` with levels 1–3, guards, replications, streams per element; no UI. | new `core/simulate.ts`, `tests/simulate.test.ts` | the eight groups of 4.4 | commit only (no release) | **Opus**: state per case, joins (parallel, inclusive via `matchingJoin`), sub-processes, terminate with queued requests, boundary events, stuck detection. |
| 3. Run tab | Worker and fallback, Run tab with levels, settings, progress, Cancel, KPI tiles with interval and run strip, three tables with the Formula column, Little row, badges on the canvas, stale-result mark; Properties shows the figures of the selected element (the 6b leftover "Properties fields"). | new `ui/sim.worker.ts`, new `ui/panels/SimRun.tsx`, `ui/panels/Simulate.tsx`, canvas overlay, `ui/panels/Properties*` | worker protocol (run id, cancel) with a fake worker; UI checked with Playwright on dev **and** on the prod preview (worker path), 1366 × 820 and 375 px, offline reload | v0.16.0 | Sonnet (protocol and layout fixed here) |
| 4. What-if and export | What-if row, Run both, Pin this run, Apply to the model; xlsx writer and Copy table. | new `core/xlsx.ts`, `ui/files.ts` (`xlsx` kind), `ui/panels/SimRun.tsx` | xlsx read back with `readZip` (sheets, headers, numeric cells, escaping, 31-char names); same seed in both scenarios gives the same arrivals; owner opens one file in Excel once | v0.17.0 | Sonnet |
| 5. Teaching | Six help cards, the `simulation` card's new paragraph, Lesson 8, Kaiyo shapes and the "Try this" questions, Kaiyo notice line, case 7 sentence; SPEC §5 and §12 and ROADMAP updated. | `data/help.ts`, `data/lessons.ts`, `data/caseRefs.ts`, `cases/kaiyo-order.flow.json`, `cases/kaiyo-order.md`, `cases/expense-claim.md`, `ui/exampleLink.ts`, `SPEC.md` | help and lesson tests (card ids, seeAlso, caseRefs); Kaiyo test group 8; Kaiyo analysis numbers of v0.14.0 unchanged | v0.18.0 | Sonnet; the owner reads the card texts before the push |
| 6. Calendar (only if confirmed) | Model working hours (per day, days per week) for lanes and arrivals; level 4 enabled; "working vs calendar hours" card. | `core/simulate.ts`, `Simulate.tsx`, `help.ts` | a shift of 8 of 24 h triples the cycle time of a one-task process with no queue | later | Opus for the engine part, Sonnet for UI |

Order matters: 1 → 2 → 3, then 4 and 5 in either order. Phase 1 alone is already useful (the M/M/c estimate on the lanes table closes F4 without the run). F2 of the chapter note ("show how it is calculated on the diagram") is independent of 6b and can go before or after.

## 8. Open questions for the owner

Answered by the owner on 2026-11-16 (answers first, the original question under each).

1. **Bizagi's "Poisson" arrivals** — answered: the interval is exponential (a Poisson stream of arrivals), as this design assumed. Flow's *Random (Poisson)* draws exponential intervals; no change.
   Question was: in Bizagi, does an interval "Poisson" with a mean behave like random (exponential) arrivals? A 5-minute check: one task, one resource, constant processing; compare the average resource wait in Bizagi with Flow's level 3.
2. **Calendar (level 4)** — answered: working hours and shifts have not come up in the course exercises so far. Phase 6 is not built; level 4 stays greyed with "later". Reopen if an exercise needs it.
   Question was: do the course's exercises or the exam use working hours or shifts?
3. **Bizagi simulation figures on import** — not asked yet; stays open.
4. **Kaiyo peak scenario** — answered: Kaiyo's figures may be invented, so the 18 orders a day and the second warehouse person are fine as teaching figures. Also: the owner wants simulation parameters as a second layer on the **built-in examples that already exist** (where they fit), instead of making new examples. Decision for phase 5; for phase 1 the only constraint is not to close that door: parameters live in the model (`sim` on elements, lanes and settings), so an example is a model plus its parameters and any example file can carry them.
5. **Order against F2** — answered: 6b first, F2 after.
