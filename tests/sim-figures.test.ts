// Stage 6b, phase 1: the new figures (shapes, boundary chance, lane costs, run settings) in ops, both file formats
// and the flow analysis; the queue estimate on lanes; and that files and examples from before keep their numbers.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { BpmnModdle } from 'bpmn-moddle'
import { analyseModel } from '../src/core/analysis'
import { mmc } from '../src/core/queue'
import { readBpmn } from '../src/core/bpmn/read'
import { writeBpmn } from '../src/core/bpmn/write'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import { addBoundaryEvent, addLane, addNode, addPool, appendNode, connect, ModelError, setCapacity, setFires, setLaneCost, setShape, setSim, setSimSettings, updateNode } from '../src/core/ops'
import { parseModel, serializeModel } from '../src/core/serialize'
import { drawOrderFulfilment } from './fixtures/order-fulfilment'

/** Start → task "Work" (10) → end, in a pool with one lane. */
function oneTask(duration = 10) {
  const m = emptyModel('One task')
  addPool(m, { x: 0, y: 0 }, 'Shop')
  const lane = m.lanes[0] ?? addLane(m, 'Participant_1', 'Clerk')
  const start = addNode(m, { type: 'event', position: 'start' }, { x: 80, y: m.diagram.shapes[lane.id].y + 60 }, 'Start')
  const t = appendNode(m, start.id, { type: 'task' }, 'Work')
  setSim(m, t.id, { duration })
  const end = appendNode(m, t.id, { type: 'event', position: 'end' }, 'Done')
  return { m, lane, task: t, end }
}

describe('shapes in ops', () => {
  it('stores a shape and keeps the figure as the mean', () => {
    const { m, task } = oneTask(10)
    setShape(m, task.id, 'duration', { kind: 'normal', sd: 2 })
    expect(m.nodes.find((n) => n.id === task.id)!.sim).toEqual({ duration: 10, durationShape: { kind: 'normal', sd: 2 } })
    setShape(m, task.id, 'duration', { kind: 'exp' })
    expect(m.nodes.find((n) => n.id === task.id)!.sim?.durationShape).toEqual({ kind: 'exp' })
    setShape(m, task.id, 'duration', undefined)
    expect(m.nodes.find((n) => n.id === task.id)!.sim).toEqual({ duration: 10 })
  })
  it('uniform and triangular write their own mean into the figure', () => {
    const { m, task } = oneTask(10)
    setShape(m, task.id, 'duration', { kind: 'triangular', min: 0.25, mode: 0.5, max: 0.75 })
    expect(m.nodes.find((n) => n.id === task.id)!.sim!.duration).toBeCloseTo(0.5, 9)
    setShape(m, task.id, 'wait', { kind: 'uniform', min: 2, max: 4 })
    expect(m.nodes.find((n) => n.id === task.id)!.sim!.wait).toBe(3)
  })
  it('a new mean typed by hand moves a uniform or triangular shape by the same amount', () => {
    const { m, task } = oneTask(10)
    setShape(m, task.id, 'duration', { kind: 'uniform', min: 8, max: 12 })
    setSim(m, task.id, { duration: 20 })
    expect(m.nodes.find((n) => n.id === task.id)!.sim).toEqual({ duration: 20, durationShape: { kind: 'uniform', min: 18, max: 22 } })
    expect(() => setSim(m, task.id, { duration: 1 })).toThrow(ModelError) // would put the minimum below 0
    setSim(m, task.id, { duration: undefined })
    expect(m.nodes.find((n) => n.id === task.id)!.sim?.durationShape).toBeUndefined()
  })
  it('a normal or exponential needs the average first; σ = 0 means constant', () => {
    const { m, task } = oneTask(10)
    setSim(m, task.id, { duration: undefined })
    expect(() => setShape(m, task.id, 'duration', { kind: 'exp' })).toThrow(/average/)
    setSim(m, task.id, { duration: 10 })
    setShape(m, task.id, 'duration', { kind: 'normal', sd: 1 })
    setShape(m, task.id, 'duration', { kind: 'normal', sd: 0 })
    expect(m.nodes.find((n) => n.id === task.id)!.sim?.durationShape).toBeUndefined()
  })
  it('refuses σ < 0, min above max, a mode outside, a negative min; nothing is stored', () => {
    const { m, task } = oneTask(10)
    const before = JSON.stringify(m)
    for (const s of [
      { kind: 'normal', sd: -1 },
      { kind: 'normal', sd: 1, min: 5, max: 2 },
      { kind: 'uniform', min: 4, max: 2 },
      { kind: 'uniform', min: -1, max: 2 },
      { kind: 'triangular', min: 1, mode: 9, max: 3 },
      { kind: 'weibull' },
    ] as never[])
      expect(() => setShape(m, task.id, 'duration', s)).toThrow(ModelError)
    expect(JSON.stringify(m)).toBe(before)
  })
  it('only an activity or a catching event has a shape; an event has only a wait', () => {
    const { m, end } = oneTask()
    expect(() => setShape(m, end.id, 'wait', { kind: 'exp' })).toThrow(ModelError)
    const t = addNode(m, { type: 'event', position: 'intermediate' }, { x: 300, y: 100 }, 'Wait for reply')
    setSim(m, t.id, { wait: 4 })
    setShape(m, t.id, 'wait', { kind: 'exp' })
    expect(() => setShape(m, t.id, 'duration', { kind: 'exp' })).toThrow(ModelError)
  })
  it('setting the same shape again changes nothing (no extra undo step)', () => {
    const { m, task } = oneTask(10)
    setShape(m, task.id, 'duration', { kind: 'uniform', min: 8, max: 12 })
    const node = m.nodes.find((n) => n.id === task.id)!
    const sim = node.sim
    setShape(m, task.id, 'duration', { kind: 'uniform', min: 8, max: 12 })
    expect(node.sim).toBe(sim)
  })
})

