// Stage 6b, phase 2: the simulation engine (design §3, tests of §4.4). The groups tie a run to the theory:
// determinism, level 2 = flow analysis, the max of random parallel branches, M/M/1 and M/M/2 against Erlang C,
// Little's law, the edges (stuck joins, endless loops, boundary chances, inclusive splits, terminate, overload)
// and Kaiyo. Seeds are fixed, so the numbers are exact for this engine: a change to the order of draws changes them.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { analyseModel } from '../src/core/analysis'
import { mmc } from '../src/core/queue'
import { emptyModel, type FlowModel, type FlowNode, type GatewayKind, type LoopKind, type Shape, type SimFigures } from '../src/core/metamodel'
import { parseModel } from '../src/core/serialize'
import { interval, SimError, Simulation, simulate, type SimOptions } from '../src/core/simulate'

// ---------------------------------------------------------------- a small builder (semantics only, no drawing)

class B {
  m: FlowModel
  constructor(name = 'Test', unit: 'min' | 'h' | 'd' = 'h', arrivals?: number) {
    this.m = emptyModel(name)
    this.m.participants.push({ id: 'P', name: 'Pool', processId: 'Pr' })
    this.m.sim = { unit, ...(arrivals !== undefined && { arrivals }) }
  }
  private add(n: FlowNode) {
    this.m.nodes.push({ participantId: 'P', ...n } as FlowNode)
    return this
  }
  lane(id: string, capacity?: number, cost: { useCost?: number; hourlyCost?: number } = {}) {
    this.m.lanes.push({ id, name: id, participantId: 'P', ...(capacity !== undefined && { capacity }), ...cost })
    return this
  }
  start(id = 'S', parentId?: string) {
    return this.add({ id, name: id, type: 'event', position: 'start', trigger: 'none', throwing: false, parentId })
  }
  end(id = 'E', parentId?: string, terminate = false) {
    return this.add({ id, name: id, type: 'event', position: 'end', trigger: terminate ? 'terminate' : 'none', throwing: true, parentId })
  }
  wait(id: string, wait: number, parentId?: string) {
    return this.add({ id, name: id, type: 'event', position: 'intermediate', trigger: 'timer', throwing: false, parentId, sim: { wait } })
  }
  task(id: string, sim: SimFigures = {}, o: { lane?: string; parentId?: string; loop?: LoopKind } = {}) {
    return this.add({ id, name: id, type: 'task', kind: 'task', sim, laneId: o.lane, parentId: o.parentId, ...(o.loop && { loop: o.loop }) })
  }
  sub(id: string, sim: SimFigures = {}, o: { parentId?: string; loop?: LoopKind } = {}) {
    return this.add({ id, name: id, type: 'subProcess', collapsed: false, sim, parentId: o.parentId, ...(o.loop && { loop: o.loop }) })
  }
  gw(id: string, kind: GatewayKind = 'exclusive', parentId?: string) {
    return this.add({ id, name: id, type: 'gateway', kind, parentId })
  }
  boundary(id: string, host: string, fires: number | undefined, interrupting = true) {
    return this.add({ id, name: id, type: 'event', position: 'boundary', trigger: 'timer', throwing: false, attachedTo: host, interrupting, ...(fires !== undefined && { sim: { fires } }) })
  }
  flow(source: string, target: string, probability?: number) {
    this.m.flows.push({ id: `${source}>${target}`, kind: 'sequence', source, target, name: '', ...(probability !== undefined && { probability }) })
    return this
  }
  chain(...ids: string[]) {
    for (let i = 1; i < ids.length; i++) this.flow(ids[i - 1], ids[i])
    return this
  }
}

const run = (m: FlowModel, o: Partial<SimOptions> = {}) => simulate(m, { level: 2, cases: 200, runs: 1, seed: 1, ...o })
const el = (r: ReturnType<typeof run>, id: string) => r.elements.find((e) => e.id === id)!
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)

/** One clerk: arrivals λ per hour, service mean `service` h, capacity c. */
function queue(lambda: number, service: number, c = 1, shape: Shape | null = { kind: 'exp' }) {
  const b = new B('Queue', 'h', lambda).lane('Clerk', c).start().task('Post', { duration: service, ...(shape && { durationShape: shape }) }, { lane: 'Clerk' }).end().chain('S', 'Post', 'E')
  return b.m
}

// ---------------------------------------------------------------- 1. determinism

