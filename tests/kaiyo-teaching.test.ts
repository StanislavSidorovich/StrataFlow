// Stage 6b phase 5, teaching: the Kaiyo example with shapes, the figures the cards and the "Try this" answers print,
// the new help cards, lesson 8 and its practice. The Kaiyo analysis figures of v0.14.0 must not move.
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { analyseModel } from '../src/core/analysis'
import { emptyModel } from '../src/core/metamodel'
import { exact, monolith } from '../src/core/queue'
import { shapeMean } from '../src/core/random'
import { parseModel } from '../src/core/serialize'
import { simulate } from '../src/core/simulate'
import { caseRefs } from '../src/data/caseRefs'
import { cardById, HELP_CARDS } from '../src/data/help'
import { LESSONS, lessonById } from '../src/data/lessons'
import { openProcess, useDocs } from '../src/ui/docs'
import { isKaiyo, openKaiyoOnRun } from '../src/ui/exampleLink'
import { useSim } from '../src/ui/panels/Simulate'
import { TRY_QUESTIONS } from '../src/ui/panels/tryQuestions'
import { useRun } from '../src/ui/simRun'
import { useEditor } from '../src/ui/store'

const kaiyo = () => parseModel(readFileSync('cases/kaiyo-order.flow.json', 'utf8'))
const lane = (m: ReturnType<typeof kaiyo>, name: string) => m.lanes.find((l) => l.name === name)!.id
const r2 = (x: number) => Math.round(x * 100) / 100
const wait = (r: ReturnType<typeof simulate>) => r.lanes.find((l) => l.name === 'Warehouse')!.meanWait

describe('Kaiyo shapes (v0.18.0)', () => {
  const m = kaiyo()
  it('gives the three timed steps a shape and keeps every mean, so the analysis does not move', () => {
    const shaped = m.nodes.filter((n) => n.sim?.durationShape)
    expect(shaped.map((n) => n.name).sort()).toEqual(['Pack goods', 'Post order in ERP', 'Ship goods'])
    for (const n of shaped) expect(shapeMean(n.sim!.durationShape, n.sim!.duration!), n.name).toBeCloseTo(n.sim!.duration!, 3)
    const [a] = analyseModel(m)
    expect(a.cycleTime).toBeCloseTo(68.8, 9)
    expect(a.processingTime).toBeCloseTo(1.85, 9)
    expect(a.cost).toBeCloseTo(6 + 0.9 * (30 + 45 + 3), 9)
    expect(m.sim).toMatchObject({ unit: 'h', arrivals: 0.5, cases: 200, runs: 5, seed: 1 })
  })
  it('level 2 stays at the formula with the shapes', () => {
    const r = simulate(m, { level: 2, cases: 4000, runs: 4, seed: 1 })
    expect(Math.abs(r.kpis.cycleTime!.mean - 68.8) / 68.8).toBeLessThan(0.01)
  })
  it('is recognised by its name', () => {
    expect(isKaiyo(m)).toBe(true)
    expect(isKaiyo(emptyModel('Other'))).toBe(false)
  })
})

describe('the figures the texts print are the ones the app computes', () => {
  it('queue card: one server of double speed against two people, warehouse of Kaiyo, 0.9 an hour, 0.75 h each', () => {
    const course = monolith(0.9, 0.75, 2)
    const more = exact(0.9, 0.75, 2)
    expect([r2(course.wq), r2(course.w)]).toEqual([0.19, 0.57])
    expect([r2(more.wq), r2(more.w)]).toEqual([0.1, 0.85])
    // the claim of the card: the shortcut understates W and overstates Wq
    expect(course.w).toBeLessThan(more.w)
    expect(course.wq).toBeGreaterThan(more.wq)
    const card = cardById('sim-queue')!.body.join(' ')
    expect(card).toContain('understates W')
    expect(card).toContain('overstates Wq')
    expect(card).toContain('Wq 0.19 h, W 0.57 h')
    expect(card).toContain('Wq 0.1 h, W 0.85 h')
    // the inputs are what the model gives for the warehouse
    const m = kaiyo()
    const q = analyseModel(m)[0].queues.find((x) => x.laneId === lane(m, 'Warehouse'))!
    expect(r2(m.sim!.arrivals! * q.visits)).toBe(0.9)
    expect(q.meanService).toBeCloseTo(0.75, 9)
  })
  it('the knee: 3, 9 and 19 times the work', () => {
    expect([0.75, 0.9, 0.95].map((rho) => Math.round(rho / (1 - rho)))).toEqual([3, 9, 19])
    expect(r2(monolith(0.75, 1, 1).wq)).toBe(3)
  })
  it('question 1: about 0.7 h of waiting for the packer in the run, the estimate 1.56 h', () => {
    const m = kaiyo()
    const run = simulate(m, { level: 3, cases: 200, runs: 5, seed: 1 })
    expect(wait(run)).toBeGreaterThan(0.6)
    expect(wait(run)).toBeLessThan(0.8)
    expect(r2(analyseModel(m)[0].queues.find((x) => x.laneId === lane(m, 'Warehouse'))!.wait!)).toBe(1.56)
    expect(TRY_QUESTIONS[0].answer).toContain('1.56 h')
  })
  it('question 2: above 100 % the wait for a person keeps growing with the run (about 11 h, then 17 h)', () => {
    const m = kaiyo()
    const at = (cases: number) => simulate(m, { level: 3, cases, runs: 5, seed: 1, overrides: { arrivalsFactor: 1.5 } })
    const a = at(200)
    const b = at(400)
    expect(a.unstable).toBe(true)
    expect(Math.round(a.kpis.resourceWait!.mean)).toBe(11)
    expect(Math.round(b.kpis.resourceWait!.mean)).toBe(17)
    expect(b.kpis.resourceWait!.mean).toBeGreaterThan(a.kpis.resourceWait!.mean)
  })
  it('question 3: a second packer removes the wait for a person and hardly moves the cycle time (70 h to 69 h)', () => {
    const m = kaiyo()
    const base = simulate(m, { level: 3, cases: 200, runs: 5, seed: 1 })
    const two = simulate(m, { level: 3, cases: 200, runs: 5, seed: 1, overrides: { capacity: { [lane(m, 'Warehouse')]: 2 } } })
    expect(base.kpis.resourceWait!.mean).toBeCloseTo(1.4, 0)
    expect(two.kpis.resourceWait!.mean).toBeCloseTo(0.2, 1)
    expect(Math.round(base.kpis.cycleTime!.mean)).toBe(70)
    expect(Math.round(two.kpis.cycleTime!.mean)).toBe(69)
    expect(two.lanes.find((l) => l.name === 'Warehouse')!.utilisation.mean).toBeCloseTo(0.35, 1)
    expect(base.kpis.cycleTime!.mean - two.kpis.cycleTime!.mean).toBeLessThan(0.05 * base.kpis.cycleTime!.mean)
  })
})

