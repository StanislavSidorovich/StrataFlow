// Stage 6b phase 4: what-if scenarios. Changes become engine overrides (and say what they ignored or rebalanced),
// base and scenario on the same seed see the same arrivals, the scenario applies to the model as one edit, and the
// targets, deltas, pins and the "N cases in T" helper behave at their edges.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseModel } from '../src/core/serialize'
import { simulate, Simulation } from '../src/core/simulate'
import { exact, mmc, monolith, staffingOptions } from '../src/core/queue'
import { applyChanges, arrivalWindow, checkChange, compareResults, deltaOf, describeChange, meetsTarget, metricsOf, parseTime, picksFor, pinRun, pinTable, resolveChanges, summaryRows, validTarget, withChange, MAX_PINS, type Change } from '../src/core/whatIf'
import { deleteElements, setSimSettings } from '../src/core/ops'

const kaiyo = () => parseModel(readFileSync('cases/kaiyo-order.flow.json', 'utf8'))
const L3 = { level: 3 as const, cases: 200, runs: 3, seed: 1 }

describe('scenario against base (Kaiyo)', () => {
  it('same seed: identical arrivals in the base and in every scenario', () => {
    const m = kaiyo()
    const base = simulate(m, L3)
    const scenarios: Change[][] = [[{ kind: 'capacity', id: 'Lane_2', value: 2 }], [{ kind: 'arrivals', factor: 1.5 }], [{ kind: 'skip', id: 'Task_2' }], [{ kind: 'duration', id: 'Task_2', value: 0.5 }]]
    for (const changes of scenarios) {
      const r = resolveChanges(m, changes)
      const s = simulate(m, { ...L3, overrides: r.overrides })
      const factor = changes[0].kind === 'arrivals' ? 1.5 : 1
      base.runs.forEach((b, i) => {
        expect(s.runs[i].firstArrival).toBeCloseTo(b.firstArrival / factor, 9)
        expect(s.runs[i].lastArrival).toBeCloseTo(b.lastArrival / factor, 9)
        expect(s.runs[i].started).toBe(b.started)
      })
      expect(s.seed).toBe(base.seed)
    }
  })

  it('running a scenario twice, or the base twice, gives identical results', () => {
    const m = kaiyo()
    const o = resolveChanges(m, [{ kind: 'capacity', id: 'Lane_2', value: 2 }]).overrides
    expect(simulate(m, { ...L3, overrides: o })).toEqual(simulate(m, { ...L3, overrides: o }))
    expect(simulate(m, L3)).toEqual(simulate(m, L3))
  })

  it('"warehouse capacity +1" lowers the wait for a person; "skip a step" lowers the cycle time', () => {
    const m = kaiyo()
    const base = simulate(m, L3)
    const cap = simulate(m, { ...L3, overrides: resolveChanges(m, [{ kind: 'capacity', id: 'Lane_2', value: 2 }]).overrides })
    expect(cap.kpis.resourceWait!.mean).toBeLessThan(base.kpis.resourceWait!.mean)
    const skip = simulate(m, { ...L3, overrides: resolveChanges(m, [{ kind: 'skip', id: 'Task_2' }]).overrides })
    expect(skip.kpis.cycleTime!.mean).toBeLessThan(base.kpis.cycleTime!.mean)
    const rows = compareResults(base, cap)
    const wait = rows.find((r) => r.metric.key === 'resWait')!
    expect(wait.delta!.verdict).toBe('better')
    expect(wait.delta!.delta).toBeLessThan(0)
    expect(rows.find((r) => r.metric.key === 'util:Lane_2')!.delta!.verdict).toBe('none')
  })

  it('the engine takes the scenario without touching the model', () => {
    const m = kaiyo()
    const before = JSON.stringify(m)
    new Simulation(m, { ...L3, overrides: resolveChanges(m, [{ kind: 'skip', id: 'Task_2' }, { kind: 'capacity', id: 'Lane_2', value: 3 }]).overrides }).step(1e9)
    expect(JSON.stringify(m)).toBe(before)
  })
})