describe('boundary chance, lane costs and run settings in ops', () => {
  it('setFires takes 0–1 on a boundary event only', () => {
    const { m, task } = oneTask()
    const b = addBoundaryEvent(m, task.id, 'timer')
    setFires(m, b.id, 0.3)
    expect(m.nodes.find((n) => n.id === b.id)!.sim).toEqual({ fires: 0.3 })
    expect(() => setFires(m, b.id, 1.2)).toThrow(ModelError)
    expect(() => setFires(m, b.id, -0.1)).toThrow(ModelError)
    expect(() => setFires(m, task.id, 0.3)).toThrow(ModelError)
    setFires(m, b.id, undefined)
    expect(m.nodes.find((n) => n.id === b.id)!.sim).toBeUndefined()
  })
  it('setLaneCost takes non-negative numbers and clears on blank', () => {
    const { m, lane } = oneTask()
    setLaneCost(m, lane.id, { useCost: 2, hourlyCost: 30 })
    expect(m.lanes.find((l) => l.id === lane.id)).toMatchObject({ useCost: 2, hourlyCost: 30 })
    expect(() => setLaneCost(m, lane.id, { hourlyCost: -1 })).toThrow(ModelError)
    setLaneCost(m, lane.id, { useCost: undefined })
    expect(m.lanes.find((l) => l.id === lane.id)!.useCost).toBeUndefined()
    expect(() => setLaneCost(m, 'nope', { useCost: 1 })).toThrow(ModelError)
  })
  it('settings: cases 1–10 000, runs 1–20, cases × runs at most 100 000, whole seed, arrival shape', () => {
    const { m } = oneTask()
    setSimSettings(m, { cases: 500, runs: 10, seed: 7, arrivalShape: 'const' })
    expect(m.sim).toEqual({ cases: 500, runs: 10, seed: 7, arrivalShape: 'const' })
    for (const bad of [{ cases: 0 }, { cases: 10001 }, { cases: 1.5 }, { runs: 21 }, { runs: 0 }, { seed: 1.5 }, { arrivalShape: 'poisson' as never }]) expect(() => setSimSettings(m, bad)).toThrow(ModelError)
    expect(() => setSimSettings(m, { cases: 10000, runs: 20 })).toThrow(/100,000/)
    setSimSettings(m, { cases: undefined, runs: undefined, seed: undefined, arrivalShape: undefined })
    expect(m.sim).toBeUndefined()
  })
})

