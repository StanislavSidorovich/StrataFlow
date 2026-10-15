// Flow analysis (stage 6): the textbook rules for sequence, decision, parallel split and rework loop,
// resource utilisation, and the notes for what cannot be counted.
import { describe, expect, it } from 'vitest'
import { analyseModel, branchShares } from '../src/core/analysis'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import { addLane, addNode, addPool, appendNode, connect, convertActivity, ModelError, setCapacity, setProbability, setSim, setSimSettings, updateNode } from '../src/core/ops'
import { CASES } from './fixtures/cases'

const flowBetween = (m: FlowModel, a: string, b: string) => m.flows.find((f) => f.source === a && f.target === b)!.id

function line(m: FlowModel, names: string[], durations: number[]) {
  let last = addNode(m, { type: 'event', position: 'start' }, { x: 60, y: 100 }, 'Start')
  const ids: string[] = []
  names.forEach((n, i) => {
    last = appendNode(m, last.id, { type: 'task' }, n)
    setSim(m, last.id, { duration: durations[i] })
    ids.push(last.id)
  })
  return { last, ids }
}

describe('flow analysis', () => {
  it('adds up a sequence and splits processing from waiting', () => {
    const m = emptyModel('Seq')
    const { last, ids } = line(m, ['Check order', 'Ship order'], [10, 20])
    setSim(m, ids[0], { wait: 5, cost: 3 })
    setSim(m, ids[1], { cost: 7 })
    appendNode(m, last.id, { type: 'event', position: 'end' }, 'Done')
    const [a] = analyseModel(m)
    expect(a.cycleTime).toBeCloseTo(35)
    expect(a.processingTime).toBeCloseTo(30)
    expect(a.waitingTime).toBeCloseTo(5)
    expect(a.efficiency).toBeCloseTo(30 / 35)
    expect(a.cost).toBeCloseTo(10)
    expect(a.steps.map((s) => s.runs)).toEqual([1, 1])
  })

  it('weights the branches of a decision by their probabilities', () => {
    const m = emptyModel('XOR')
    const { last } = line(m, ['Check claim'], [10])
    const g = appendNode(m, last.id, { type: 'gateway', kind: 'exclusive' }, 'Simple?')
    const b = appendNode(m, g.id, { type: 'task' }, 'Pay at once')
    const c = appendNode(m, g.id, { type: 'task' }, 'Assess claim')
    setSim(m, b.id, { duration: 20 })
    setSim(m, c.id, { duration: 40 })
    const j = appendNode(m, b.id, { type: 'gateway', kind: 'exclusive' })
    connect(m, c.id, j.id)
    appendNode(m, j.id, { type: 'event', position: 'end' }, 'Closed')
    setProbability(m, flowBetween(m, g.id, b.id), 0.3)
    const [a] = analyseModel(m)
    // The other branch takes what is left: 70 %.
    expect(a.cycleTime).toBeCloseTo(10 + 0.3 * 20 + 0.7 * 40)
    expect(a.steps.find((s) => s.name === 'Pay at once')!.runs).toBeCloseTo(0.3)
    expect(a.notes.some((n) => n.includes('no probabilities'))).toBe(false)
  })

  it('takes the longest parallel branch for time and all branches for cost', () => {
    const m = emptyModel('AND')
    const { last } = line(m, ['Receive order'], [10])
    const g = appendNode(m, last.id, { type: 'gateway', kind: 'parallel' })
    const b = appendNode(m, g.id, { type: 'task' }, 'Pack goods')
    const c = appendNode(m, g.id, { type: 'task' }, 'Write invoice')
    setSim(m, b.id, { duration: 20, cost: 1 })
    setSim(m, c.id, { duration: 30, cost: 1 })
    const j = appendNode(m, b.id, { type: 'gateway', kind: 'parallel' })
    connect(m, c.id, j.id)
    const d = appendNode(m, j.id, { type: 'task' }, 'Ship goods')
    setSim(m, d.id, { duration: 5, cost: 2 })
    appendNode(m, d.id, { type: 'event', position: 'end' }, 'Shipped')
    const [a] = analyseModel(m)
    expect(a.cycleTime).toBeCloseTo(45)
    expect(a.cost).toBeCloseTo(4)
    expect(a.steps.find((s) => s.name === 'Ship goods')!.runs).toBeCloseTo(1)
  })

  it('solves a rework loop as T / (1 - r)', () => {
    const m = emptyModel('Rework')
    const { last, ids } = line(m, ['Write report', 'Review report'], [10, 20])
    const g = appendNode(m, last.id, { type: 'gateway', kind: 'exclusive' }, 'Report OK?')
    const end = appendNode(m, g.id, { type: 'event', position: 'end' }, 'Report done')
    connect(m, g.id, ids[0])
    setProbability(m, flowBetween(m, g.id, end.id), 0.8)
    const [a] = analyseModel(m)
    expect(a.cycleTime).toBeCloseTo(30 / 0.8)
    expect(a.steps[0].runs).toBeCloseTo(1.25)
  })

  it('assumes equal branches without probabilities and scales a wrong sum, with a note', () => {
    const notes: string[] = []
    const f = (id: string, probability?: number) => ({ id, kind: 'sequence' as const, source: 'g', target: id, name: '', probability })
    expect([...branchShares([f('a'), f('b')], (t) => notes.push(t)).values()]).toEqual([0.5, 0.5])
    expect([...branchShares([f('a', 0.6), f('b', 0.6)], (t) => notes.push(t)).values()]).toEqual([0.5, 0.5])
    expect(notes).toHaveLength(2)
  })

  it('reports a loop no case leaves instead of a number', () => {
    const m = emptyModel('Stuck')
    const { last, ids } = line(m, ['Try again'], [10])
    const g = appendNode(m, last.id, { type: 'gateway', kind: 'exclusive' }, 'Works?')
    const end = appendNode(m, g.id, { type: 'event', position: 'end' }, 'Works')
    connect(m, g.id, ids[0])
    setProbability(m, flowBetween(m, g.id, end.id), 0)
    const [a] = analyseModel(m)
    expect(a.cycleTime).toBeUndefined()
    expect(a.notes.some((n) => n.includes('never lets the case go'))).toBe(true)
  })

  it('counts the content of a sub-process and the repeats of a loop', () => {
    const m = emptyModel('Sub')
    const { last } = line(m, ['Prepare'], [10])
    const sp = appendNode(m, last.id, { type: 'task' }, 'Handle papers')
    convertActivity(m, sp.id, 'subProcess')
    updateNode(m, sp.id, { collapsed: false })
    const s = m.diagram.shapes[sp.id]
    Object.assign(s, { y: s.y - 100, width: 400, height: 250 })
    const inner = addNode(m, { type: 'event', position: 'start' }, { x: s.x + 40, y: s.y + 120 })
    expect(m.nodes.find((n) => n.id === inner.id)!.parentId).toBe(sp.id)
    const t = appendNode(m, inner.id, { type: 'task' }, 'Sign papers')
    setSim(m, t.id, { duration: 4 })
    appendNode(m, t.id, { type: 'event', position: 'end' })
    updateNode(m, sp.id, { loop: 'sequential' })
    setSim(m, sp.id, { repeats: 3, wait: 2 })
    appendNode(m, sp.id, { type: 'event', position: 'end' }, 'Done')
    const [a] = analyseModel(m)
    expect(a.cycleTime).toBeCloseTo(10 + 3 * 4 + 2)
    expect(a.steps.find((x) => x.name === 'Sign papers')!.runs).toBeCloseTo(3)
  })

  it('gives each lane its work per case and utilisation at the arrival rate', () => {
    const m = emptyModel('Lanes')
    addPool(m, { x: 0, y: 0 }, 'Shop')
    const clerk = m.lanes[0] ?? addLane(m, 'Participant_1', 'Clerk')
    const start = addNode(m, { type: 'event', position: 'start' }, { x: 80, y: m.diagram.shapes[clerk.id].y + 60 }, 'Order received')
    const t = appendNode(m, start.id, { type: 'task' }, 'Pick goods')
    setSim(m, t.id, { duration: 30 })
    appendNode(m, t.id, { type: 'event', position: 'end' }, 'Picked')
    setCapacity(m, clerk.id, 2)
    setSimSettings(m, { arrivals: 0.05 })
    const [a] = analyseModel(m)
    expect(a.resources).toEqual([{ laneId: clerk.id, name: clerk.name || 'Lane', capacity: 2, work: 30, utilisation: 0.75 }])
    setSimSettings(m, { arrivals: 0.1 })
    expect(analyseModel(m)[0].notes.some((n) => n.includes('overloaded'))).toBe(true)
  })

  it('refuses figures that make no sense', () => {
    const m = emptyModel()
    const { ids } = line(m, ['Do work'], [1])
    expect(() => setSim(m, ids[0], { duration: -1 })).toThrow(ModelError)
    expect(() => setSim(m, 'Event_1', { wait: 1 })).toThrow(ModelError)
    expect(() => setProbability(m, m.flows[0].id, 0.5)).toThrow(ModelError)
    setSim(m, ids[0], { duration: undefined })
    expect(m.nodes.find((n) => n.id === ids[0])!.sim).toBeUndefined()
  })

  it('analyses every case without a figure and settles', () => {
    for (const c of CASES) {
      const m = emptyModel(c.name)
      c.draw(m)
      const all = analyseModel(m)
      expect(all.length, c.id).toBeGreaterThan(0)
      for (const a of all) {
        if (!m.sim) expect(a.cycleTime, `${c.id} ${a.name}`).toBe(0)
        else expect(a.cycleTime, `${c.id} ${a.name}`).toBeGreaterThan(0)
        expect(a.steps.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('token play', () => {
  it('plays a decision by the user and a parallel split and join', async () => {
    const { startPlay, stepPlay, playOn } = await import('../src/core/play')
    const m = emptyModel('Play')
    const { last } = line(m, ['Receive order'], [10])
    const g = appendNode(m, last.id, { type: 'gateway', kind: 'exclusive' }, 'In stock?')
    const no = appendNode(m, g.id, { type: 'event', position: 'end' }, 'Order rejected')
    const and = appendNode(m, g.id, { type: 'gateway', kind: 'parallel' })
    const b = appendNode(m, and.id, { type: 'task' }, 'Pack goods')
    const c = appendNode(m, and.id, { type: 'task' }, 'Write invoice')
    setSim(m, b.id, { duration: 20 })
    setSim(m, c.id, { duration: 30 })
    const j = appendNode(m, b.id, { type: 'gateway', kind: 'parallel' })
    connect(m, c.id, j.id)
    appendNode(m, j.id, { type: 'event', position: 'end' }, 'Shipped')

    let s = playOn(m, startPlay(m))
    expect(s.choice?.node).toBe(g.id)
    s = stepPlay(m, s, flowBetween(m, g.id, and.id))
    s = playOn(m, s)
    expect(s.done).toBe(true)
    expect(s.time).toBe(40)
    expect(s.log.at(-1)).toBe('Case done after 40')

    s = playOn(m, startPlay(m), { decide: true, random: () => 0 })
    expect(s.done).toBe(true)
    expect(s.log).toContain('In stock? → Order rejected')
    expect(no.id).toBeTruthy()
  })

  it('gets stuck on a parallel join after a decision, and plays every case', async () => {
    const { startPlay, playOn } = await import('../src/core/play')
    const m = emptyModel('Deadlock')
    const { last } = line(m, ['Check'], [1])
    const g = appendNode(m, last.id, { type: 'gateway', kind: 'exclusive' }, 'OK?')
    const a = appendNode(m, g.id, { type: 'task' }, 'Do A')
    const b = appendNode(m, g.id, { type: 'task' }, 'Do B')
    const j = appendNode(m, a.id, { type: 'gateway', kind: 'parallel' })
    connect(m, b.id, j.id)
    appendNode(m, j.id, { type: 'event', position: 'end' })
    const s = playOn(m, startPlay(m), { decide: true, random: () => 0 })
    expect(s.done).toBe(true)
    expect(s.log.at(-1)).toMatch(/^Stuck/)

    for (const c of CASES) {
      const cm = emptyModel(c.name)
      c.draw(cm)
      for (const p of cm.participants.filter((x) => x.processId)) {
        let r = 0
        const end = playOn(cm, startPlay(cm, p.id), { decide: true, random: () => (r = (r + 0.37) % 1), limit: 2000 })
        expect(end.done, `${c.id} ${p.name}: ${end.log.slice(-3).join(' | ')}`).toBe(true)
        expect(end.log.at(-1), `${c.id} ${p.name}`).toMatch(/^Case done/)
      }
    }
  })
})
