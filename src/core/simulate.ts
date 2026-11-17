// Discrete-event simulation of one process (stage 6b, phase 2; design: docs/simulation-6b-design.md §1–3).
// Pure TypeScript, no DOM: the same code runs in a Web Worker (phase 3) and on the main thread in slices.
//
// What one run does: N cases arrive at the pool's first start event (exponential or regular intervals); every case
// moves as tokens through the model. An activity waits its typed wait, asks one person of its lane (level 3: a FIFO
// queue per lane with `capacity` people), works its duration, lets the person go and leaves. Gateways split and join
// as BPMN says (exclusive: one branch by probability; parallel: all; inclusive: each by its own probability, joined
// by `matchingJoin`), sub-processes run their content, a terminate end ends its level at once (queued requests are
// withdrawn), boundary events happen with the chance `sim.fires` when the host's work ends. Levels as in Bizagi:
// 1 validate (paths only, no time), 2 time (no queues), 3 resources (queues for people, lane costs).
//
// Randomness: every draw has its own seed from (run seed, element id, purpose, case number, visit), and arrivals
// one stream per start event. So a what-if run (overrides) with the same seed sees the same orders with the same
// durations: the difference between two scenarios is the change, not the dice (common random numbers).
// A change to the order or keys of draws changes every fixed-seed number in the tests: say so in its commit.
import type { Flow, FlowModel, FlowNode, LoopKind, Shape, TimeUnit } from './metamodel'
import { isArtifact } from './metamodel'
import { branchShares, convertTime, isDecision, matchingJoin } from './analysis'
import { hashSeed, makeRng, streamFor, sample, validateShape, type Rng } from './random'

export type SimLevel = 1 | 2 | 3

/** Limits of one simulation (design §3.2, §3.5). */
export const SIM_LIMITS = {
  /** Cases per run, runs (replications), cases × runs. */
  maxCases: 10_000,
  maxRuns: 20,
  maxTotal: 100_000,
  /** Visits of one element by one case: beyond, the case is stuck (a loop that never lets go). */
  maxVisits: 1_000,
  /** Events per run: beyond, the run stops ("too many events; fewer cases?"). */
  maxEvents: 2_000_000,
}
export const SIM_DEFAULTS = { cases: 200, runs: 5, seed: 1 }

/** A model or settings that cannot be run: the message is for the person (the Run button stays off). */
export class SimError extends Error {}

/**
 * What-if changes of one run, applied on top of the model without editing it (phase 4). Ids are element, flow
 * and lane ids of the model; unknown ids are ignored with a note.
 */
export interface SimOverrides {
  /** Arrivals × k (peak season = 1.5). Applied after `arrivals`. */
  arrivalsFactor?: number
  /** The arrival rate per model unit, instead of the model's (a scenario of N cases in T: N / T). */
  arrivals?: number
  /** Per activity or catching event. */
  elements?: Record<string, ElementOverride>
  /** Per sequence flow out of a decision: its probability (0–1); the gateway's shares are scaled as usual. */
  probabilities?: Record<string, number>
  /** Per lane: how many people (1.5 counts as 2, below 1 as 1, with a note). */
  capacity?: Record<string, number>
}

export interface ElementOverride {
  /** A new mean processing / typed waiting time. Exponential and normal follow the mean (σ kept); uniform and triangular are scaled. */
  duration?: number
  wait?: number
  /** A new cost per run of the activity. */
  cost?: number
  /** Boundary event: a new chance of happening (0–1). */
  fires?: number
  /** "Skip this step": no wait, no work, no cost, no person; the case passes straight through. */
  skip?: boolean
}

export interface SimOptions {
  level: SimLevel
  /** The pool to run (as `Analysis.poolId`); omitted = the first process `analyseModel` would list. */
  poolId?: string
  /** Default: the model's `sim` settings, else 200 cases, 5 runs, seed 1, random (exponential) arrivals. */
  cases?: number
  runs?: number
  seed?: number
  arrivalShape?: 'exp' | 'const'
  overrides?: SimOverrides
  /** A cycle-time target (model unit): each run reports the share of completed cases with CT ≤ target. */
  target?: number
  /** Stop a run at this simulated time (model unit); cases still open are counted as open, not stuck. */
  maxTime?: number
  /** Lower caps than `SIM_LIMITS` (tests, a quick preview). */
  maxEvents?: number
  maxVisits?: number
  /** Called by `simulate()` after each slice: cases finished (all runs) of the total. */
  onProgress?: (done: number, total: number) => void
}

/** Mean, spread and extremes of one figure over a set of observations. */
export interface Agg {
  n: number
  total: number
  mean: number
  sd: number
  min: number
  max: number
}

/** A KPI over the runs: mean of the run means, 95 % t-interval half-width (undefined with one run), lowest and highest run. */
export interface Interval {
  mean: number
  half?: number
  min: number
  max: number
}

export interface RunLane {
  laneId: string
  /** Busy person-time ÷ (people × the arrival window). Above 1: the queue grows with every case. */
  utilisation: number
  busy: number
  /** Mean wait for a person per request, mean and longest queue (time-weighted over the run). */
  meanWait: number
  avgQueue: number
  maxQueue: number
}

/** One replication. Times in the model's unit; means over the completed cases. */
export interface RunStats {
  run: number
  seed: number
  started: number
  completed: number
  /** Cases that never end: a join waiting for a branch that never comes, or a loop past `maxVisits`. */
  stuck: number
  /** Cases still open when the run was stopped (`stopped`). */
  open: number
  events: number
  stopped?: 'events' | 'time'
  cycleTime: { mean: number; sd: number; min: number; max: number; p90: number }
  /**
   * Along the critical path of each case (the token that arrived last at every join): processing + typed waiting
   * + waiting for a person = cycle time exactly. `work` is all processing of the case (every branch: person-time).
   */
  processing: number
  typedWait: number
  resourceWait: number
  work: number
  cost: number
  /** Processing ÷ cycle time (of the means, as the flow analysis). */
  efficiency: number
  /** Share of completed cases with cycle time ≤ `target` (only with a target). */
  onTime?: number
  firstArrival: number
  lastArrival: number
  /** Last case finished (or stuck); the run's time window is firstArrival → end. */
  end: number
  /** Completed ÷ (end − first arrival), per model unit; time-weighted number of open cases over the same window. */
  throughput: number
  wip: number
  lanes: RunLane[]
}

export interface ElementStats {
  id: string
  name: string
  type: FlowNode['type']
  /** Entries and exits over all runs (an activity exits when its work, with repeats, is done). */
  started: number
  completed: number
  /** Processing per work unit, waiting for a person per request, typed waiting per visit. */
  time: Agg
  resourceWait: Agg
  typedWait: Agg
  /** Task costs and lane per-use costs; lane hourly costs. Totals over all runs. */
  fixedCost: number
  unitCost: number
}