describe('both file formats keep every new field', () => {
  function full(): FlowModel {
    const m = emptyModel('Everything')
    drawOrderFulfilment(m)
    const tasks = m.nodes.filter((n) => n.type === 'task')
    setSim(m, tasks[0].id, { duration: 12, wait: 2, cost: 5 })
    setShape(m, tasks[0].id, 'duration', { kind: 'normal', sd: 3, min: 1, max: 30 })
    setShape(m, tasks[0].id, 'wait', { kind: 'exp' })
    setSim(m, tasks[1].id, { duration: 1 })
    setShape(m, tasks[1].id, 'duration', { kind: 'triangular', min: 0.5, mode: 1, max: 1.5 })
    setSim(m, tasks[2].id, { duration: 1 })
    setShape(m, tasks[2].id, 'duration', { kind: 'uniform', min: 0.5, max: 1.5 })
    const b = m.nodes.find((n) => n.type === 'event' && n.position === 'boundary')!
    setFires(m, b.id, 0.25)
    setLaneCost(m, m.lanes[0].id, { useCost: 1.5, hourlyCost: 20 })
    setCapacity(m, m.lanes[1].id, 2)
    setSimSettings(m, { unit: 'h', arrivals: 0.5, arrivalShape: 'exp', cases: 300, runs: 7, seed: 42 })
    return m
  }
  it('.flow.json', () => {
    const m = full()
    expect(parseModel(serializeModel(m))).toEqual(JSON.parse(JSON.stringify(m)))
  })
  it('BPMN XML (flat sf: attributes)', async () => {
    const m = full()
    const xml = await writeBpmn(m)
    for (const attr of ['sf:durationShape="normal"', 'sf:durationSd="3"', 'sf:durationMin="1"', 'sf:durationMax="30"', 'sf:waitShape="exp"', 'sf:durationShape="triangular"', 'sf:durationMode="1"', 'sf:durationShape="uniform"', 'sf:fires="0.25"', 'sf:useCost="1.5"', 'sf:hourlyCost="20"', 'sf:arrivalShape="exp"', 'sf:cases="300"', 'sf:runs="7"', 'sf:seed="42"'])
      expect(xml).toContain(attr)
    const { model, warnings } = await readBpmn(xml)
    expect(warnings).toEqual([])
    for (const n of m.nodes.filter((x) => x.sim)) expect(model.nodes.find((x) => x.id === n.id)!.sim).toEqual(n.sim)
    for (const l of m.lanes) expect(JSON.parse(JSON.stringify(model.lanes.find((x) => x.id === l.id)))).toMatchObject(JSON.parse(JSON.stringify(l)))
    expect(model.sim).toEqual(m.sim)
  })
  it('a shape the reader does not know is dropped with a warning; the figure stays, as a constant', async () => {
    const m = full()
    const xml = (await writeBpmn(m)).replace('sf:waitShape="exp"', 'sf:waitShape="weibull"').replace('sf:durationSd="3"', 'sf:durationSd="x"')
    const { model, warnings } = await readBpmn(xml)
    const t = model.nodes.find((n) => n.id === m.nodes.filter((x) => x.type === 'task')[0].id)!
    expect(t.sim).toEqual({ duration: 12, wait: 2, cost: 5 })
    expect(warnings.filter((w) => /shape/.test(w))).toHaveLength(2)
  })
  it('a .flow.json with an unknown shape or a bad number opens; those fields are dropped', () => {
    const m = full()
    const raw = JSON.parse(serializeModel(m))
    const t = raw.nodes.find((n: { sim?: { durationShape?: unknown } }) => n.sim?.durationShape)
    t.sim.durationShape = { kind: 'weibull', k: 2 }
    t.sim.waitShape = { kind: 'uniform', min: 5, max: 1 }
    raw.sim.cases = 'many'
    raw.sim.arrivalShape = 'poisson'
    raw.lanes[0].hourlyCost = -5
    const back = parseModel(JSON.stringify(raw))
    const bt = back.nodes.find((n) => n.id === t.id)!
    expect(bt.sim).toEqual({ duration: 12, wait: 2, cost: 5 })
    expect(back.sim).toEqual({ unit: 'h', arrivals: 0.5, runs: 7, seed: 42 })
    expect(back.lanes[0].hourlyCost).toBeUndefined()
  })
})

