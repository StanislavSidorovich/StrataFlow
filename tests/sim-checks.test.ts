// v0.20.0 simulation checks: overload, the line on why Run sits above Formula, the typed-wait shape, tab names, the
// distribution sketch. Generic models only (the Kaiyo case and small made-up ones).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { analyseModel } from '../src/core/analysis'
import { parseModel } from '../src/core/serialize'
import { simulate } from '../src/core/simulate'
import { overloadedLanes, whyRunHigher } from '../src/core/runNotes'
import { shapeCurve } from '../src/core/random'
import { uniqueNames } from '../src/core/uniqueNames'
import { applyChanges, checkChange, describeChange, resolveChanges, waitShapeNote, type Change } from '../src/core/whatIf'
import { labelOf } from '../src/core/simLabels'

const kaiyo = parseModel(readFileSync('cases/kaiyo-order.flow.json', 'utf8'))
const formula = analyseModel(kaiyo)[0]
const withArrivals = (k: number) => {
  const m = structuredClone(kaiyo)
  m.sim = { ...m.sim, arrivals: (m.sim?.arrivals ?? 0.5) * k }
  return m
}

describe('overload', () => {
  it('no lane is flagged at a normal load; a lane at arrivals ×25 is', () => {
    const calm = simulate(kaiyo, { level: 3, cases: 100, runs: 2, seed: 1 })
    expect(overloadedLanes(calm, formula)).toEqual([])
    const hot = simulate(withArrivals(25), { level: 3, cases: 100, runs: 2, seed: 1 })
    const over = overloadedLanes(hot, analyseModel(withArrivals(25))[0])
    expect(over.length).toBeGreaterThan(0)
    expect(over.every((l) => l.load >= 1 && l.name)).toBe(true)
  })

  it('a load of exactly 100 % counts as overloaded', () => {
    const r = simulate(kaiyo, { level: 3, cases: 50, runs: 1, seed: 1 })
    const fake = { ...r, lanes: r.lanes.map((l, i) => (i === 0 ? { ...l, utilisation: { ...l.utilisation, mean: 1 } } : { ...l, utilisation: { ...l.utilisation, mean: 0.2 } })) }
    expect(overloadedLanes(fake, undefined).map((l) => l.laneId)).toEqual([r.lanes[0].laneId])
  })
})

describe('why Run is above Formula', () => {
  it('stays quiet when the run is close; names the queues at level 3 when it is far above', () => {
    const r = simulate(kaiyo, { level: 2, cases: 200, runs: 3, seed: 1 })
    const close = { ...r, kpis: { ...r.kpis, cycleTime: { mean: formula.cycleTime!, min: 0, max: 0 } } }
    expect(whyRunHigher(close, formula, kaiyo)).toBeUndefined()
    const high = { ...r, level: 3 as const, kpis: { ...r.kpis, cycleTime: { mean: formula.cycleTime! * 1.4, min: 0, max: 0 }, resourceWait: { mean: formula.cycleTime! * 0.3, min: 0, max: 0 } } }
    const line = whyRunHigher(high, formula, kaiyo)!
    expect(line).toContain('40 % above')
    expect(line).toContain('queue')
    expect(line).toContain('random')
  })

  it('mentions the AND join only when the model has one', () => {
    const r = simulate(kaiyo, { level: 2, cases: 100, runs: 2, seed: 1 })
    const high = { ...r, kpis: { ...r.kpis, cycleTime: { mean: formula.cycleTime! * 1.5, min: 0, max: 0 } } }
    const has = kaiyo.nodes.some((n) => n.type === 'gateway' && n.kind === 'parallel' && kaiyo.flows.filter((f) => f.target === n.id).length > 1)
    expect(whyRunHigher(high, formula, kaiyo)?.includes('AND join')).toBe(has)
    const plain = structuredClone(kaiyo)
    plain.nodes = plain.nodes.map((n) => (n.type === 'gateway' && n.kind === 'parallel' ? { ...n, kind: 'exclusive' as const } : n))
    expect(whyRunHigher(high, formula, plain)?.includes('AND join')).toBe(false)
  })
})