export interface LaneStats {
  laneId: string
  name: string
  /** People counted in the run. */
  capacity: number
  utilisation: Interval
  busy: number
  fixedCost: number
  unitCost: number
  totalCost: number
  /** Mean over runs of the time-weighted queue; longest queue seen. */
  avgQueue: number
  maxQueue: number
  requests: number
  /** Queued requests removed by a terminate end (or a stuck case). */
  withdrawn: number
  meanWait: number
}

export type KpiKey = 'cycleTime' | 'processing' | 'typedWait' | 'resourceWait' | 'work' | 'cost' | 'efficiency' | 'throughput' | 'wip' | 'cycleTimeSd' | 'onTime'

export interface SimResult {
  level: SimLevel
  poolId?: string
  name: string
  unit: TimeUnit
  seed: number
  cases: number
  /** Effective arrival rate (per model unit) and shape. */
  arrivals: number
  arrivalShape: 'exp' | 'const'
  target?: number
  runs: RunStats[]
  /** Mean over runs with a 95 % interval. `onTime` only with a target. */
  kpis: Partial<Record<KpiKey, Interval>>
  started: number
  completed: number
  stuck: number
  open: number
  elements: ElementStats[]
  lanes: LaneStats[]
  /** Where stuck cases were held (a join, or the element of an endless loop), with how many cases. */
  stuckAt: { id: string; name: string; cases: number }[]
  /** Elements of the run's levels that no case reached. */
  unreached: string[]
  /** Some lane is busy ≥ 100 % of the arrival window: the queue grows with every case and never settles. */
  unstable: boolean
  stopped?: 'events' | 'time'
  notes: string[]
}

// ---------------------------------------------------------------- statistics helpers

class Acc {
  n = 0
  total = 0
  sq = 0
  min = Infinity
  max = -Infinity
  add(x: number) {
    this.n++
    this.total += x
    this.sq += x * x
    if (x < this.min) this.min = x
    if (x > this.max) this.max = x
  }
  agg(): Agg {
    const mean = this.n ? this.total / this.n : 0
    const v = this.n > 1 ? Math.max(0, (this.sq - this.n * mean * mean) / (this.n - 1)) : 0
    return { n: this.n, total: this.total, mean, sd: Math.sqrt(v), min: this.n ? this.min : 0, max: this.n ? this.max : 0 }
  }
}

/** t quantiles for a two-sided 95 % interval, by degrees of freedom 1–29 (runs ≤ 20 need at most 19). */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045]
export const t95 = (df: number) => (df < 1 ? NaN : df <= T95.length ? T95[df - 1] : 1.96)

/** Mean of values with its 95 % t-interval (n − 1 degrees of freedom). */
export function interval(xs: number[]): Interval {
  const n = xs.length
  if (!n) return { mean: 0, min: 0, max: 0 }
  const mean = xs.reduce((s, x) => s + x, 0) / n
  const out: Interval = { mean, min: Math.min(...xs), max: Math.max(...xs) }
  if (n > 1) {
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))
    out.half = (t95(n - 1) * sd) / Math.sqrt(n)
  }
  return out
}

// ---------------------------------------------------------------- the compiled model

interface Level {
  ids: Set<string>
  start: string
}

interface Boundary {
  id: string
  p: number
  interrupting: boolean
}

interface Info {
  node: FlowNode
  name: string
  outs: Flow[]
  ins: Flow[]
  role: 'activity' | 'catch' | 'end' | 'gateway' | 'pass'
  terminate: boolean
  /** Sub-process with steps inside. */
  content?: Level
  /** Lane index for a person (level 3), else −1. */
  lane: number
  boundaries: Boundary[]
  /** One branch: cumulative shares. */
  pick?: { flows: Flow[]; cum: number[] }
  /** Inclusive split: each branch on its own; the default when none is drawn. */
  inclusive?: { flows: Flow[]; p: number[]; fallback: Flow; join?: string }
  split: boolean
  pjoin: boolean
  ijoin: boolean
  // figures (after overrides and the level)
  duration: number
  durationShape?: Shape
  wait: number
  waitShape?: Shape
  cost: number
  repeats: number
  loop?: LoopKind
  skip: boolean
}

interface LaneDef {
  id: string
  name: string
  cap: number
  useCost: number
  hourlyCost: number
}

// ---------------------------------------------------------------- run state

type Triple = [proc: number, typed: number, res: number]

interface Token {
  c: Case
  scope: Scope
  node: string
  via?: string
  acc: Triple
  alive: boolean
  /** Lane held / queued at (−1 none). */
  holding: number
  queued: number
  readyAt: number
  workStart: number
  workLen: number
  visit: number
  reps: number
  unitsLeft: number
  rep: number
  childLeft: number
  /** Multi-instance copy: the activity's own token it reports to. */
  parent?: Token
  arrivedAt: number
}

interface Scope {
  id: number
  c: Case
  live: number
  tokens: Set<Token>
  children: Set<Scope>
  parent?: Scope
  /** The token running the sub-process unit this scope is the content of. */
  owner?: Token
  last?: { t: number; acc: Triple }
  pj: Map<string, Map<string, Token[]>>
  ij: Map<string, { expected: number; got: Token[] }[]>
}

interface Case {
  no: number
  arrival: number
  top: Scope
  visits: Map<string, number>
  cost: number
  work: number
  over: boolean
}

const ENTER = 0
const WAITED = 1
const WORKDONE = 2
const CAUGHT = 3
const ARRIVE = 4

interface Ev {
  t: number
  seq: number
  kind: number
  tok?: Token
}

/** Binary heap ordered by (time, sequence): ties keep the order they were scheduled in, so a run is deterministic. */
class Heap {
  private a: Ev[] = []
  get size() {
    return this.a.length
  }
  private less(i: number, j: number) {
    const x = this.a[i]
    const y = this.a[j]
    return x.t < y.t || (x.t === y.t && x.seq < y.seq)
  }
  push(e: Ev) {
    const a = this.a
    a.push(e)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(i, p)) break
      ;[a[i], a[p]] = [a[p], a[i]]
      i = p
    }
  }
  peek(): Ev | undefined {
    return this.a[0]
  }
  pop(): Ev | undefined {
    const a = this.a
    if (!a.length) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let s = i
        if (l < a.length && this.less(l, s)) s = l
        if (r < a.length && this.less(r, s)) s = r
        if (s === i) break
        ;[a[i], a[s]] = [a[s], a[i]]
        i = s
      }
    }
    return top
  }
}

interface LaneRun {
  busyNow: number
  queue: Token[]
  head: number
  qlen: number
  area: number
  lastT: number
  maxQ: number
  busyTime: number
  requests: number
  withdrawn: number
  waitSum: number
  fixed: number
  unit: number
}