describe('analysis with lane costs', () => {
  it('adds the lane cost per use and per hour of processing to the cost of a case', () => {
    const { m, lane } = oneTask(30) // 30 min
    setSim(m, m.nodes.find((n) => n.type === 'task')!.id, { cost: 4 })
    expect(analyseModel(m)[0].cost).toBe(4)
    setLaneCost(m, lane.id, { useCost: 2, hourlyCost: 60 })
    const [a] = analyseModel(m)
    expect(a.cost).toBeCloseTo(4 + 2 + 60 * 0.5, 9) // 30 min = 0.5 h
    expect(a.steps[0].laneCost).toBeCloseTo(32, 9)
    expect(a.cycleTime).toBe(30)
    setSimSettings(m, { unit: 'h' })
    expect(analyseModel(m)[0].cost).toBeCloseTo(4 + 2 + 60 * 30, 9) // now 30 hours
  })
  it('a task outside every lane pays nothing extra', () => {
    const m = emptyModel('Free')
    const s = addNode(m, { type: 'event', position: 'start' }, { x: 0, y: 0 }, 'S')
    const t = appendNode(m, s.id, { type: 'task' }, 'T')
    setSim(m, t.id, { duration: 60, cost: 1 })
    appendNode(m, t.id, { type: 'event', position: 'end' })
    expect(analyseModel(m)[0].cost).toBe(1)
  })
})

describe('analysis with a boundary chance', () => {
  /** Start → Host (10) → [normal: After (6)] → end; boundary on Host → Handle (4, cost 5) → end. */
  function withBoundary(fires: number | undefined, interrupting: boolean) {
    const m = emptyModel('Boundary')
    const s = addNode(m, { type: 'event', position: 'start' }, { x: 60, y: 100 }, 'S')
    const host = appendNode(m, s.id, { type: 'task' }, 'Host')
    setSim(m, host.id, { duration: 10 })
    const after = appendNode(m, host.id, { type: 'task' }, 'After')
    setSim(m, after.id, { duration: 6 })
    appendNode(m, after.id, { type: 'event', position: 'end' }, 'End A')
    const b = addBoundaryEvent(m, host.id, 'timer')
    updateNode(m, b.id, { interrupting })
    const handle = addNode(m, { type: 'task' }, { x: 300, y: 260 }, 'Handle')
    setSim(m, handle.id, { duration: 4, cost: 5 })
    connect(m, b.id, handle.id)
    const end = addNode(m, { type: 'event', position: 'end' }, { x: 460, y: 260 }, 'End B')
    connect(m, handle.id, end.id)
    if (fires !== undefined) setFires(m, b.id, fires)
    return m
  }
  const runs = (m: FlowModel, n: string) => analyseModel(m)[0].steps.find((s) => s.name === n)!.runs
  it('blank or 0: the path after the event is not counted, as before (with the note)', () => {
    for (const f of [undefined, 0]) {
      const m = withBoundary(f, true)
      const [a] = analyseModel(m)
      expect(a.cycleTime).toBe(16)
      expect(runs(m, 'Handle')).toBe(0)
      expect(a.notes.some((x) => /boundary events/.test(x))).toBe(true)
    }
  })
  it('interrupting with 30 %: 70 % go on by the normal path, 30 % by the boundary path', () => {
    const m = withBoundary(0.3, true)
    const [a] = analyseModel(m)
    expect(a.cycleTime).toBeCloseTo(10 + 0.7 * 6 + 0.3 * 4, 9)
    expect(a.cost).toBeCloseTo(0.3 * 5, 9)
    expect(runs(m, 'After')).toBeCloseTo(0.7, 9)
    expect(runs(m, 'Handle')).toBeCloseTo(0.3, 9)
    expect(runs(m, 'Host')).toBeCloseTo(1, 9)
    expect(a.notes.some((x) => /boundary events/.test(x))).toBe(false)
  })
  it('interrupting with 100 %: every case takes the boundary path', () => {
    const m = withBoundary(1, true)
    expect(analyseModel(m)[0].cycleTime).toBeCloseTo(14, 9)
    expect(runs(m, 'After')).toBeCloseTo(0, 9)
  })
  it('non-interrupting with 30 %: the normal path always runs, the other one beside it; the longer sets the time', () => {
    const m = withBoundary(0.3, false)
    const [a] = analyseModel(m)
    expect(a.cycleTime).toBeCloseTo(10 + 6, 9) // After (6) is longer than Handle (4)
    expect(a.cost).toBeCloseTo(0.3 * 5, 9)
    expect(runs(m, 'After')).toBeCloseTo(1, 9)
    expect(runs(m, 'Handle')).toBeCloseTo(0.3, 9)
  })
})