describe('1. determinism', () => {
  const m = queue(1.5, 0.5)
  it('same model, options and seed give deep-equal results; another seed does not', () => {
    const a = run(m, { level: 3, cases: 500, runs: 3, seed: 7 })
    const b = run(m, { level: 3, cases: 500, runs: 3, seed: 7 })
    expect(b).toEqual(a)
    const c = run(m, { level: 3, cases: 500, runs: 3, seed: 8 })
    expect(c.kpis.cycleTime!.mean).not.toBe(a.kpis.cycleTime!.mean)
    // run r uses seed + r: runs 1 and 2 of seed 7 are runs 0 and 1 of seed 8
    expect(c.runs[0]).toEqual({ ...a.runs[1], run: 0 })
  })
  it('a run in slices gives the same result as one call, and progress counts up to cases × runs', () => {
    const sim = new Simulation(m, { level: 3, cases: 300, runs: 2, seed: 3 })
    const seen: number[] = []
    while (!sim.step(97)) seen.push(sim.progress().done)
    expect(sim.progress()).toEqual({ done: 600, total: 600 })
    expect(seen.every((x, i) => i === 0 || x >= seen[i - 1])).toBe(true)
    expect(sim.result()).toEqual(run(m, { level: 3, cases: 300, runs: 2, seed: 3 }))
    const calls: [number, number][] = []
    run(m, { level: 3, cases: 10000, runs: 2, seed: 3, onProgress: (d, t) => calls.push([d, t]) })
    expect(calls.length).toBeGreaterThan(1)
    expect(calls.at(-1)).toEqual([20000, 20000])
  })
})

// ---------------------------------------------------------------- 2. level 2 = flow analysis

describe('2. level 2 equals the flow analysis', () => {
  it('sequence, AND split and join, sub-process, repeats, constant times: exact to 1e-9', () => {
    const b = new B('Exact', 'h', 0.25)
      .start()
      .task('T1', { duration: 2, wait: 1, cost: 5 })
      .gw('G1', 'parallel')
      .task('T2', { duration: 3, cost: 1, wait: 0.25 })
      .sub('SP', { cost: 4, wait: 0.5 })
      .start('s2', 'SP')
      .task('U1', { duration: 1, wait: 0.5, cost: 2 }, { parentId: 'SP' })
      .task('U2', { duration: 2 }, { parentId: 'SP' })
      .end('e2', 'SP')
      .gw('J1', 'parallel')
      .task('T3', { duration: 0.5, cost: 2, repeats: 3 }, { loop: 'sequential' })
      .task('T4', { duration: 1, cost: 1, repeats: 2 }, { loop: 'parallel' })
      .end()
      .chain('S', 'T1', 'G1', 'T2', 'J1', 'T3', 'T4', 'E')
      .chain('G1', 'SP', 'J1')
      .chain('s2', 'U1', 'U2', 'e2')
    const [a] = analyseModel(b.m)
    const r = run(b.m, { level: 2, cases: 50, runs: 2, arrivalShape: 'const' })
    expect(r.completed).toBe(100)
    expect(r.kpis.cycleTime!.mean).toBeCloseTo(a.cycleTime!, 9)
    expect(r.kpis.processing!.mean).toBeCloseTo(a.processingTime!, 9)
    expect(r.kpis.cost!.mean).toBeCloseTo(a.cost!, 9)
    expect(r.kpis.cycleTimeSd!.mean).toBeCloseTo(0, 9)
    // the numbers themselves: 1 + 2, then SP (0.5 + 0.5 + 1 + 2 = 4) beats T2 (3.25), then 3 × 0.5 and one 1 (parallel copies)
    expect(a.cycleTime).toBeCloseTo(3 + 4 + 1.5 + 1, 9)
    expect(el(r, 'U1').completed).toBe(100)
    expect(el(r, 'T3').time.n).toBe(300)
    expect(el(r, 'T4').time.n).toBe(200)
  })

  it('decisions and a rework loop: within 2 % of the formula (20 000 cases)', () => {
    const b = new B('Rework', 'h', 0.1)
      .start()
      .task('Write', { duration: 1, cost: 1 })
      .task('Review', { duration: 2, wait: 1, cost: 3 })
      .gw('OK', 'exclusive')
      .task('Fix', { duration: 0.5 })
      .gw('Big', 'exclusive')
      .task('Board', { duration: 5, cost: 10 })
      .task('Sign', { duration: 1, cost: 1 })
      .gw('M', 'exclusive')
      .end()
      .chain('S', 'Write', 'Review', 'OK')
      .flow('OK', 'Fix', 0.25)
      .flow('OK', 'Big', 0.75)
      .chain('Fix', 'Review')
      .flow('Big', 'Board', 0.4)
      .flow('Big', 'Sign', 0.6)
      .chain('Board', 'M', 'E')
      .chain('Sign', 'M')
    const [a] = analyseModel(b.m)
    const r = run(b.m, { level: 2, cases: 10000, runs: 2, seed: 11 })
    expect(rel(r.kpis.cycleTime!.mean, a.cycleTime!)).toBeLessThan(0.02)
    expect(rel(r.kpis.cost!.mean, a.cost!)).toBeLessThan(0.02)
    expect(rel(r.kpis.processing!.mean, a.processingTime!)).toBeLessThan(0.02)
    // runs per case of Review: 1 / 0.75
    expect(rel(el(r, 'Review').completed / r.completed, a.steps.find((s) => s.id === 'Review')!.runs)).toBeLessThan(0.02)
  })

  // The analysis counts an inclusive split as one branch (its help card says so); the run lets several happen.
  const files = readdirSync('cases').filter((f) => f.endsWith('.flow.json'))
  for (const f of files) {
    it(`case ${f} at level 2: every case ends; with figures, within 3 % of the formula`, () => {
      const m = parseModel(readFileSync(`cases/${f}`, 'utf8'))
      for (const a of analyseModel(m)) {
        const r = simulate(m, { level: 2, poolId: a.poolId, cases: 5000, runs: 4, seed: 5 })
        expect(r.stuck).toBe(0)
        expect(r.completed).toBe(20000)
        if (a.cycleTime === undefined || !(a.cycleTime > 0)) continue
        if (m.nodes.some((n) => n.type === 'gateway' && n.kind === 'inclusive' && n.participantId === a.poolId)) continue
        expect(rel(r.kpis.cycleTime!.mean, a.cycleTime)).toBeLessThan(0.03)
        expect(Math.abs(r.kpis.cost!.mean - a.cost!)).toBeLessThanOrEqual(0.03 * Math.max(1, a.cost!))
      }
    })
  }
})