interface ElemRun {
  started: number
  completed: number
  time: Acc
  res: Acc
  typed: Acc
  fixed: number
  unit: number
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

// ---------------------------------------------------------------- the simulation

/**
 * A simulation of one process: `step(maxEvents)` runs a slice and says whether everything is done; `result()` gives
 * the figures (partial while running). Throws `SimError` when the model or the settings cannot be run.
 */
export class Simulation {
  readonly level: SimLevel
  readonly cases: number
  readonly runsTotal: number
  readonly seed: number
  readonly arrivals: number
  readonly arrivalShape: 'exp' | 'const'
  readonly unit: TimeUnit
  private readonly name: string
  private readonly poolId?: string
  private readonly target?: number
  private readonly maxTime: number
  private readonly maxEvents: number
  private readonly maxVisits: number
  private readonly notes = new Set<string>()
  private readonly infos = new Map<string, Info>()
  private readonly lanes: LaneDef[] = []
  private readonly startId: string
  private readonly elems = new Map<string, ElemRun>()
  private readonly runStats: RunStats[] = []
  private readonly laneTotals: { busy: number; fixed: number; unit: number; requests: number; withdrawn: number; waitSum: number; maxQ: number; avgQ: number[]; util: number[] }[] = []
  private readonly stuckAt = new Map<string, number>()
  private stopped?: 'events'
  private runStop?: 'events' | 'time'
  private timeStops = 0
  private finishedCases = 0

  // the current run
  private run = -1
  private runSeed = 0
  private now = 0
  private heap = new Heap()
  private seq = 0
  private events = 0
  private arrRng: Rng = Math.random
  private started = 0
  private nextScope = 0
  private caseList: Case[] = []
  private cts: number[] = []
  private sums = { proc: 0, typed: 0, res: 0, work: 0, cost: 0 }
  private completed = 0
  private stuck = 0
  private openCount = 0
  private wipArea = 0
  private wipT = 0
  private firstArrival = 0
  private lastArrival = 0
  private lastLeave = 0
  private lr: LaneRun[] = []
  private runDone = true

  constructor(m: FlowModel, o: SimOptions) {
    if (![1, 2, 3].includes(o.level)) throw new SimError('Level must be 1, 2 or 3 (level 4, calendar, comes later)')
    this.level = o.level
    const s = m.sim ?? {}
    const cases = o.cases ?? s.cases ?? SIM_DEFAULTS.cases
    const runs = o.runs ?? s.runs ?? SIM_DEFAULTS.runs
    if (!Number.isInteger(cases) || cases < 1 || cases > SIM_LIMITS.maxCases) throw new SimError(`Cases per run: a whole number from 1 to ${SIM_LIMITS.maxCases}`)
    if (!Number.isInteger(runs) || runs < 1 || runs > SIM_LIMITS.maxRuns) throw new SimError(`Runs: a whole number from 1 to ${SIM_LIMITS.maxRuns}`)
    if (cases * runs > SIM_LIMITS.maxTotal) throw new SimError(`Cases × runs is at most ${SIM_LIMITS.maxTotal.toLocaleString('en')}: fewer cases or fewer runs`)
    this.cases = cases
    this.runsTotal = runs
    const seed = o.seed ?? s.seed ?? SIM_DEFAULTS.seed
    this.seed = fin(seed) ? Math.trunc(seed) : SIM_DEFAULTS.seed
    this.arrivalShape = o.arrivalShape ?? s.arrivalShape ?? 'exp'
    this.unit = s.unit ?? 'min'
    this.target = fin(o.target) ? o.target : undefined
    this.maxTime = fin(o.maxTime) && o.maxTime > 0 ? o.maxTime : Infinity
    this.maxEvents = Math.min(SIM_LIMITS.maxEvents, o.maxEvents ?? Infinity)
    this.maxVisits = Math.min(SIM_LIMITS.maxVisits, o.maxVisits ?? Infinity)
    const ov = o.overrides ?? {}

    // Arrivals: levels 1–2 do not need them (no queue), level 3 does.
    let rate = fin(ov.arrivals) ? ov.arrivals : s.arrivals
    if (!(fin(rate) && rate > 0)) {
      if (this.level === 3) throw new SimError(`How many new cases per ${this.unit === 'd' ? 'day' : this.unit === 'h' ? 'hour' : 'minute'}? Level 3 needs the arrival rate`)
      this.note('No arrival rate: the run uses 1 case per time unit (it does not change levels 1 and 2)')
      rate = 1
    }
    if (ov.arrivalsFactor !== undefined) {
      if (!(fin(ov.arrivalsFactor) && ov.arrivalsFactor > 0)) throw new SimError('Arrivals × k: k must be above 0')
      rate *= ov.arrivalsFactor
    }
    this.arrivals = rate

    // The process: the pool asked for, else the first one the analysis lists.
    const procs: { poolId?: string; name: string; top: FlowNode[] }[] = []
    for (const p of m.participants) {
      if (!p.processId) continue
      const top = m.nodes.filter((n) => n.participantId === p.id && !n.parentId)
      if (top.some((n) => !isArtifact(n))) procs.push({ poolId: p.id, name: p.name || 'Pool', top })
    }
    const free = m.nodes.filter((n) => (!n.participantId || !m.participants.some((p) => p.id === n.participantId)) && !n.parentId)
    if (free.some((n) => !isArtifact(n))) procs.push({ name: m.name || 'Process', top: free })
    const proc = o.poolId !== undefined ? procs.find((p) => p.poolId === o.poolId) : procs[0]
    if (!proc) throw new SimError(o.poolId !== undefined && procs.length ? `No process in pool ${o.poolId}` : 'Nothing to run: draw a start event first')
    this.name = proc.name
    this.poolId = proc.poolId

    // Unknown ids in the overrides.
    const known = new Set([...m.nodes.map((n) => n.id), ...m.flows.map((f) => f.id), ...m.lanes.map((l) => l.id)])
    for (const id of [...Object.keys(ov.elements ?? {}), ...Object.keys(ov.probabilities ?? {}), ...Object.keys(ov.capacity ?? {})])
      if (!known.has(id)) this.note(`What-if: no element ${id} in the model (ignored)`)

    const lv = this.compileLevel(m, proc.top, ov, true)
    if (!lv) throw new SimError('Draw a start event first')
    this.startId = lv.start
    if (this.level === 3) {
      const outside = [...this.infos.values()].filter((i) => i.role === 'activity' && !i.content && !i.skip && i.lane < 0)
      if (outside.length) this.note(`${outside.length} ${outside.length === 1 ? 'activity is' : 'activities are'} outside every lane: no one to wait for (add lanes to model who does the work)`)
    }
    for (const id of this.infos.keys()) this.elems.set(id, { started: 0, completed: 0, time: new Acc(), res: new Acc(), typed: new Acc(), fixed: 0, unit: 0 })
    this.lanes.forEach(() => this.laneTotals.push({ busy: 0, fixed: 0, unit: 0, requests: 0, withdrawn: 0, waitSum: 0, maxQ: 0, avgQ: [], util: [] }))
  }

  private note(t: string) {
    this.notes.add(t)
  }