describe('changes to overrides: edges', () => {
  it('no changes: empty overrides', () => {
    const r = resolveChanges(kaiyo(), [])
    expect(r.overrides).toEqual({})
    expect(r.dead).toEqual([])
  })

  it('an override on an element deleted since is marked and ignored', () => {
    const m = kaiyo()
    const changes: Change[] = [{ kind: 'duration', id: 'Task_2', value: 0.5 }, { kind: 'capacity', id: 'Lane_2', value: 2 }]
    deleteElements(m, ['Task_2'])
    const r = resolveChanges(m, changes)
    expect(r.dead).toEqual([changes[0]])
    expect(r.overrides.elements).toBeUndefined()
    expect(r.overrides.capacity).toEqual({ Lane_2: 2 })
    expect(r.notes.join(' ')).toMatch(/no longer in the model/)
    expect(() => simulate(m, { ...L3, overrides: r.overrides })).not.toThrow()
  })

  it('a branch override rebalances the others proportionally and says so', () => {
    const m = kaiyo()
    const r = resolveChanges(m, [{ kind: 'branch', id: 'Flow_3', value: 0.4 }])
    expect(r.probabilities.Flow_3).toBeCloseTo(0.4, 9)
    expect(r.probabilities.Flow_4).toBeCloseTo(0.6, 9)
    expect(r.notes.join(' ')).toMatch(/share the remaining 60 %/)
    const m3 = kaiyo()
    m3.flows.push({ id: 'F9', kind: 'sequence', source: 'Gateway_1', target: 'Event_2', name: 'c', probability: 0.3 })
    m3.flows.find((f) => f.id === 'Flow_3')!.probability = 0.2
    m3.flows.find((f) => f.id === 'Flow_4')!.probability = 0.5
    const r3 = resolveChanges(m3, [{ kind: 'branch', id: 'Flow_3', value: 0.5 }])
    expect(r3.probabilities.Flow_4! / r3.probabilities.F9!).toBeCloseTo(0.5 / 0.3, 9)
    expect(Object.values(r3.probabilities).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9)
  })

  it('a branch set to 100 % leaves the others at 0; two branches above 100 % are scaled', () => {
    const m = kaiyo()
    expect(resolveChanges(m, [{ kind: 'branch', id: 'Flow_3', value: 1 }]).probabilities.Flow_4).toBeCloseTo(0, 9)
    const r = resolveChanges(m, [{ kind: 'branch', id: 'Flow_3', value: 0.8 }, { kind: 'branch', id: 'Flow_4', value: 0.8 }])
    expect(r.probabilities.Flow_3 + r.probabilities.Flow_4).toBeCloseTo(1, 9)
    expect(r.notes.join(' ')).toMatch(/160 %/)
  })

  it('capacity 0 is refused by the check, and counts as 1 if it gets through', () => {
    const m = kaiyo()
    expect(checkChange(m, { kind: 'capacity', id: 'Lane_2', value: 0 })).toMatch(/At least 1/)
    expect(checkChange(m, { kind: 'capacity', id: 'Lane_2', value: 2 })).toBeUndefined()
    const r = resolveChanges(m, [{ kind: 'capacity', id: 'Lane_2', value: 0 }])
    expect(r.overrides.capacity).toEqual({ Lane_2: 1 })
    expect(r.notes.join(' ')).toMatch(/at least 1/)
  })

  it('checks: shares 0-100 %, no negative time, element must fit the kind', () => {
    const m = kaiyo()
    expect(checkChange(m, { kind: 'branch', id: 'Flow_3', value: 1.2 })).toMatch(/0 to 100/)
    expect(checkChange(m, { kind: 'duration', id: 'Task_2', value: -1 })).toMatch(/below 0/)
    expect(checkChange(m, { kind: 'duration', id: 'Lane_2', value: 1 })).toMatch(/Pick/)
    expect(checkChange(m, { kind: 'arrivals', factor: 0 })).toMatch(/above 0/)
    expect(checkChange(m, { kind: 'skip', id: 'Task_2' })).toBeUndefined()
  })

  it('skip of a task with a boundary event: the event never happens, and the note says so', () => {
    const m = kaiyo()
    m.nodes.push({ id: 'B1', name: 'Out of stock', type: 'event', position: 'boundary', trigger: 'error', throwing: false, attachedTo: 'Task_2', participantId: m.nodes.find((n) => n.id === 'Task_2')!.participantId, sim: { fires: 0.3 } } as never)
    const r = resolveChanges(m, [{ kind: 'skip', id: 'Task_2' }])
    expect(r.notes.join(' ')).toMatch(/Out of stock.*never happens/)
    const s = simulate(m, { ...L3, overrides: r.overrides })
    expect(s.elements.find((e) => e.id === 'B1')?.started ?? 0).toBe(0)
    expect(validTarget(m, 'fires', 'B1')).toBe(true)
  })

  it('pickers offer what fits: lanes, tasks, decision branches', () => {
    const m = kaiyo()
    expect(picksFor(m, 'capacity').map((p) => p.label)).toEqual(['Sales', 'Warehouse', 'Finance'])
    expect(picksFor(m, 'duration').map((p) => p.label)).toContain('Pack goods')
    expect(picksFor(m, 'branch').map((p) => p.id)).toEqual(expect.arrayContaining(['Flow_3', 'Flow_4']))
    expect(picksFor(m, 'arrivals')).toEqual([])
  })

  it('one change per kind and element: the later replaces the earlier', () => {
    const a: Change = { kind: 'capacity', id: 'Lane_2', value: 2 }
    const b: Change = { kind: 'capacity', id: 'Lane_2', value: 3 }
    expect(withChange([a], b)).toEqual([b])
    expect(withChange([a], { kind: 'skip', id: 'Task_2' })).toHaveLength(2)
  })

  it('describes changes the way a person would say them', () => {
    const m = kaiyo()
    expect(describeChange(m, { kind: 'capacity', id: 'Lane_2', value: 2 })).toBe('Warehouse 1 → 2')
    expect(describeChange(m, { kind: 'arrivals', factor: 1.5 })).toBe('arrivals × 1.5')
    expect(describeChange(m, { kind: 'duration', id: 'Task_2', value: 0.5 })).toBe('Pack goods time 1 → 0.5 h')
    expect(describeChange(m, { kind: 'skip', id: 'Task_2' })).toBe('skip Pack goods')
    expect(describeChange(m, { kind: 'branch', id: 'Flow_3', value: 0.05 })).toMatch(/10 % → 5 %/)
  })
})