describe('help cards of the simulation', () => {
  const ids = ['sim-levels', 'sim-shape', 'sim-arrivals', 'sim-queue', 'sim-randomness', 'sim-what-if']
  it('exist, link to cards that exist and name Kaiyo (case 7 too for the what-if card)', () => {
    for (const id of ids) {
      const c = cardById(id)!
      expect(c, id).toBeDefined()
      for (const s of c.seeAlso) expect(cardById(s), `${id} → ${s}`).toBeDefined()
      expect(caseRefs(id).map((r) => r.caseId), id).toContain('kaiyo-order')
    }
    expect(caseRefs('sim-what-if').map((r) => r.caseId)).toContain('expense-claim')
    expect(caseRefs('simulation').find((r) => r.caseId === 'kaiyo-order')?.example).toBe(true)
    expect(cardById('simulation')!.body.join(' ')).toContain('Run it:')
  })
  it('write no em dash and never say the shortcut understates the waiting', () => {
    for (const c of HELP_CARDS.filter((x) => ids.includes(x.id) || x.id === 'simulation')) {
      const text = JSON.stringify(c)
      expect(text, c.id).not.toContain('—')
      expect(text, c.id).not.toMatch(/understates the wait/i)
    }
  })
})

describe('lesson 8 and its practice', () => {
  beforeEach(() => {
    useDocs.setState({ tabs: [{ id: 't0' }], active: 't0', parked: {}, closed: [] })
    useEditor.setState({ model: emptyModel('Mine'), past: [], future: [], selection: [], page: null, backup: null, doc: 0 })
    useSim.setState({ open: false, tab: 'figures' })
    useRun.setState({ level: 3 })
  })
  it('is the eighth lesson, with a guess, a trap, three test questions and existing cards', () => {
    const l = lessonById('simulate')!
    expect(LESSONS.indexOf(l)).toBe(7)
    expect(l.test).toHaveLength(3)
    for (const q of [l.guess, ...l.test]) expect(q.answer).toBeLessThan(q.options.length)
    for (const c of l.cards) expect(cardById(c), c).toBeDefined()
    expect(l.runPractice).toEqual({ level: 2 })
    expect(l.image?.file).toBe('flow-simulation.webp')
  })
  it('opens Kaiyo on Run at level 2 from a model with no sim parameters, and again does not stack a second copy', () => {
    openKaiyoOnRun(2)
    expect(isKaiyo(useEditor.getState().model)).toBe(true)
    expect(useSim.getState()).toMatchObject({ open: true, tab: 'run' })
    expect(useRun.getState().level).toBe(2)
    const tabs = useDocs.getState().tabs.length
    useRun.setState({ level: 3 })
    openKaiyoOnRun(2)
    expect(useDocs.getState().tabs).toHaveLength(tabs)
    expect(useRun.getState().level).toBe(2)
  })
  it('switches back to a Kaiyo tab parked behind another process instead of opening another', () => {
    openKaiyoOnRun(2)
    openProcess(emptyModel('Elsewhere'))
    const tabs = useDocs.getState().tabs.length
    openKaiyoOnRun(2)
    expect(isKaiyo(useEditor.getState().model)).toBe(true)
    expect(useDocs.getState().tabs).toHaveLength(tabs)
  })
})