  /** The steps of one process level (a pool's top level, a sub-process's content), with their figures after the overrides. */
  private compileLevel(m: FlowModel, nodes: FlowNode[], ov: SimOverrides, top: boolean): Level | undefined {
    const steps = nodes.filter((n) => !isArtifact(n))
    const ids = new Set(steps.map((n) => n.id))
    const seq = m.flows.filter((f) => f.kind === 'sequence' && ids.has(f.source) && ids.has(f.target))
    const probOf = (f: Flow): number | undefined => {
      const p = ov.probabilities?.[f.id] ?? f.probability
      if (p === undefined) return undefined
      if (!fin(p) || p < 0) {
        this.note(`A probability below 0 counts as 0 (flow ${f.name || f.id})`)
        return 0
      }
      return p
    }
    const starts = steps.filter((n) => n.type === 'event' && n.position === 'start')
    const first = starts.length ? starts : top ? [] : steps.filter((n) => !(n.type === 'event' && n.position === 'boundary') && !seq.some((f) => f.target === n.id))
    if (!first.length) return undefined
    if (first.length > 1) this.note(`${first.length} start points in ${top ? 'the process' : 'a sub-process'}: the cases start at the first (${first[0].name || first[0].id}) only`)
    const level: Level = { ids, start: first[0].id }
    const L = this.level

    for (const n of steps) {
      const outs = seq.filter((f) => f.source === n.id)
      const ins = seq.filter((f) => f.target === n.id)
      const name = n.name || n.id
      const sim = n.sim ?? {}
      const eo = ov.elements?.[n.id]
      const info: Info = {
        node: n,
        name,
        outs,
        ins,
        role: 'pass',
        terminate: false,
        lane: -1,
        boundaries: [],
        split: false,
        pjoin: false,
        ijoin: false,
        duration: 0,
        wait: 0,
        cost: 0,
        repeats: 1,
        skip: !!eo?.skip,
      }
      if (n.type === 'task' || n.type === 'subProcess') {
        info.role = 'activity'
        info.loop = n.loop
        if (n.loop) {
          const r = sim.repeats ?? 1
          info.repeats = fin(r) && r >= 0 ? r : 1
        }
        const content = n.type === 'subProcess' ? m.nodes.filter((x) => x.parentId === n.id) : []
        if (content.some((x) => !isArtifact(x)) && !info.skip) {
          info.content = this.compileLevel(m, content, ov, false)
          if (!info.content) this.note(`${name}: its content has no start, the sub-process counts as empty`)
          if (sim.duration !== undefined) this.note(`${name}: its steps are run, not its own duration`)
        } else {
          ;[info.duration, info.durationShape] = this.figure(name, 'duration', sim.duration, sim.durationShape, eo?.duration)
          if (sim.duration === undefined && eo?.duration === undefined && L >= 2 && !info.skip) this.note('Activities without a duration count as 0')
          if (n.laneId && !info.skip) info.lane = this.laneIndex(m, n.laneId, ov)
        }
        ;[info.wait, info.waitShape] = this.figure(name, 'wait', sim.wait, sim.waitShape, eo?.wait)
        const cost = eo?.cost ?? sim.cost ?? 0
        info.cost = fin(cost) ? cost : 0
      } else if (n.type === 'event') {
        if (n.position === 'end') {
          info.role = 'end'
          info.terminate = n.trigger === 'terminate'
        } else if (n.position === 'intermediate' && !n.throwing) {
          info.role = 'catch'
          ;[info.wait, info.waitShape] = this.figure(name, 'wait', sim.wait, sim.waitShape, eo?.wait)
        }
      } else if (n.type === 'gateway') {
        info.role = 'gateway'
        if (n.kind === 'parallel' && ins.length > 1) info.pjoin = true
        if (n.kind === 'inclusive' && ins.length > 1) info.ijoin = true
      }
      if (info.skip || L === 1) {
        info.duration = info.wait = info.cost = 0
        info.durationShape = info.waitShape = undefined
        if (info.skip) info.lane = -1
      }

      // Leaving: one branch, each branch on its own (inclusive), or all.
      const eff = outs.map((f) => ({ ...f, probability: probOf(f) }))
      if (isDecision(n, outs.length)) {
        if (n.type === 'gateway' && n.kind === 'inclusive') {
          const shares = branchShares(eff, (t) => this.note(t), name)
          const dflt = outs.find((f) => f.id === n.defaultFlow)
          const own = eff.filter((f) => f.id !== dflt?.id)
          const p = own.map((f) => Math.min(1, f.probability ?? shares.get(f.id)!))
          const best = dflt ?? own[p.indexOf(Math.max(...p))]
          info.inclusive = { flows: own, p, fallback: best, join: matchingJoin(m, n.id, ids) }
        } else {
          const shares = branchShares(eff, (t) => this.note(t), name)
          let c = 0
          info.pick = { flows: outs, cum: outs.map((f) => (c += shares.get(f.id)!)) }
        }
      } else if (outs.length > 1) info.split = true
      this.infos.set(n.id, info)
    }

    // Boundary events with a chance of happening, on their hosts.
    for (const b of steps) {
      if (!(b.type === 'event' && b.position === 'boundary' && b.attachedTo && ids.has(b.attachedTo))) continue
      if (!seq.some((f) => f.source === b.id)) continue
      const raw = ov.elements?.[b.id]?.fires ?? b.sim?.fires ?? 0
      const p = fin(raw) ? Math.min(1, Math.max(0, raw)) : 0
      if (!(p > 0)) {
        this.note('Paths after boundary events are not run unless the event has a chance of happening')
        continue
      }
      this.infos.get(b.attachedTo)!.boundaries.push({ id: b.id, p, interrupting: b.interrupting !== false })
    }
    for (const i of this.infos.values()) {
      const sum = i.boundaries.filter((b) => b.interrupting).reduce((s, b) => s + b.p, 0)
      if (sum > 1 + 1e-9) this.note(`${i.name}: the interrupting boundary events add up to ${Math.round(sum * 100)} %, scaled to 100 %`)
    }
    return level
  }

  /** A time figure with its shape after an override; bad numbers count as 0 or constant, with a note. */
  private figure(name: string, what: 'duration' | 'wait', raw: number | undefined, shape: Shape | undefined, override: number | undefined): [number, Shape | undefined] {
    let mean = raw ?? 0
    if (!fin(mean) || mean < 0) {
      this.note(`${name}: a ${what} below 0 counts as 0`)
      mean = 0
    }
    let sh = shape
    if (sh && validateShape(sh)) {
      this.note(`${name}: the shape of its ${what} is not valid (${validateShape(sh)}), counted as constant`)
      sh = undefined
    }
    if (override !== undefined) {
      const v = fin(override) && override >= 0 ? override : 0
      if (sh && (sh.kind === 'uniform' || sh.kind === 'triangular')) {
        const old = sh.kind === 'uniform' ? (sh.min + sh.max) / 2 : (sh.min + sh.mode + sh.max) / 3
        const k = old > 0 ? v / old : 0
        sh = old > 0 ? (sh.kind === 'uniform' ? { kind: 'uniform', min: sh.min * k, max: sh.max * k } : { kind: 'triangular', min: sh.min * k, mode: sh.mode * k, max: sh.max * k }) : undefined
      }
      mean = v
    }
    if (sh?.kind === 'normal' && sh.sd <= 0) sh = undefined
    return [mean, sh]
  }