// ---------------------------------------------------------------- 3. AND of random branches

describe('3. parallel branches with random times', () => {
  it('two exponential branches of mean 1 take 1.5 on average, not 1 (the run beats the formula)', () => {
    const b = new B('AND', 'h', 1)
      .start()
      .gw('G', 'parallel')
      .task('A', { duration: 1, durationShape: { kind: 'exp' } })
      .task('B', { duration: 1, durationShape: { kind: 'exp' } })
      .gw('J', 'parallel')
      .end()
      .chain('S', 'G', 'A', 'J', 'E')
      .chain('G', 'B', 'J')
    const [a] = analyseModel(b.m)
    expect(a.cycleTime).toBeCloseTo(1, 9)
    const r = run(b.m, { cases: 10000, runs: 4, seed: 2 })
    expect(Math.abs(r.kpis.cycleTime!.mean - 1.5)).toBeLessThan(0.02)
    // all work of the case is both branches: 2
    expect(Math.abs(r.kpis.work!.mean - 2)).toBeLessThan(0.03)
  })
})

// ---------------------------------------------------------------- 4–5. queues against Erlang C

describe('4. M/M/1 against queueing theory', () => {
  // one clerk posting orders: λ = 1.5 per hour, 0.5 h each, exponential arrivals and times
  const q = mmc(1.5, 0.5, 1)
  const r = run(queue(1.5, 0.5), { level: 3, cases: 10000, runs: 10, seed: 1 })
  it('W within 5 % of 2 h, Wq within 10 % of 1.5 h, utilisation within 3 % of 0.75', () => {
    expect(q.w).toBeCloseTo(2, 9)
    expect(q.wq).toBeCloseTo(1.5, 9)
    expect(rel(r.kpis.cycleTime!.mean, 2)).toBeLessThan(0.05)
    expect(rel(r.kpis.resourceWait!.mean, 1.5)).toBeLessThan(0.1)
    expect(rel(r.lanes[0].utilisation.mean, 0.75)).toBeLessThan(0.03)
    expect(rel(r.lanes[0].meanWait, 1.5)).toBeLessThan(0.1)
    // the interval covers the theory and is not empty
    const ct = r.kpis.cycleTime!
    expect(ct.half).toBeGreaterThan(0)
    expect(Math.abs(ct.mean - 2)).toBeLessThan(2 * ct.half!)
    expect(r.unstable).toBe(false)
  })
  it('level 2 of the same model has no queue at all; the lane shows its load as the formula does', () => {
    const r2 = run(queue(1.5, 0.5), { level: 2, cases: 10000, runs: 1 })
    expect(r2.kpis.resourceWait!.mean).toBe(0)
    expect(r2.lanes[0].maxQueue).toBe(0)
    expect(r2.lanes[0].meanWait).toBe(0)
    expect(rel(r2.lanes[0].utilisation.mean, 0.75)).toBeLessThan(0.03)
  })
  it('regular arrivals and constant work: no queue at 75 %; random arrivals: a queue (queues come from spread)', () => {
    const m = queue(1.5, 0.5, 1, null)
    const regular = run(m, { level: 3, cases: 2000, arrivalShape: 'const' })
    expect(regular.kpis.resourceWait!.mean).toBe(0)
    expect(regular.lanes[0].utilisation.mean).toBeCloseTo(0.75, 9)
    const random = run(m, { level: 3, cases: 2000, arrivalShape: 'exp' })
    expect(random.kpis.resourceWait!.mean).toBeGreaterThan(0.3)
  })
})