describe('apply to the model', () => {
  it('writes the changes into the model', () => {
    const m = kaiyo()
    const notes = applyChanges(m, [{ kind: 'capacity', id: 'Lane_2', value: 2 }, { kind: 'arrivals', factor: 1.5 }, { kind: 'duration', id: 'Task_2', value: 0.5 }, { kind: 'branch', id: 'Flow_3', value: 0.4 }, { kind: 'skip', id: 'Task_4' }])
    expect(m.lanes.find((l) => l.id === 'Lane_2')!.capacity).toBe(2)
    expect(m.sim!.arrivals).toBeCloseTo(0.75, 9)
    expect(m.nodes.find((n) => n.id === 'Task_2')!.sim!.duration).toBe(0.5)
    expect(m.flows.find((f) => f.id === 'Flow_3')!.probability).toBeCloseTo(0.4, 9)
    expect(m.flows.find((f) => f.id === 'Flow_4')!.probability).toBeCloseTo(0.6, 9)
    expect(m.nodes.find((n) => n.id === 'Task_4')!.sim).toMatchObject({ duration: 0, wait: 0, cost: 0 })
    expect(notes.join(' ')).toMatch(/stays on the diagram/)
  })

  it('applying what was simulated gives the same result as the override run', () => {
    const m = kaiyo()
    const changes: Change[] = [{ kind: 'capacity', id: 'Lane_2', value: 2 }, { kind: 'duration', id: 'Task_2', value: 0.75 }]
    const viaOverrides = simulate(m, { ...L3, overrides: resolveChanges(m, changes).overrides })
    const applied = kaiyo()
    applyChanges(applied, changes)
    expect(simulate(applied, L3).kpis.cycleTime!.mean).toBeCloseTo(viaOverrides.kpis.cycleTime!.mean, 9)
  })

  it('arrivals x k needs a rate, and a change on a deleted element is skipped', () => {
    const m = kaiyo()
    setSimSettings(m, { arrivals: undefined })
    expect(() => applyChanges(m, [{ kind: 'arrivals', factor: 2 }])).toThrow(/rate/)
    const k = kaiyo()
    deleteElements(k, ['Task_2'])
    expect(() => applyChanges(k, [{ kind: 'duration', id: 'Task_2', value: 1 }])).not.toThrow()
  })
})