describe('what-if typed wait', () => {
  const task = kaiyo.nodes.find((n) => n.type === 'task' && n.sim?.duration !== undefined)!
  const id = task.id
  const tri: Change = { kind: 'wait', id, value: (4 + 20 + 40) / 3, tri: { min: 4, mode: 20, max: 40 } }

  it('a triangular wait replaces the shape in the run and in the model', () => {
    expect(checkChange(kaiyo, tri)).toBeUndefined()
    const o = resolveChanges(kaiyo, [tri]).overrides
    expect(o.elements![id].waitShape).toEqual({ kind: 'triangular', min: 4, mode: 20, max: 40 })
    const m = structuredClone(kaiyo)
    applyChanges(m, [tri])
    expect(m.nodes.find((n) => n.id === id)!.sim!.waitShape).toEqual({ kind: 'triangular', min: 4, mode: 20, max: 40 })
    expect(describeChange(kaiyo, tri)).toContain('triangular 4 / 20 / 40')
  })

  it('refuses min above likely, equal ends and negatives', () => {
    expect(checkChange(kaiyo, { ...tri, tri: { min: 30, mode: 20, max: 40 } })).toBeTruthy()
    expect(checkChange(kaiyo, { ...tri, tri: { min: 5, mode: 5, max: 5 } })).toBeTruthy()
    expect(checkChange(kaiyo, { ...tri, tri: { min: -1, mode: 2, max: 3 } })).toBeTruthy()
  })

  it('the note says what happens to the old shape', () => {
    const m = structuredClone(kaiyo)
    const n = m.nodes.find((x) => x.id === id)!
    n.sim = { ...n.sim, wait: 10, waitShape: { kind: 'triangular', min: 4, mode: 8, max: 18 } }
    expect(waitShapeNote(m, id)).toMatch(/triangular 4 \/ 8 \/ 18/)
    expect(waitShapeNote(m, id)).toMatch(/multiplied by the same factor/)
    n.sim.waitShape = { kind: 'normal', sd: 2 }
    expect(waitShapeNote(m, id)).toMatch(/keeps its σ of 2/)
    delete n.sim.waitShape
    expect(waitShapeNote(m, id)).toMatch(/replaces it/)
  })
})

describe('tab names and the distribution sketch', () => {
  it('equal names get (2), (3); names that already end in (2) are not reused', () => {
    expect(uniqueNames(['A', 'B', 'A', 'A'])).toEqual(['A', 'B', 'A (2)', 'A (3)'])
    expect(uniqueNames(['A', 'A', 'A (2)'])).toEqual(['A', 'A (3)', 'A (2)'])
    expect(uniqueNames([])).toEqual([])
  })

  it('draws triangular, uniform, normal and exponential; nothing without numbers', () => {
    const t = shapeCurve({ kind: 'triangular', min: 1, mode: 2, max: 6 }, 3)!
    expect(t.pts).toEqual([[1, 0], [2, 1], [6, 0]])
    expect(shapeCurve({ kind: 'uniform', min: 1, max: 3 }, 2)!.pts).toHaveLength(4)
    const n = shapeCurve({ kind: 'normal', sd: 2 }, 10)!
    expect(Math.max(...n.pts.map((p) => p[1]))).toBe(1)
    expect(n.x0).toBeCloseTo(4)
    const e = shapeCurve({ kind: 'exp' }, 4)!
    expect(e.pts[0][1]).toBe(1)
    expect(e.pts.at(-1)![1]).toBeLessThan(0.01)
    expect(shapeCurve({ kind: 'exp' }, undefined)).toBeUndefined()
    expect(shapeCurve({ kind: 'normal', sd: 0 }, 5)).toBeUndefined()
    expect(shapeCurve({ kind: 'triangular', min: 2, mode: 2, max: 2 }, 2)).toBeUndefined()
    expect(shapeCurve({ kind: 'triangular', min: 5, mode: 2, max: 1 }, 2)).toBeUndefined()
  })

  it('a stuck element reads by its label, not by its id', () => {
    const gw = kaiyo.nodes.find((n) => n.type === 'gateway')!
    expect(labelOf(kaiyo, gw.id)).not.toBe(gw.id)
  })
})