describe('queue estimate per lane', () => {
  it('M/M/1 numbers: 1.5 orders an hour, 30 min each, one clerk', () => {
    const { m, lane } = oneTask(0.5)
    setSimSettings(m, { unit: 'h', arrivals: 1.5 })
    const [a] = analyseModel(m)
    expect(a.resources[0].utilisation).toBeCloseTo(0.75, 9)
    expect(a.queues).toHaveLength(1)
    expect(a.queues[0]).toMatchObject({ laneId: lane.id, servers: 1, visits: 1, overloaded: false })
    expect(a.queues[0].wait).toBeCloseTo(1.5, 9)
    setCapacity(m, lane.id, 2)
    const q = analyseModel(m)[0].queues[0]
    expect(q.wait).toBeCloseTo(0.0818, 4)
    expect(q.wait).toBeCloseTo(mmc(1.5, 0.5, 2).wq, 12)
  })
  it('ρ ≥ 1: overloaded, no number (not NaN, not Infinity)', () => {
    const { m } = oneTask(1)
    setSimSettings(m, { unit: 'h', arrivals: 1 })
    const q = analyseModel(m)[0].queues[0]
    expect(q.overloaded).toBe(true)
    expect(q.wait).toBeUndefined()
  })
  it('no arrival rate: no estimate; a fractional capacity counts as the nearest whole number, with a note', () => {
    const { m, lane } = oneTask(0.5)
    expect(analyseModel(m)[0].queues).toEqual([])
    setSimSettings(m, { unit: 'h', arrivals: 1.5 })
    setCapacity(m, lane.id, 1.6)
    const [a] = analyseModel(m)
    expect(a.queues[0].servers).toBe(2)
    expect(a.notes.some((x) => /counts as 2 people/.test(x))).toBe(true)
  })
  it('a repeated activity counts every run as a visit', () => {
    const { m } = oneTask(0.25)
    const t = m.nodes.find((n) => n.type === 'task')!
    updateNode(m, t.id, { loop: 'sequential' })
    setSim(m, t.id, { repeats: 2 })
    setSimSettings(m, { unit: 'h', arrivals: 1 })
    const q = analyseModel(m)[0].queues[0]
    expect(q.visits).toBeCloseTo(2, 9)
    expect(q.meanService).toBeCloseTo(0.25, 9)
  })
})

describe('files from before 6b keep their numbers', () => {
  it('the Kaiyo example (v0.14.0): same cycle time, cost and lane figures, and no new fields', () => {
    const m = parseModel(readFileSync('cases/kaiyo-order.flow.json', 'utf8'))
    const [a] = analyseModel(m)
    expect(a.cycleTime).toBeCloseTo(68.8, 9)
    expect(a.processingTime).toBeCloseTo(1.85, 9)
    expect(a.cost).toBeCloseTo(6 + 0.9 * (30 + 45 + 3), 9)
    expect(Object.fromEntries(a.resources.map((r) => [r.name, r.utilisation]))).toMatchObject({ Sales: 0.25, Warehouse: 0.675 })
    expect(a.resources.every((r) => r.useCost === undefined && r.hourlyCost === undefined)).toBe(true)
    expect(a.steps.every((s) => s.laneCost === 0)).toBe(true)
    expect(JSON.stringify(m)).not.toMatch(/Shape|fires|useCost|hourlyCost|"cases"|"runs"|"seed"/)
  })
  it('every shipped case analyses with no lane cost and no new field', () => {
    for (const f of readdirSync('cases').filter((x) => x.endsWith('.flow.json') || x.endsWith('.flow-case.json'))) {
      const text = readFileSync(`cases/${f}`, 'utf8')
      if (!text.includes('"format": "strata-flow"')) continue
      const m = parseModel(text)
      for (const a of analyseModel(m)) expect(a.steps.every((s) => s.laneCost === 0), f).toBe(true)
    }
  })
  it('a BPMN file with the old attributes only reads back exactly and writes the same attributes', async () => {
    const m = emptyModel('Old')
    drawOrderFulfilment(m)
    const t = m.nodes.find((n) => n.type === 'task')!
    t.sim = { duration: 12.5, wait: 3, cost: 40 }
    m.lanes[0].capacity = 3
    m.sim = { unit: 'h', arrivals: 0.5 }
    const xml = await writeBpmn(m)
    expect(xml).not.toMatch(/sf:(durationShape|waitShape|fires|useCost|hourlyCost|arrivalShape|cases|runs|seed)=/)
    const { model, warnings } = await readBpmn(xml)
    expect(warnings).toEqual([])
    expect(model.nodes.find((n) => n.id === t.id)!.sim).toEqual({ duration: 12.5, wait: 3, cost: 40 })
    expect(model.sim).toEqual({ unit: 'h', arrivals: 0.5 })
    expect(new BpmnModdle()).toBeDefined()
  })
})
