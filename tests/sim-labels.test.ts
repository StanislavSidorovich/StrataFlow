// v0.19.0: readable labels in the Simulate tables and the what-if lists. Equal names show their lane (and a number when
// the lane repeats), an unnamed gateway says what it is and what follows, small rates keep their digits, a scenario
// without a name is "Scenario n", and a model with no rates has no cost to show.
import { describe, expect, it } from 'vitest'
import { analyseModel } from '../src/core/analysis'
import { emptyModel, type FlowModel, type FlowNode } from '../src/core/metamodel'
import { defaultScenarioName, foldRepeats, hasRates, labelMap, labelOf, plainLabel, sig } from '../src/core/simLabels'
import { describeChange, describeChanges, picksFor } from '../src/core/whatIf'
import { simulate } from '../src/core/simulate'

const task = (id: string, name: string, laneId?: string): FlowNode => ({ id, name, type: 'task', kind: 'task', laneId, sim: { duration: 1 } }) as FlowNode
const flow = (id: string, source: string, target: string) => ({ id, kind: 'sequence' as const, source, target, name: '' })

/** Three people do "Pack order", two of them in the same lane; one unnamed XOR sits before "Ship order". */
function model(): FlowModel {
  const m = emptyModel('Generic review')
  m.lanes = [
    { id: 'L1', name: 'Warehouse A' },
    { id: 'L2', name: 'Warehouse B' },
  ]
  m.nodes = [
    { id: 'S', name: '', type: 'event', position: 'start', trigger: 'none', throwing: false } as FlowNode,
    task('T1', 'Pack order', 'L1'),
    task('T2', 'Pack order', 'L2'),
    task('T3', 'Pack order', 'L2'),
    { id: 'G1', name: '', type: 'gateway', kind: 'exclusive' } as FlowNode,
    task('T4', 'Ship order', 'L1'),
    { id: 'E', name: '', type: 'event', position: 'end', trigger: 'none', throwing: true } as FlowNode,
  ]
  m.flows = [flow('F1', 'S', 'T1'), flow('F2', 'T1', 'T2'), flow('F3', 'T2', 'T3'), flow('F4', 'T3', 'G1'), flow('F5', 'G1', 'T4'), flow('F6', 'T4', 'E')]
  return m
}

describe('labels of equal names', () => {
  it('a name used twice shows its lane, and a number when the lane repeats', () => {
    const m = model()
    expect(labelOf(m, 'T1')).toBe('Pack order · Warehouse A')
    expect(labelOf(m, 'T2')).toBe('Pack order · Warehouse B (1)')
    expect(labelOf(m, 'T3')).toBe('Pack order · Warehouse B (2)')
    expect(labelOf(m, 'T4')).toBe('Ship order')
    expect(new Set(labelMap(m).values()).size).toBe(labelMap(m).size)
  })

  it('the analysis rows and the what-if lists use them', () => {
    const m = model()
    const names = analyseModel(m)[0].steps.map((s) => s.name)
    expect(names).toContain('Pack order · Warehouse A')
    expect(picksFor(m, 'duration').map((c) => c.label)).toContain('Pack order · Warehouse B (2)')
    expect(describeChange(m, { kind: 'duration', id: 'T1', value: 2 })).toContain('Pack order · Warehouse A')
  })

  it('the Run table names carry them too', () => {
    const r = simulate(model(), { level: 2, cases: 5, runs: 1, seed: 1 })
    expect(r.elements.map((e) => e.name)).toContain('Pack order · Warehouse A')
  })
})

describe('an unnamed gateway', () => {
  it('reads type + what follows, not its id', () => {
    const m = model()
    expect(plainLabel(m, 'G1')).toBe('XOR before Ship order')
    expect(labelOf(m, 'G1')).not.toMatch(/Gateway_|G1/)
  })
  it('looks through a chain of unnamed gateways, but not forever, and handles a gateway with no way out', () => {
    const m = model()
    m.nodes.push({ id: 'G2', name: '', type: 'gateway', kind: 'parallel' } as FlowNode)
    expect(plainLabel(m, 'G2')).toBe('AND gateway')
    m.flows.push(flow('F7', 'G2', 'G1'))
    expect(plainLabel(m, 'G2')).toBe('AND before XOR before Ship order')
  })
})

describe('numbers, names, rates', () => {
  it('small rates keep their significant digits', () => {
    expect(sig(0.006)).toBe('0.006')
    expect(sig(0.0123)).toBe('0.012')
    expect(sig(0.5)).toBe('0.5')
    expect(sig(12.345)).toBe('12.35')
    expect(sig(0)).toBe('0')
    expect(sig(undefined)).toBe('—')
  })
  it('a scenario with no name is "Scenario n", the first free number', () => {
    expect(defaultScenarioName([])).toBe('Scenario 1')
    expect(defaultScenarioName(['Base', 'Scenario 1'])).toBe('Scenario 2')
    expect(defaultScenarioName(['Scenario 2'])).toBe('Scenario 1')
  })
  it('repeated changes on equal names are folded', () => {
    const m = model()
    const cs = [1, 2, 3].map((i) => ({ kind: 'wait' as const, id: `T${i}`, value: 10 }))
    expect(describeChanges(m, cs)).toEqual(['Pack order wait 0 → 10 min ×3'])
    expect(foldRepeats(['a', 'b', 'a'])).toEqual(['a ×2', 'b'])
  })
  it('no task cost and no lane rate: no rates', () => {
    const m = model()
    expect(hasRates(m)).toBe(false)
    m.lanes[0].hourlyCost = 20
    expect(hasRates(m)).toBe(true)
    m.lanes[0].hourlyCost = undefined
    m.nodes[1].sim = { duration: 1, cost: 5 }
    expect(hasRates(m)).toBe(true)
  })
  it('an empty model has nothing to label and no rates', () => {
    const m = emptyModel()
    expect(labelMap(m).size).toBe(0)
    expect(hasRates(m)).toBe(false)
  })
})