  private laneIndex(m: FlowModel, laneId: string, ov: SimOverrides): number {
    const at = this.lanes.findIndex((l) => l.id === laneId)
    if (at >= 0) return at
    const l = m.lanes.find((x) => x.id === laneId)
    if (!l) return -1
    const name = l.name || 'Lane'
    const raw = ov.capacity?.[laneId] ?? l.capacity ?? 1
    let cap = fin(raw) ? Math.round(raw) : 1
    if (!fin(raw) || raw < 1) {
      this.note(`${name}: capacity ${fin(raw) ? raw : '?'} counts as 1 person (at least one person does the work)`)
      cap = 1
    } else if (!Number.isInteger(raw)) this.note(`${name}: capacity ${raw} counts as ${cap} people in the run`)
    this.lanes.push({ id: laneId, name, cap, useCost: fin(l.useCost) ? l.useCost : 0, hourlyCost: fin(l.hourlyCost) ? l.hourlyCost : 0 })
    return this.lanes.length - 1
  }

  /** Cases finished (completed or stuck) over all runs, of cases × runs. */
  progress(): { done: number; total: number } {
    return { done: this.finishedCases, total: this.cases * this.runsTotal }
  }

  get done(): boolean {
    return !!this.stopped || (this.run >= this.runsTotal - 1 && this.runDone)
  }

  /** Runs at most `maxEvents` events; true when every run is finished. */
  step(maxEvents = 20_000): boolean {
    let budget = maxEvents
    while (!this.done && budget > 0) {
      if (this.runDone) this.startRun()
      budget = this.advance(budget)
    }
    return this.done
  }

  // ---------------------------------------------------------------- one run

  private startRun() {
    this.run++
    this.runSeed = this.seed + this.run
    this.now = 0
    this.heap = new Heap()
    this.seq = 0
    this.events = 0
    this.arrRng = streamFor(this.runSeed, this.startId, 'arrival')
    this.started = 0
    this.caseList = []
    this.cts = []
    this.sums = { proc: 0, typed: 0, res: 0, work: 0, cost: 0 }
    this.completed = this.stuck = this.openCount = 0
    this.wipArea = this.wipT = this.firstArrival = this.lastArrival = this.lastLeave = 0
    this.lr = this.lanes.map(() => ({ busyNow: 0, queue: [], head: 0, qlen: 0, area: 0, lastT: 0, maxQ: 0, busyTime: 0, requests: 0, withdrawn: 0, waitSum: 0, fixed: 0, unit: 0 }))
    this.runDone = false
    this.runStop = undefined
    this.schedule(0, ARRIVE)
  }

  private schedule(t: number, kind: number, tok?: Token) {
    this.heap.push({ t, seq: this.seq++, kind, tok })
  }

  private advance(budget: number): number {
    while (budget > 0) {
      const e = this.heap.peek()
      if (!e) {
        this.endRun()
        return budget
      }
      if (e.t > this.maxTime) {
        this.runStop = 'time'
        this.timeStops++
        this.note(`A run stopped at time ${this.maxTime} (time limit); its open cases are not counted as stuck`)
        this.endRun()
        return budget
      }
      if (this.events >= this.maxEvents) {
        this.stopped = this.runStop = 'events'
        this.note('Too many events in one run; fewer cases? (the run stopped)')
        this.endRun()
        return budget
      }
      this.heap.pop()
      budget--
      this.events++
      this.now = e.t
      const tok = e.tok
      if (tok && !tok.alive) continue
      switch (e.kind) {
        case ARRIVE:
          this.arrive()
          break
        case ENTER:
          this.enter(tok!)
          break
        case WAITED:
          this.beginUnits(tok!)
          break
        case WORKDONE:
          this.workDone(tok!)
          break
        case CAUGHT:
          this.leave(tok!)
          break
      }
    }
    return budget
  }

  private rng(id: string, purpose: string, c: Case, k: number | string): Rng {
    return makeRng(hashSeed(this.runSeed, id, `${purpose}|${c.no}|${k}`))
  }

  private wipTo(t: number) {
    this.wipArea += this.openCount * (t - this.wipT)
    this.wipT = t
  }

  private arrive() {
    const no = this.started++
    if (no === 0) {
      this.firstArrival = this.now
      this.wipT = this.now
      for (const l of this.lr) l.lastT = this.now
    }
    this.lastArrival = this.now
    this.wipTo(this.now)
    this.openCount++
    const top = this.newScope(undefined)
    const c: Case = { no, arrival: this.now, top, visits: new Map(), cost: 0, work: 0, over: false }
    top.c = c
    this.caseList.push(c)
    const tok = this.newToken(c, top, this.startId, [0, 0, 0])
    top.live = 1
    this.enter(tok)
    if (this.started < this.cases) {
      const mean = 1 / this.arrivals
      const gap = this.arrivalShape === 'const' ? mean : -mean * Math.log(1 - this.arrRng())
      this.schedule(this.now + gap, ARRIVE)
    }
  }

  private newScope(parent: Scope | undefined, c?: Case): Scope {
    const s: Scope = { id: this.nextScope++, c: c!, live: 0, tokens: new Set(), children: new Set(), parent, pj: new Map(), ij: new Map() }
    parent?.children.add(s)
    return s
  }

  private newToken(c: Case, scope: Scope, node: string, acc: Triple): Token {
    const t: Token = { c, scope, node, acc: [...acc] as Triple, alive: true, holding: -1, queued: -1, readyAt: 0, workStart: 0, workLen: 0, visit: 0, reps: 0, unitsLeft: 0, rep: 0, childLeft: 0, arrivedAt: 0 }
    scope.tokens.add(t)
    return t
  }

  /** A second token next to `tok` (a parallel branch, a non-interrupting boundary path), entering `node` now. */
  private fork(tok: Token, node: string, via?: string) {
    const t = this.newToken(tok.c, tok.scope, node, tok.acc)
    t.via = via
    tok.scope.live++
    this.schedule(this.now, ENTER, t)
  }

  private moveTo(tok: Token, node: string, via?: string) {
    tok.node = node
    tok.via = via
    this.schedule(this.now, ENTER, tok)
  }