describe('targets, deltas, pins', () => {
  it('target pass and fail follow the direction of better', () => {
    expect(meetsTarget({ better: 'lower' }, 38, 40)).toBe(true)
    expect(meetsTarget({ better: 'lower' }, 41, 40)).toBe(false)
    expect(meetsTarget({ better: 'higher' }, 0.9, 0.95)).toBe(false)
    expect(meetsTarget({ better: 'none' }, 1, 1)).toBeUndefined()
    expect(meetsTarget({ better: 'lower' }, undefined, 40)).toBeUndefined()
    expect(meetsTarget({ better: 'lower' }, 1, undefined)).toBeUndefined()
  })

  it('delta and delta %, with a base of 0 and equal values', () => {
    expect(deltaOf(10, 8, 'lower')).toMatchObject({ delta: -2, pct: -0.2, verdict: 'better' })
    expect(deltaOf(10, 12, 'lower')?.verdict).toBe('worse')
    expect(deltaOf(0.5, 0.6, 'higher')?.verdict).toBe('better')
    expect(deltaOf(0, 3, 'lower')).toMatchObject({ delta: 3, pct: undefined, verdict: 'worse' })
    expect(deltaOf(5, 5, 'lower')?.verdict).toBe('same')
    expect(deltaOf(undefined, 5, 'lower')).toBeUndefined()
  })

  it('the cycle-time target gives the share of cases within it, in both runs', () => {
    const m = kaiyo()
    const base = simulate(m, { ...L3, target: 70 })
    const skip = simulate(m, { ...L3, target: 70, overrides: resolveChanges(m, [{ kind: 'skip', id: 'Task_2' }]).overrides })
    const get = (r: typeof base) => metricsOf(r).find((x) => x.key === 'onTime')!.value!
    expect(get(skip)).toBeGreaterThan(get(base))
  })

  it('pins: at most three, base first, figures only, summary row judged on a target with a cost', () => {
    const m = kaiyo()
    const base = simulate(m, L3)
    const cap = simulate(m, { ...L3, overrides: resolveChanges(m, [{ kind: 'capacity', id: 'Lane_2', value: 2 }]).overrides })
    const pins = [pinRun(base, 'Base', []), { ...pinRun(cap, 'Warehouse 1 → 2', ['Warehouse 1 → 2']), cost: 2000 }]
    expect(MAX_PINS).toBe(3)
    expect(JSON.parse(JSON.stringify(pins))).toEqual(pins)
    const table = pinTable(pins)
    const wait = table.find((r) => r.metric.key === 'resWait')!
    expect(wait.cols[0].delta).toBeUndefined()
    expect(wait.cols[1].delta!.verdict).toBe('better')
    const target = (base.kpis.resourceWait!.mean + cap.kpis.resourceWait!.mean) / 2
    const sum = summaryRows(pins, 'resWait', { resWait: target })
    expect(sum.map((s) => s.verdict)).toEqual(['fail', 'pass'])
    expect(sum[1].cost).toBe(2000)
    expect(summaryRows(pins, 'resWait', {}).map((s) => s.verdict)).toEqual(['none', 'none'])
    expect(summaryRows(pins, undefined, {})).toEqual([])
  })
})

describe('numbers with units', () => {
  it('a bare number is in the model unit; a suffix converts; comma decimals work', () => {
    expect(parseTime('1,5', 'h').value).toBe(1.5)
    expect(parseTime('90 min', 'h')).toMatchObject({ value: 1.5, converted: '90 min = 1.5 h' })
    expect(parseTime('90min', 'h').value).toBe(1.5)
    expect(parseTime('1 h', 'min').value).toBe(60)
    expect(parseTime('2 d', 'h').value).toBe(48)
    expect(parseTime('30 min', 'min')).toEqual({ value: 30 })
    expect(parseTime('2 days', 'h').value).toBe(48)
    expect(parseTime('', 'h')).toEqual({})
    expect(parseTime('3 parsecs', 'h').error).toMatch(/Unknown unit/)
    expect(parseTime('1.000,5', 'h').error).toBeTruthy()
    expect(parseTime('abc', 'h').error).toBeTruthy()
  })

  it('N cases in T gives the arrival rate and the interval', () => {
    expect(arrivalWindow(200, 400)).toEqual({ rate: 0.5, interval: 2 })
    expect(arrivalWindow(0, 10)).toBeUndefined()
    expect(arrivalWindow(10, 0)).toBeUndefined()
    expect(arrivalWindow(NaN, 1)).toBeUndefined()
  })
})

describe('queue: the course against M/M/c, and the options', () => {
  it('the monolith M/M/1 with mu = c*mu1 understates the total time W of M/M/c (the queue wait Wq goes the other way)', () => {
    const course = monolith(1.5, 1, 2)
    const more = exact(1.5, 1, 2)
    expect(course.rho).toBeCloseTo(more.rho, 12)
    expect(course.wq).toBeCloseTo(0.75 / (2 - 1.5), 9)
    expect(more.wq).toBeCloseTo(mmc(1.5, 1, 2).wq, 12)
    expect(course.w).toBeLessThan(more.w) // 2 h against 2.29 h
    expect(course.wq).toBeGreaterThan(more.wq) // 1.5 h against 1.29 h
    expect(monolith(0.75, 1, 1).wq).toBeCloseTo(exact(0.75, 1, 1).wq, 12)
  })

  it('options: add a person against a second team; W = Wq + service', () => {
    const [now, person, team] = staffingOptions(0.9, 1, 1)
    expect(now.course.wq).toBeCloseTo(9, 9)
    expect(person.course.stable && person.course.wq < now.course.wq).toBe(true)
    expect(team.course.servers).toBe(2)
    expect(team.course.wq).toBeCloseTo(mmc(0.9, 1, 2).wq, 12)
    expect(person.course.w).toBeCloseTo(person.course.wq + person.course.service, 12)
    const [over, fixed] = staffingOptions(1.2, 1, 1)
    expect(over.course.stable).toBe(false)
    expect(fixed.course.stable).toBe(true)
  })
})