describe('5. M/M/2 against Erlang C', () => {
  it('queue.ts gives Wq 0.0818 h and W 0.5818 h at λ 1.5, μ 2, two people', () => {
    const q = mmc(1.5, 0.5, 2)
    expect(q.rho).toBeCloseTo(0.375, 4)
    expect(q.wq).toBeCloseTo(0.0818, 4)
    expect(q.w).toBeCloseTo(0.5818, 4)
  })
  it('the run agrees: Wq within 10 %, W within 3 %, utilisation 0.375 within 3 %', () => {
    const r = run(queue(1.5, 0.5, 2), { level: 3, cases: 10000, runs: 10, seed: 1 })
    expect(rel(r.kpis.resourceWait!.mean, 0.0818)).toBeLessThan(0.1)
    expect(rel(r.kpis.cycleTime!.mean, 0.5818)).toBeLessThan(0.03)
    expect(rel(r.lanes[0].utilisation.mean, 0.375)).toBeLessThan(0.03)
    expect(r.lanes[0].capacity).toBe(2)
  })
})

// ---------------------------------------------------------------- 6. Little's law

describe("6. Little's law and the parts of the cycle time", () => {
  const b = new B('Little', 'h', 1)
    .lane('Desk', 1)
    .lane('Back', 2)
    .start()
    .task('Take', { duration: 0.4, durationShape: { kind: 'exp' }, wait: 0.2, waitShape: { kind: 'uniform', min: 0, max: 0.4 } }, { lane: 'Desk' })
    .gw('G', 'parallel')
    .task('Check', { duration: 1, durationShape: { kind: 'normal', sd: 0.3 } }, { lane: 'Back' })
    .task('Bill', { duration: 0.7, durationShape: { kind: 'triangular', min: 0.2, mode: 0.7, max: 1.2 } }, { lane: 'Back' })
    .gw('J', 'parallel')
    .end()
    .chain('S', 'Take', 'G', 'Check', 'J', 'E')
    .chain('G', 'Bill', 'J')
  for (const level of [2, 3] as const)
    it(`WIP = throughput × cycle time to 1e-9 on every run in which all cases complete (level ${level})`, () => {
      const r = run(b.m, { level, cases: 3000, runs: 3, seed: 4 })
      for (const x of r.runs) {
        expect(x.completed).toBe(3000)
        expect(x.wip).toBeCloseTo(x.throughput * x.cycleTime.mean, 9)
        // processing + typed waiting + waiting for a person = cycle time, along the critical path
        expect(x.processing + x.typedWait + x.resourceWait).toBeCloseTo(x.cycleTime.mean, 9)
      }
      if (level === 2) expect(r.kpis.resourceWait!.mean).toBe(0)
      else expect(r.kpis.resourceWait!.mean).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------- 7. edges

describe('7. edges', () => {
  it('a parallel join behind a decision never fires: every case is stuck there', () => {
    const b = new B('Stuck', 'h', 1)
      .start()
      .gw('X', 'exclusive')
      .task('A', { duration: 1 })
      .task('B', { duration: 1 })
      .gw('J', 'parallel')
      .end()
      .chain('S', 'X', 'A', 'J', 'E')
      .chain('X', 'B', 'J')
    const r = run(b.m, { cases: 100 })
    expect(r.stuck).toBe(100)
    expect(r.completed).toBe(0)
    expect(r.stuckAt).toEqual([{ id: 'J', name: 'J', cases: 100 }])
    expect(r.unreached).toEqual(['E'])
    expect(r.notes.some((n) => n.includes('never reached an end'))).toBe(true)
  })

  it('a loop taken back with 100 %: cases stuck after 1 000 visits, the loop is named, the run ends', () => {
    const b = new B('Loop', 'h', 1).start().task('Redo', { duration: 0.1 }).gw('X').end().chain('S', 'Redo', 'X').flow('X', 'Redo', 1).flow('X', 'E', 0)
    const r = run(b.m, { level: 1, cases: 20 })
    expect(r.stuck).toBe(20)
    expect(r.stuckAt.map((s) => s.id)).toEqual(['Redo'])
    expect(el(r, 'Redo').started).toBe(20 * 1000)
    expect(r.notes.some((n) => n.includes('more than 1000 times'))).toBe(true)
  })

  it('boundary events happen with their chance: 0, 0.3, 1 (interrupting); non-interrupting adds a path', () => {
    const make = (fires: number | undefined, interrupting = true) =>
      new B('Boundary', 'h', 1).start().task('Work', { duration: 1 }).end().boundary('Late', 'Work', fires, interrupting).task('Chase', { duration: 2 }).end('E2').chain('S', 'Work', 'E').chain('Late', 'Chase', 'E2').m
    expect(el(run(make(undefined), { cases: 1000 }), 'Chase').started).toBe(0)
    expect(el(run(make(0), { cases: 1000 }), 'Chase').started).toBe(0)
    const r3 = run(make(0.3), { cases: 10000, seed: 3 })
    expect(Math.abs(el(r3, 'Chase').started / 10000 - 0.3)).toBeLessThan(0.015)
    expect(el(r3, 'E').started + el(r3, 'E2').started).toBe(10000)
    const [a3] = analyseModel(make(0.3))
    expect(rel(r3.kpis.cycleTime!.mean, a3.cycleTime!)).toBeLessThan(0.02)
    const r1 = run(make(1), { cases: 1000 })
    expect(el(r1, 'Chase').started).toBe(1000)
    expect(el(r1, 'E').started).toBe(0)
    // non-interrupting: the normal path always, the boundary path too in 30 %; the case waits for both
    const rn = run(make(0.3, false), { cases: 10000, seed: 3 })
    expect(el(rn, 'E').started).toBe(10000)
    expect(Math.abs(el(rn, 'Chase').started / 10000 - 0.3)).toBeLessThan(0.015)
    expect(Math.abs(rn.kpis.cycleTime!.mean - (1 + 0.3 * 2))).toBeLessThan(0.03)
  })

  it('an inclusive split is never empty, takes branches on their own and joins at its matching join', () => {
    const b = new B('OR', 'h', 1)
      .start()
      .gw('O', 'inclusive')
      .task('A', { duration: 1 })
      .task('B', { duration: 2 })
      .gw('J', 'inclusive')
      .end()
      .chain('S', 'O')
      .flow('O', 'A', 0.1)
      .flow('O', 'B', 0.2)
      .chain('A', 'J', 'E')
      .chain('B', 'J')
    const r = run(b.m, { cases: 10000, seed: 9 })
    expect(r.completed).toBe(10000)
    expect(el(r, 'E').started).toBe(10000)
    const a = el(r, 'A').started / 10000
    const bb = el(r, 'B').started / 10000
    // none drawn (0.9 × 0.8 = 72 %) → the most likely branch, B: B in 0.2 + 0.72, A in 0.1
    expect(Math.abs(a - 0.1)).toBeLessThan(0.01)
    expect(Math.abs(bb - 0.92)).toBeLessThan(0.01)
    // both in 2 % of the cases: the join waits for both
    expect(el(r, 'J').started).toBe(el(r, 'A').started + el(r, 'B').started)
    expect(r.notes.some((n) => n.includes('scaled to 100'))).toBe(true)
  })

  it('a terminate end ends the case at once and withdraws its queued requests', () => {
    // the clerk works 10 h per case; the other branch terminates after a random time (mean 1 h), often while the request still waits
    const b = new B('Terminate', 'h', 4)
      .lane('Clerk', 1)
      .start()
      .gw('G', 'parallel')
      .task('Long', { duration: 10 }, { lane: 'Clerk' })
      .end('E')
      .wait('Hour', 1)
      .end('T', undefined, true)
      .chain('S', 'G', 'Long', 'E')
      .chain('G', 'Hour', 'T')
    ;(b.m.nodes.find((n) => n.id === 'Hour')!.sim as SimFigures).waitShape = { kind: 'exp' }
    const r = run(b.m, { level: 3, cases: 50, arrivalShape: 'const' })
    expect(r.completed).toBe(50)
    expect(r.stuck).toBe(0)
    // the case ends with the terminate: its cycle time is the random hour, nothing else
    expect(r.kpis.cycleTime!.mean).toBeCloseTo(r.kpis.typedWait!.mean, 9)
    expect(el(r, 'Long').completed).toBe(0)
    expect(el(r, 'E').started).toBe(0)
    const lane = r.lanes[0]
    expect(lane.requests).toBe(50)
    expect(lane.withdrawn).toBeGreaterThan(0)
    // a withdrawn request never starts later: only the served ones were worked on
    expect(el(r, 'Long').time.n).toBe(lane.requests - lane.withdrawn)
    // served work was cut at the terminate: the clerk was busy no longer than the cases were open
    expect(lane.busy).toBeLessThanOrEqual(el(r, 'Hour').typedWait.total + 1e-9)
  })

  it('a terminate inside a sub-process ends only the sub-process', () => {
    const b = new B('Inner terminate', 'h', 1)
      .start()
      .sub('SP')
      .start('s2', 'SP')
      .gw('g2', 'parallel', 'SP')
      .task('Slow', { duration: 5 }, { parentId: 'SP' })
      .end('e2', 'SP')
      .task('Quick', { duration: 1 }, { parentId: 'SP' })
      .end('t2', 'SP', true)
      .task('After', { duration: 2 })
      .end()
      .chain('S', 'SP', 'After', 'E')
      .chain('s2', 'g2', 'Slow', 'e2')
      .chain('g2', 'Quick', 't2')
    const r = run(b.m, { cases: 100 })
    expect(r.completed).toBe(100)
    expect(r.kpis.cycleTime!.mean).toBeCloseTo(3, 9)
    expect(el(r, 'After').completed).toBe(100)
    expect(el(r, 'Slow').completed).toBe(0)
  })

  it('an overloaded lane (125 %) still finishes N cases, is reported unstable, and its wait doubles with N', () => {
    const m = queue(1, 1.25, 1, null)
    const r1 = run(m, { level: 3, cases: 1000, arrivalShape: 'const' })
    const r2 = run(m, { level: 3, cases: 2000, arrivalShape: 'const' })
    expect(r1.completed).toBe(1000)
    expect(r2.completed).toBe(2000)
    expect(r1.unstable).toBe(true)
    expect(r1.lanes[0].utilisation.mean).toBeCloseTo(1.25, 9)
    expect(r1.notes.some((n) => n.includes('unstable'))).toBe(true)
    const ratio = r2.kpis.resourceWait!.mean / r1.kpis.resourceWait!.mean
    expect(ratio).toBeGreaterThan(1.9)
    expect(ratio).toBeLessThan(2.1)
    // and with random arrivals and times it ends too
    const r3 = run(queue(1, 1.25), { level: 3, cases: 2000 })
    expect(r3.completed).toBe(2000)
    expect(r3.unstable).toBe(true)
  })

  it('a time limit stops each run; open cases are not stuck', () => {
    const r = run(queue(1, 1.25), { level: 3, cases: 2000, runs: 2, maxTime: 100 })
    expect(r.stopped).toBe('time')
    expect(r.runs).toHaveLength(2)
    expect(r.stuck).toBe(0)
    expect(r.open).toBeGreaterThan(0)
    expect(r.runs.every((x) => x.started + 0 <= 2000 && x.completed + x.open === x.started)).toBe(true)
  })

  it('an event cap stops the whole simulation with a note', () => {
    const r = run(queue(1, 0.5), { level: 3, cases: 2000, runs: 3, maxEvents: 1000 })
    expect(r.stopped).toBe('events')
    expect(r.runs).toHaveLength(1)
    expect(r.notes.some((n) => n.includes('Too many events'))).toBe(true)
  })

  it('capacity 0 on a lane with work counts as one person, 1.5 as two (notes)', () => {
    const zero = run(queue(1, 0.5, 0), { level: 3, cases: 200 })
    expect(zero.completed).toBe(200)
    expect(zero.lanes[0].capacity).toBe(1)
    expect(zero.notes.some((n) => n.includes('capacity 0 counts as 1'))).toBe(true)
    const half = run(queue(1, 0.5, 1.5), { level: 3, cases: 200 })
    expect(half.lanes[0].capacity).toBe(2)
    expect(half.notes.some((n) => n.includes('counts as 2 people'))).toBe(true)
  })

  it('negative durations count as 0; shares that do not add up are scaled; all-zero shares are equal', () => {
    const b = new B('Bad figures', 'h', 1).start().task('Neg', { duration: -3 }).gw('X').task('A', { duration: 1 }).task('B', { duration: 3 }).end().end('E2')
    b.chain('S', 'Neg', 'X').flow('X', 'A', 0.3).flow('X', 'B', 0.3).chain('A', 'E').chain('B', 'E2')
    const r = run(b.m, { cases: 10000 })
    expect(el(r, 'Neg').time.max).toBe(0)
    expect(r.notes.some((n) => n.includes('below 0 counts as 0'))).toBe(true)
    expect(r.notes.some((n) => n.includes('60 %, scaled to 100 %'))).toBe(true)
    expect(Math.abs(el(r, 'A').started / 10000 - 0.5)).toBeLessThan(0.015)
    const z = new B('Zero', 'h', 1).start().gw('X').end('E1').end('E2').chain('S', 'X').flow('X', 'E1', 0).flow('X', 'E2', 0)
    const rz = run(z.m, { level: 1, cases: 10000 })
    expect(Math.abs(el(rz, 'E1').started / 10000 - 0.5)).toBeLessThan(0.015)
  })

  it('empty model, no start event, level 3 without arrivals and out-of-range settings give a clear error and no run', () => {
    expect(() => run(emptyModel())).toThrow(SimError)
    expect(() => run(emptyModel())).toThrow('draw a start event first')
    const noStart = new B('No start', 'h', 1).task('A', { duration: 1 }).end().chain('A', 'E')
    expect(() => run(noStart.m)).toThrow('Draw a start event first')
    const noRate = new B('No rate', 'h').start().task('A', { duration: 1 }).end().chain('S', 'A', 'E')
    expect(() => run(noRate.m, { level: 3 })).toThrow('How many new cases per hour?')
    const r = run(noRate.m, { level: 2, cases: 10 })
    expect(r.completed).toBe(10)
    expect(r.notes.some((n) => n.includes('No arrival rate'))).toBe(true)
    const m = queue(1, 0.5)
    expect(() => run(m, { cases: 0 })).toThrow('Cases per run')
    expect(() => run(m, { cases: 10001 })).toThrow('Cases per run')
    expect(() => run(m, { runs: 21 })).toThrow('Runs')
    expect(() => run(m, { cases: 10000, runs: 11 })).toThrow('at most 100,000')
    expect(() => run(m, { level: 4 as 3 })).toThrow('Level')
    expect(() => run(m, { poolId: 'Nope' })).toThrow('No process in pool Nope')
  })

  it('level 1 counts paths only: no time, no cost; a branch with 0 % is never reached', () => {
    const b = new B('Validate', 'h', 1).start().task('A', { duration: 5, cost: 9 }).gw('X').end('E1').task('Never', { duration: 1 }).end('E2')
    b.chain('S', 'A', 'X').flow('X', 'E1', 1).flow('X', 'Never', 0).chain('Never', 'E2')
    const r = run(b.m, { level: 1, cases: 300 })
    expect(r.completed).toBe(300)
    expect(r.kpis.cycleTime!.mean).toBe(0)
    expect(r.kpis.cost!.mean).toBe(0)
    expect(el(r, 'A').completed).toBe(300)
    expect(r.unreached).toEqual(['Never', 'E2'])
  })
})

// ---------------------------------------------------------------- what-if overrides (phase 4 input)

describe('what-if overrides', () => {
  // constant times: the sums below are exact; the shapes of the example (v0.18.0) are taken off
  const kaiyo = () => {
    const m = parseModel(readFileSync('cases/kaiyo-order.flow.json', 'utf8'))
    for (const n of m.nodes) if (n.sim) delete n.sim.durationShape
    return m
  }
  it('the same seed gives the same arrivals and the same task times in both scenarios (common random numbers)', () => {
    const m = queue(1.5, 0.5)
    const base = run(m, { level: 3, cases: 2000, runs: 2 })
    const two = run(m, { level: 3, cases: 2000, runs: 2, overrides: { capacity: { Clerk: 2 } } })
    for (let i = 0; i < 2; i++) {
      expect(two.runs[i].firstArrival).toBe(base.runs[i].firstArrival)
      expect(two.runs[i].lastArrival).toBe(base.runs[i].lastArrival)
      expect(two.runs[i].work).toBeCloseTo(base.runs[i].work, 12)
    }
    expect(two.kpis.resourceWait!.mean).toBeLessThan(base.kpis.resourceWait!.mean / 5)
    // the model is not edited
    expect(m.lanes[0].capacity).toBe(1)
    // arrivals × 1.5: the same draws, intervals shorter by the factor
    const peak = run(m, { level: 3, cases: 2000, runs: 1, overrides: { arrivalsFactor: 1.5 } })
    expect(peak.arrivals).toBeCloseTo(2.25, 12)
    expect(peak.runs[0].lastArrival - peak.runs[0].firstArrival).toBeCloseTo((base.runs[0].lastArrival - base.runs[0].firstArrival) / 1.5, 9)
  })
  it('task time, branch probability, skip a step, lane capacity and fires are overrides of the run', () => {
    const m = kaiyo()
    const base = run(m, { level: 2, cases: 4000, runs: 1, arrivalShape: 'const' })
    const pack = m.nodes.find((n) => n.name === 'Pack goods')!.id
    const ship = m.nodes.find((n) => n.name === 'Ship goods')!.id
    const stock = m.flows.find((f) => f.source === m.nodes.find((n) => n.name === 'Stock available?')!.id && f.probability === 0.9)!.id
    // the hand-over before shipping halved: 47.5 → 23.75 h of typed wait
    const faster = run(m, { level: 2, cases: 4000, runs: 1, arrivalShape: 'const', overrides: { elements: { [ship]: { wait: 23.75 } } } })
    expect(base.kpis.cycleTime!.mean - faster.kpis.cycleTime!.mean).toBeCloseTo(23.75 * (el(base, ship).completed / 4000), 6)
    // every order in stock: no declined orders
    const all = run(m, { level: 2, cases: 4000, runs: 1, overrides: { probabilities: { [stock]: 1 } } })
    expect(all.notes.some((n) => n.includes('scaled'))).toBe(true)
    expect(el(all, m.nodes.find((n) => n.name === 'Order declined')!.id).started).toBeLessThan(base.started * 0.1)
    // skip packing: no time, no cost, still passes
    const skip = run(m, { level: 2, cases: 4000, runs: 1, arrivalShape: 'const', overrides: { elements: { [pack]: { skip: true } } } })
    expect(el(skip, pack).completed).toBe(el(base, pack).completed)
    expect(el(skip, pack).time.n).toBe(0)
    expect(base.kpis.cycleTime!.mean - skip.kpis.cycleTime!.mean).toBeCloseTo(24 * (el(base, pack).completed / 4000), 6)
    expect(base.kpis.cost!.mean - skip.kpis.cost!.mean).toBeCloseTo(30 * (el(base, pack).completed / 4000), 6)
    // duration override keeps the shape's kind: a triangular is scaled
    const tri = new B('Tri', 'h', 1).start().task('T', { duration: 2, durationShape: { kind: 'triangular', min: 1, mode: 2, max: 3 } }).end().chain('S', 'T', 'E')
    const half = run(tri.m, { cases: 5000, overrides: { elements: { T: { duration: 1 } } } })
    expect(el(half, 'T').time.min).toBeGreaterThanOrEqual(0.5)
    expect(el(half, 'T').time.max).toBeLessThanOrEqual(1.5)
    expect(Math.abs(el(half, 'T').time.mean - 1)).toBeLessThan(0.02)
    // unknown ids are named, not fatal
    expect(run(m, { cases: 10, overrides: { elements: { Ghost: { skip: true } } } }).notes.some((n) => n.includes('no element Ghost'))).toBe(true)
  })
  it('σ of cycle time and the share of cases on time (CT ≤ target) per run', () => {
    const r = run(queue(1.5, 0.5), { level: 3, cases: 5000, runs: 3, target: 2 })
    for (const x of r.runs) {
      expect(x.cycleTime.sd).toBeGreaterThan(0)
      expect(x.onTime).toBeGreaterThan(0)
      expect(x.onTime).toBeLessThan(1)
    }
    // M/M/1: P(W ≤ t) = 1 − e^(−(μ − λ) t) = 1 − e^(−1) at t = 2
    expect(Math.abs(r.kpis.onTime!.mean - (1 - Math.exp(-1)))).toBeLessThan(0.04)
    expect(r.target).toBe(2)
    // M/M/1: the time in the system is exponential, σ = W
    expect(rel(r.kpis.cycleTimeSd!.mean, 2)).toBeLessThan(0.1)
    expect(r.runs[0].cycleTime.p90).toBeGreaterThan(r.runs[0].cycleTime.mean)
  })
})

describe('replications and the 95 % interval', () => {
  it('t-interval with n − 1 degrees of freedom', () => {
    const i = interval([1, 2, 3, 4, 5])
    expect(i.mean).toBe(3)
    expect(i.half).toBeCloseTo((2.776 * Math.sqrt(2.5)) / Math.sqrt(5), 9)
    expect(interval([7]).half).toBeUndefined()
  })
  it('runs differ, and the interval narrows with more cases', () => {
    const m = queue(1.5, 0.5)
    const small = run(m, { level: 3, cases: 200, runs: 10 })
    const big = run(m, { level: 3, cases: 5000, runs: 10 })
    expect(new Set(small.runs.map((r) => r.cycleTime.mean)).size).toBe(10)
    expect(big.kpis.cycleTime!.half!).toBeLessThan(small.kpis.cycleTime!.half! / 2)
  })
})

// ---------------------------------------------------------------- 8. Kaiyo

describe('8. Kaiyo Trading (illustrative figures)', () => {
  const m = parseModel(readFileSync('cases/kaiyo-order.flow.json', 'utf8'))
  it('level 2 cycle time 68.8 h with constant shapes', () => {
    const r = run(m, { level: 2, cases: 10000, runs: 4, seed: 1 })
    expect(rel(r.kpis.cycleTime!.mean, 68.8)).toBeLessThan(0.01)
    expect(r.stuck).toBe(0)
  })
  it('level 3: Warehouse busy about 68 % at 12 orders a day', () => {
    const r = run(m, { level: 3, cases: 10000, runs: 4, seed: 1 })
    const wh = r.lanes.find((l) => l.name === 'Warehouse')!
    expect(Math.abs(wh.utilisation.mean - 0.675)).toBeLessThan(0.02)
    expect(r.unstable).toBe(false)
    // the queue adds waiting the formula cannot see
    expect(r.kpis.cycleTime!.mean).toBeGreaterThan(68.8)
    expect(r.kpis.resourceWait!.mean).toBeGreaterThan(0)
  })
})