  private enter(tok: Token) {
    const c = tok.c
    const id = tok.node
    const info = this.infos.get(id)!
    const v = (c.visits.get(id) ?? 0) + 1
    c.visits.set(id, v)
    if (v > this.maxVisits) {
      this.note(`${info.name}: a case came here more than ${this.maxVisits} times (a loop that never lets go); such cases count as stuck`)
      this.stuckAt.set(id, (this.stuckAt.get(id) ?? 0) + 1)
      this.caseOver(c, true)
      return
    }
    tok.visit = v
    tok.arrivedAt = this.now
    const el = this.elems.get(id)!
    el.started++
    switch (info.role) {
      case 'activity':
        return this.startActivity(tok, info)
      case 'catch': {
        const w = this.draw(info.wait, info.waitShape, id, 'wait', tok, v)
        tok.acc[1] += w
        el.typed.add(w)
        el.completed++
        if (w > 0) this.schedule(this.now + w, CAUGHT, tok)
        else this.leave(tok)
        return
      }
      case 'end':
        el.completed++
        if (info.terminate) return this.terminate(tok)
        return this.endToken(tok)
      case 'gateway':
        if (info.pjoin) return this.parallelJoin(tok, info)
        if (info.ijoin) return this.inclusiveJoin(tok)
        el.completed++
        return this.leave(tok)
      default:
        el.completed++
        return this.leave(tok)
    }
  }

  private draw(mean: number, shape: Shape | undefined, id: string, purpose: string, tok: Token, k: number | string): number {
    if (!shape) return mean
    const x = sample(shape, mean, this.rng(id, purpose, tok.c, k), () => this.note(`${this.infos.get(id)!.name}: the cut leaves almost nothing of this normal; values are drawn evenly inside the cut`))
    return x > 0 ? x : 0
  }

  // ---------------------------------------------------------------- activities

  private startActivity(tok: Token, info: Info) {
    const id = tok.node
    if (info.skip) {
      this.elems.get(id)!.completed++
      return this.leave(tok)
    }
    const w = this.draw(info.wait, info.waitShape, id, 'wait', tok, tok.visit)
    tok.acc[1] += w
    this.elems.get(id)!.typed.add(w)
    // Runs per visit: a whole number of repeats, a fraction is one more run with that chance (the mean stays).
    let reps = info.loop ? Math.floor(info.repeats) : 1
    const frac = info.loop ? info.repeats - reps : 0
    if (frac > 1e-12 && this.rng(id, 'repeats', tok.c, tok.visit)() < frac) reps++
    tok.reps = reps
    if (info.content && info.cost) this.charge(tok, id, info.cost, 0, -1)
    if (w > 0) this.schedule(this.now + w, WAITED, tok)
    else this.beginUnits(tok)
  }

  private beginUnits(tok: Token) {
    const info = this.infos.get(tok.node)!
    const reps = tok.reps
    if (reps <= 0) return this.finishActivity(tok)
    if (info.loop === 'parallel' && reps > 1) {
      tok.childLeft = reps
      for (let i = 0; i < reps; i++) {
        const ch = this.newToken(tok.c, tok.scope, tok.node, tok.acc)
        ch.parent = tok
        ch.visit = tok.visit
        ch.rep = i
        tok.scope.live++
        this.runUnit(ch)
      }
      return
    }
    tok.unitsLeft = reps
    tok.rep = 0
    this.runUnit(tok)
  }

  /** One run of the activity's work: its content (a sub-process) or asking a person and working. */
  private runUnit(tok: Token) {
    const info = this.infos.get(tok.node)!
    if (info.content) {
      const s = this.newScope(tok.scope, tok.c)
      s.owner = tok
      s.live = 1
      this.moveTokenInto(s, info.content.start, tok.acc)
      return
    }
    tok.readyAt = this.now
    const li = this.level === 3 ? info.lane : -1
    if (li < 0) return this.startWork(tok, -1)
    const lane = this.lr[li]
    lane.requests++
    if (lane.busyNow < this.lanes[li].cap) return this.startWork(tok, li)
    this.queueTo(lane, this.now)
    lane.queue.push(tok)
    lane.qlen++
    if (lane.qlen > lane.maxQ) lane.maxQ = lane.qlen
    tok.queued = li
  }

  private moveTokenInto(s: Scope, start: string, acc: Triple) {
    const t = this.newToken(s.c, s, start, acc)
    this.schedule(this.now, ENTER, t)
  }

  private queueTo(lane: LaneRun, t: number) {
    lane.area += lane.qlen * (t - lane.lastT)
    lane.lastT = t
  }

  private startWork(tok: Token, li: number) {
    const id = tok.node
    const info = this.infos.get(id)!
    const el = this.elems.get(id)!
    const wait = this.now - tok.readyAt
    tok.acc[2] += wait
    el.res.add(wait)
    const d = this.draw(info.duration, info.durationShape, id, 'duration', tok, `${tok.visit}.${tok.rep}`)
    tok.acc[0] += d
    tok.c.work += d
    el.time.add(d)
    if (li >= 0) {
      const lane = this.lr[li]
      lane.busyNow++
      lane.waitSum += wait
      tok.holding = li
    } else if (info.lane >= 0) {
      // Level 2: no queue (as many people as needed); the lane still shows its load, as the formula does.
      const lane = this.lr[info.lane]
      lane.requests++
      lane.busyTime += d
    }
    tok.workStart = this.now
    tok.workLen = d
    // Costs belong to levels 2 and 3 (level 1 has none: its figures are all 0).
    const ln = info.lane >= 0 ? this.lanes[info.lane] : undefined
    this.charge(tok, id, info.cost + (ln?.useCost ?? 0), ln ? ln.hourlyCost * convertTime(d, this.unit, 'h') : 0, info.lane)
    this.schedule(this.now + d, WORKDONE, tok)
  }

  private charge(tok: Token, id: string, fixed: number, unit: number, li: number) {
    if (this.level === 1) return
    tok.c.cost += fixed + unit
    const el = this.elems.get(id)!
    el.fixed += fixed
    el.unit += unit
    if (li >= 0) {
      const ln = this.lanes[li]
      this.lr[li].fixed += ln.useCost
      this.lr[li].unit += unit
    }
  }

  private release(tok: Token) {
    const li = tok.holding
    if (li < 0) return
    tok.holding = -1
    const lane = this.lr[li]
    lane.busyNow--
    lane.busyTime += this.now - tok.workStart
    // The next in line (requests withdrawn by a terminate are skipped).
    while (lane.head < lane.queue.length) {
      const next = lane.queue[lane.head++]
      if (!next.alive || next.queued !== li) continue
      this.queueTo(lane, this.now)
      lane.qlen--
      next.queued = -1
      this.startWork(next, li)
      break
    }
    if (lane.head > 1024 && lane.head * 2 > lane.queue.length) {
      lane.queue = lane.queue.slice(lane.head)
      lane.head = 0
    }
  }

  private workDone(tok: Token) {
    this.release(tok)
    this.unitDone(tok)
  }

  private unitDone(tok: Token) {
    const p = tok.parent
    if (p) {
      // A multi-instance copy is done: the activity goes on when the last copy is (its path is the critical one).
      tok.alive = false
      tok.scope.tokens.delete(tok)
      tok.scope.live--
      if (--p.childLeft === 0) {
        p.acc = [...tok.acc] as Triple
        this.finishActivity(p)
      }
      return
    }
    if (--tok.unitsLeft > 0) {
      tok.rep++
      return this.runUnit(tok)
    }
    this.finishActivity(tok)
  }

  /** The work is done: boundary events may happen, then the token leaves by the normal flow or a boundary path. */
  private finishActivity(tok: Token) {
    const id = tok.node
    const info = this.infos.get(id)!
    this.elems.get(id)!.completed++
    if (info.boundaries.length) {
      const inter = info.boundaries.filter((b) => b.interrupting)
      for (const b of info.boundaries) if (!b.interrupting && this.rng(b.id, 'fires', tok.c, tok.visit)() < b.p) this.fork(tok, b.id)
      if (inter.length) {
        const sum = inter.reduce((s, b) => s + b.p, 0)
        const k = sum > 1 ? 1 / sum : 1
        const u = this.rng(id, 'boundary', tok.c, tok.visit)()
        let c = 0
        for (const b of inter) {
          c += b.p * k
          if (u < c) return this.moveTo(tok, b.id)
        }
      }
    }
    this.leave(tok)
  }

  // ---------------------------------------------------------------- flows and gateways

  private leave(tok: Token) {
    const info = this.infos.get(tok.node)!
    const outs = info.outs
    if (!outs.length) return this.endToken(tok)
    if (info.pick) {
      const u = this.rng(tok.node, 'branch', tok.c, tok.visit)()
      const { flows, cum } = info.pick
      let i = cum.findIndex((c) => u < c)
      if (i < 0) i = flows.length - 1
      return this.moveTo(tok, flows[i].target, flows[i].id)
    }
    if (info.inclusive) {
      const { flows, p, fallback, join } = info.inclusive
      const r = this.rng(tok.node, 'branch', tok.c, tok.visit)
      let taken = flows.filter((_, i) => r() < p[i])
      if (!taken.length) taken = [fallback]
      if (join && this.infos.get(join)?.ijoin) {
        const list = tok.scope.ij.get(join) ?? []
        list.push({ expected: taken.length, got: [] })
        tok.scope.ij.set(join, list)
      }
      for (const f of taken.slice(1)) this.fork(tok, f.target, f.id)
      return this.moveTo(tok, taken[0].target, taken[0].id)
    }
    if (info.split) {
      for (const f of outs.slice(1)) this.fork(tok, f.target, f.id)
    }
    this.moveTo(tok, outs[0].target, outs[0].id)
  }

  /** Several tokens of one case meet: the last to arrive goes on (ties: the one with more processing), the others end. */
  private merge(tok: Token, group: Token[]) {
    let best = group[0]
    for (const t of group) if (t.arrivedAt > best.arrivedAt || (t.arrivedAt === best.arrivedAt && t.acc[0] > best.acc[0])) best = t
    const acc = [...best.acc] as Triple
    for (const t of group) {
      if (t === tok) continue
      t.alive = false
      tok.scope.tokens.delete(t)
      tok.scope.live--
    }
    tok.acc = acc
    this.elems.get(tok.node)!.completed++
    this.leave(tok)
  }

  private parallelJoin(tok: Token, info: Info) {
    const s = tok.scope
    const waiting = s.pj.get(tok.node) ?? new Map<string, Token[]>()
    s.pj.set(tok.node, waiting)
    const via = tok.via ?? ''
    waiting.set(via, [...(waiting.get(via) ?? []), tok])
    if (!info.ins.every((f) => (waiting.get(f.id)?.length ?? 0) > 0)) return
    const group = info.ins.map((f) => waiting.get(f.id)!.shift()!)
    this.merge(tok, group)
  }

  private inclusiveJoin(tok: Token) {
    const list = tok.scope.ij.get(tok.node)
    if (!list?.length) {
      // No split of this case is waiting here: the join passes the token on (an OR merge).
      this.elems.get(tok.node)!.completed++
      return this.leave(tok)
    }
    const e = list[0]
    e.got.push(tok)
    if (e.got.length < e.expected) return
    list.shift()
    this.merge(tok, e.got)
  }

  // ---------------------------------------------------------------- ends

  private endToken(tok: Token) {
    const s = tok.scope
    tok.alive = false
    s.tokens.delete(tok)
    s.live--
    if (!s.last || this.now > s.last.t || tok.acc[0] > s.last.acc[0]) s.last = { t: this.now, acc: [...tok.acc] as Triple }
    if (s.live === 0) this.scopeDone(s)
  }

  /** A terminate end: everything else of its level (and below) stops now, queued requests are withdrawn. */
  private terminate(tok: Token) {
    const s = tok.scope
    tok.alive = false
    s.tokens.delete(tok)
    this.killScope(s, false)
    s.live = 0
    s.last = { t: this.now, acc: [...tok.acc] as Triple }
    this.scopeDone(s)
  }

  private killToken(t: Token) {
    if (!t.alive) return
    t.alive = false
    if (t.holding >= 0) this.release(t)
    if (t.queued >= 0) {
      const lane = this.lr[t.queued]
      this.queueTo(lane, this.now)
      lane.qlen--
      lane.withdrawn++
      t.queued = -1
    }
  }

  private killScope(s: Scope, self: boolean) {
    for (const t of [...s.tokens]) this.killToken(t)
    s.tokens.clear()
    for (const ch of [...s.children]) this.killScope(ch, true)
    s.children.clear()
    s.pj.clear()
    s.ij.clear()
    if (self) s.live = 0
  }

  private scopeDone(s: Scope) {
    if (s.owner) {
      const owner = s.owner
      s.parent?.children.delete(s)
      if (!owner.alive) return
      owner.acc = [...s.last!.acc] as Triple
      return this.unitDone(owner)
    }
    this.caseOver(s.c, false)
  }

  private caseOver(c: Case, stuck: boolean) {
    if (c.over) return
    c.over = true
    this.killScope(c.top, true)
    this.wipTo(this.now)
    this.openCount--
    this.lastLeave = this.now
    this.finishedCases++
    if (stuck) {
      this.stuck++
      return
    }
    this.completed++
    const ct = this.now - c.arrival
    this.cts.push(ct)
    const acc = c.top.last!.acc
    this.sums.proc += acc[0]
    this.sums.typed += acc[1]
    this.sums.res += acc[2]
    this.sums.work += c.work
    this.sums.cost += c.cost
  }

  private endRun() {
    this.runDone = true
    const end = this.now
    // Cases left with tokens at joins that will never fire are stuck (unless the run was stopped).
    for (const c of this.caseList) {
      if (c.over) continue
      if (this.runStop) continue
      const at = new Set<string>()
      const walk = (s: Scope) => {
        for (const [id, w] of s.pj) for (const ts of w.values()) if (ts.some((t) => t.alive)) at.add(id)
        for (const [id, l] of s.ij) if (l.some((e) => e.got.length)) at.add(id)
        for (const ch of s.children) walk(ch)
      }
      walk(c.top)
      for (const id of at) this.stuckAt.set(id, (this.stuckAt.get(id) ?? 0) + 1)
      this.caseOver(c, true)
    }
    const open = this.caseList.filter((c) => !c.over).length
    this.wipTo(end)
    const leave = open ? end : this.lastLeave
    const span = leave - this.firstArrival
    const n = this.completed
    const sorted = [...this.cts].sort((a, b) => a - b)
    const ctAcc = new Acc()
    for (const x of this.cts) ctAcc.add(x)
    const ag = ctAcc.agg()
    const mean = (x: number) => (n ? x / n : 0)
    // The arrival window: first to last arrival, stretched by N / (N − 1) so it holds N intervals (N / λ on average).
    const N = this.started
    const arrWin = N > 1 ? ((this.lastArrival - this.firstArrival) * N) / (N - 1) : span
    const lanes: RunLane[] = this.lanes.map((l, i) => {
      const r = this.lr[i]
      this.queueTo(r, end)
      const win = arrWin > 0 ? arrWin : span
      const tot = this.laneTotals[i]
      tot.busy += r.busyTime
      tot.fixed += r.fixed
      tot.unit += r.unit
      tot.requests += r.requests
      tot.withdrawn += r.withdrawn
      tot.waitSum += r.waitSum
      tot.maxQ = Math.max(tot.maxQ, r.maxQ)
      const avgQueue = span > 0 ? r.area / span : 0
      const utilisation = win > 0 ? r.busyTime / (l.cap * win) : 0
      tot.avgQ.push(avgQueue)
      tot.util.push(utilisation)
      const served = r.requests - r.withdrawn
      return { laneId: l.id, utilisation, busy: r.busyTime, meanWait: served > 0 ? r.waitSum / served : 0, avgQueue, maxQueue: r.maxQ }
    })
    const ct = mean(ag.total)
    const proc = mean(this.sums.proc)
    const rs: RunStats = {
      run: this.run,
      seed: this.runSeed,
      started: this.started,
      completed: n,
      stuck: this.stuck,
      open,
      events: this.events,
      cycleTime: { mean: ct, sd: ag.sd, min: ag.min, max: ag.max, p90: n ? sorted[Math.ceil(0.9 * n) - 1] : 0 },
      processing: proc,
      typedWait: mean(this.sums.typed),
      resourceWait: mean(this.sums.res),
      work: mean(this.sums.work),
      cost: mean(this.sums.cost),
      efficiency: ct > 0 ? proc / ct : 0,
      firstArrival: this.firstArrival,
      lastArrival: this.lastArrival,
      end: leave,
      throughput: span > 0 ? n / span : 0,
      wip: span > 0 ? this.wipArea / span : 0,
      lanes,
    }
    if (this.runStop) rs.stopped = this.runStop
    if (this.target !== undefined) rs.onTime = n ? this.cts.filter((x) => x <= this.target! + 1e-12).length / n : 0
    this.runStats.push(rs)
  }

  // ---------------------------------------------------------------- the result

  result(): SimResult {
    const runs = this.runStats
    const kp = (f: (r: RunStats) => number) => interval(runs.map(f))
    const kpis: Partial<Record<KpiKey, Interval>> = runs.length
      ? {
          cycleTime: kp((r) => r.cycleTime.mean),
          cycleTimeSd: kp((r) => r.cycleTime.sd),
          processing: kp((r) => r.processing),
          typedWait: kp((r) => r.typedWait),
          resourceWait: kp((r) => r.resourceWait),
          work: kp((r) => r.work),
          cost: kp((r) => r.cost),
          efficiency: kp((r) => r.efficiency),
          throughput: kp((r) => r.throughput),
          wip: kp((r) => r.wip),
        }
      : {}
    if (this.target !== undefined && runs.length) kpis.onTime = kp((r) => r.onTime ?? 0)
    const sum = (f: (r: RunStats) => number) => runs.reduce((s, r) => s + f(r), 0)
    const lanes: LaneStats[] = this.lanes.map((l, i) => {
      const t = this.laneTotals[i]
      const served = t.requests - t.withdrawn
      return {
        laneId: l.id,
        name: l.name,
        capacity: l.cap,
        utilisation: interval(t.util),
        busy: t.busy,
        fixedCost: t.fixed,
        unitCost: t.unit,
        totalCost: t.fixed + t.unit,
        avgQueue: t.avgQ.length ? t.avgQ.reduce((s, x) => s + x, 0) / t.avgQ.length : 0,
        maxQueue: t.maxQ,
        requests: t.requests,
        withdrawn: t.withdrawn,
        meanWait: served > 0 ? t.waitSum / served : 0,
      }
    })
    const unstable = lanes.some((l) => l.utilisation.mean >= 1)
    const notes = new Set(this.notes)
    if (unstable)
      for (const l of lanes)
        if (l.utilisation.mean >= 1) notes.add(`${l.name} is busy ${Math.round(l.utilisation.mean * 100)} % of the time: the queue grows with every case and never settles (unstable)`)
    const elements: ElementStats[] = [...this.infos.values()].map((i) => {
      const e = this.elems.get(i.node.id)!
      return { id: i.node.id, name: i.name, type: i.node.type, started: e.started, completed: e.completed, time: e.time.agg(), resourceWait: e.res.agg(), typedWait: e.typed.agg(), fixedCost: e.fixed, unitCost: e.unit }
    })
    const done = runs.length > 0
    const out: SimResult = {
      level: this.level,
      poolId: this.poolId,
      name: this.name,
      unit: this.unit,
      seed: this.seed,
      cases: this.cases,
      arrivals: this.arrivals,
      arrivalShape: this.arrivalShape,
      runs: [...runs],
      kpis,
      started: sum((r) => r.started),
      completed: sum((r) => r.completed),
      stuck: sum((r) => r.stuck),
      open: sum((r) => r.open),
      elements,
      lanes,
      stuckAt: [...this.stuckAt].map(([id, cases]) => ({ id, name: this.infos.get(id)?.name ?? id, cases })),
      unreached: done ? elements.filter((e) => e.started === 0).map((e) => e.id) : [],
      unstable,
      notes: [...notes],
    }
    if (this.target !== undefined) out.target = this.target
    if (this.stopped || this.timeStops) out.stopped = this.stopped ?? 'time'
    if (out.stuck) out.notes.push(`${out.stuck} of ${out.started} cases never reached an end (stuck)`)
    return out
  }
}

/** Runs the whole simulation on this thread and returns its figures (phase 3 runs `Simulation` in a worker in slices). */
export function simulate(m: FlowModel, o: SimOptions): SimResult {
  const sim = new Simulation(m, o)
  while (!sim.step(20_000)) {
    const p = sim.progress()
    o.onProgress?.(p.done, p.total)
  }
  const p = sim.progress()
  o.onProgress?.(p.done, p.total)
  return sim.result()
}
