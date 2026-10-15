// The model check P01–P17 (SPEC §7): each rule fires on a small wrong model and stays quiet on the right one;
// the reference models lint clean.
import { describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel, type FlowNode } from '../src/core/metamodel'
import { lintModel, summarize, type RuleId } from '../src/core/lint'
import { addBoundaryEvent, addLane, addNode, addPool, appendNode, connect, setDefaultFlow, setFlow, updateNode, type NodeSpec } from '../src/core/ops'
import { parseModel } from '../src/core/serialize'
import { drawOrderFulfilment } from './fixtures/order-fulfilment'
import example from '../src/data/examples/library-loan.flow.json?raw'

const START: NodeSpec = { type: 'event', position: 'start' }
const END: NodeSpec = { type: 'event', position: 'end' }
const TASK: NodeSpec = { type: 'task' }
const XOR: NodeSpec = { type: 'gateway', kind: 'exclusive' }
const AND: NodeSpec = { type: 'gateway', kind: 'parallel' }

let x = 0
/** A free-standing node (no pool), placed left to right. */
const put = (m: FlowModel, spec: NodeSpec, name = '') => addNode(m, spec, { x: (x += 150), y: 100 }, name)

const rules = (m: FlowModel, opts = {}) => lintModel(m, opts).map((i) => i.rule)
const only = (m: FlowModel, rule: RuleId) => lintModel(m).filter((i) => i.rule === rule)

/** start → Check order → end: clean. */
function line(): { m: FlowModel; start: FlowNode; task: FlowNode; end: FlowNode } {
  const m = emptyModel()
  const start = put(m, START, 'Order received')
  const task = appendNode(m, start.id, TASK, 'Check order')
  const end = appendNode(m, task.id, END, 'Order checked')
  return { m, start, task, end }
}

/** start → split → A, B → join → end, with the given kinds. */
function diamond(split: NodeSpec, join: NodeSpec) {
  const m = emptyModel()
  const s = put(m, START, 'Order received')
  const g1 = appendNode(m, s.id, split, 'Paid?')
  const a = put(m, TASK, 'Pack goods')
  const b = put(m, TASK, 'Send invoice')
  connect(m, g1.id, a.id)
  connect(m, g1.id, b.id)
  const out = m.flows.filter((f) => f.source === g1.id)
  setFlow(m, out[0].id, { name: 'Yes' })
  setFlow(m, out[1].id, { name: 'No' })
  const g2 = put(m, join)
  connect(m, a.id, g2.id)
  connect(m, b.id, g2.id)
  appendNode(m, g2.id, END, 'Order done')
  return { m, g1, g2, a, b }
}

describe('the model check', () => {
  it('a plain line is clean', () => {
    expect(lintModel(line().m)).toEqual([])
  })

  it('the reference models lint clean', () => {
    const shop = emptyModel('Order fulfilment')
    drawOrderFulfilment(shop)
    expect(lintModel(shop)).toEqual([])
    expect(lintModel(parseModel(example))).toEqual([])
  })

  it('P01: a pool process without start or end event', () => {
    const m = emptyModel()
    addPool(m, { x: 0, y: 0 }, 'Shop')
    const t = addNode(m, TASK, { x: 200, y: 120 }, 'Check order')
    appendNode(m, t.id, TASK, 'Ship order')
    const p01 = only(m, 'P01')
    expect(p01.map((i) => i.message)).toEqual([expect.stringContaining('no start event'), expect.stringContaining('no end event')])
    expect(p01[0].message).toContain('"Shop"')
    // A sub-process does not need them (SPEC: top level of a pool).
    expect(rules(line().m)).not.toContain('P01')
  })

  it('P02: a step nothing leads to, and one with no way to an end', () => {
    const { m, task } = line()
    const lost = put(m, TASK, 'File order')
    const dead = appendNode(m, task.id, TASK, 'Archive order')
    const p02 = only(m, 'P02')
    expect(p02.map((i) => i.elements[0]).sort()).toEqual([lost.id, dead.id].sort())
    expect(p02.find((i) => i.elements[0] === lost.id)!.message).toContain('no incoming flow')
    expect(p02.find((i) => i.elements[0] === dead.id)!.message).toContain('no outgoing flow')
    expect(p02[0].severity).toBe('error')
  })

  it('P02 goes on through a boundary event', () => {
    const { m, task } = line()
    const late = addBoundaryEvent(m, task.id, 'timer')
    const remind = appendNode(m, late.id, TASK, 'Send reminder')
    appendNode(m, remind.id, END, 'Reminder sent')
    expect(lintModel(m)).toEqual([])
  })

  it('P03: a sequence flow across pools', () => {
    const m = emptyModel()
    addPool(m, { x: 0, y: 0 }, 'Shop')
    addPool(m, { x: 0, y: 300 }, 'Bank')
    const a = addNode(m, TASK, { x: 200, y: 120 }, 'Send invoice')
    const b = addNode(m, TASK, { x: 200, y: 420 }, 'Pay invoice')
    connect(m, a.id, b.id) // the editor makes it a message flow
    expect(rules(m)).not.toContain('P03')
    m.flows.at(-1)!.kind = 'sequence' // as a careless file may have it
    expect(only(m, 'P03')[0].elements).toContain(a.id)
  })

  it('P04: a message flow inside one pool', () => {
    const { m, start, end } = line()
    addPool(m, { x: 0, y: 0 }, 'Shop')
    m.nodes.forEach((n) => (n.participantId = 'Participant_1'))
    m.flows.push({ id: 'Flow_x', kind: 'message', source: start.id, target: end.id, name: '' })
    expect(only(m, 'P04')).toHaveLength(1)
  })

  it('P05: one gateway that joins and splits', () => {
    const m = emptyModel()
    const s1 = put(m, START, 'Order received')
    const s2 = put(m, START, 'Call received')
    const g = put(m, XOR, 'Urgent?')
    connect(m, s1.id, g.id)
    connect(m, s2.id, g.id)
    const a = appendNode(m, g.id, TASK, 'Ship today')
    const b = appendNode(m, g.id, TASK, 'Ship later')
    appendNode(m, a.id, END, 'Shipped today')
    appendNode(m, b.id, END, 'Shipped later')
    m.flows.filter((f) => f.source === g.id).forEach((f, i) => setFlow(m, f.id, { name: i ? 'No' : 'Yes' }))
    expect(rules(m)).toEqual(['P05'])
  })

  it('P06: decision branches without names, and the default flow', () => {
    const { m, g1 } = diamond(XOR, XOR)
    expect(rules(m)).toEqual([])
    const out = m.flows.filter((f) => f.source === g1.id)
    setFlow(m, out[1].id, { name: '' })
    expect(only(m, 'P06')[0].elements).toEqual([g1.id, out[1].id])
    setDefaultFlow(m, out[1].id, true)
    expect(rules(m)).toEqual([])
    // A parallel split needs no names.
    expect(rules(diamond(AND, AND).m)).toEqual([])
  })

  it('P07: AND split closed by XOR join, XOR split closed by AND join', () => {
    const dup = diamond(AND, XOR)
    expect(only(dup.m, 'P07')[0].message).toContain('more than once')
    expect(only(dup.m, 'P07')[0].elements).toEqual([dup.g1.id, dup.g2.id])
    const dead = diamond(XOR, AND)
    expect(only(dead.m, 'P07')[0].message).toContain('deadlock')
    expect(rules(diamond(XOR, XOR).m)).toEqual([])
  })

  it('P07: a rework loop needs an XOR join, not an AND join', () => {
    const build = (join: NodeSpec) => {
      const m = emptyModel()
      const s = put(m, START, 'Claim received')
      const j = appendNode(m, s.id, join)
      const t = appendNode(m, j.id, TASK, 'Check claim')
      const d = appendNode(m, t.id, XOR, 'Complete?')
      appendNode(m, d.id, END, 'Claim checked')
      connect(m, d.id, j.id)
      m.flows.filter((f) => f.source === d.id).forEach((f, i) => setFlow(m, f.id, { name: i ? 'No' : 'Yes' }))
      return m
    }
    expect(only(build(AND), 'P07')[0].message).toContain('loop')
    // The XOR join is right; it splits nothing, so only the implicit-merge-free model is clean.
    expect(rules(build(XOR))).toEqual([])
  })

  it('P08: several flows into a task', () => {
    const { m, start, task } = line()
    const s2 = put(m, START, 'Call received')
    connect(m, s2.id, task.id)
    expect(only(m, 'P08')[0]).toMatchObject({ severity: 'info', elements: [task.id] })
    expect(start).toBeTruthy()
  })

  it('P09: activity names', () => {
    const named = (name: string) => {
      const { m, task } = line()
      task.name = name
      return only(m, 'P09')[0]?.message
    }
    expect(named('Check invoice')).toBeUndefined()
    expect(named('Invoice')).toContain('one word')
    expect(named('Approval of order')).toContain('noun')
    expect(named('Checking invoice')).toContain('imperative')
    expect(named('Handle order')).toContain('generic')
    expect(named('Check the invoice and the order form')).toContain('words')
    expect(named('check invoice')).toContain('small letter')
    expect(named('')).toContain('no name')
  })

  it('P10: only catching events or receive tasks after an event-based gateway', () => {
    const m = emptyModel()
    const s = put(m, START, 'Offer sent')
    const g = appendNode(m, s.id, { type: 'gateway', kind: 'eventBased' })
    const yes = appendNode(m, g.id, { type: 'event', position: 'intermediate', trigger: 'message' }, 'Answer received')
    const late = appendNode(m, g.id, { type: 'event', position: 'intermediate', trigger: 'timer' }, '5 days')
    appendNode(m, yes.id, END, 'Offer accepted')
    appendNode(m, late.id, END, 'Offer expired')
    expect(rules(m)).toEqual([])
    const wrong = appendNode(m, g.id, TASK, 'Call customer')
    appendNode(m, wrong.id, END, 'Customer called')
    expect(only(m, 'P10')[0].elements).toEqual([g.id, wrong.id])
  })

  it('P11: a boundary event without an outgoing flow', () => {
    const { m, task } = line()
    const b = addBoundaryEvent(m, task.id, 'error')
    expect(rules(m)).toEqual(['P11'])
    expect(only(m, 'P11')[0].elements).toEqual([b.id])
  })

  it('P12: flow into a start event, flow out of an end event', () => {
    const { m, start, end } = line()
    connect(m, end.id, start.id)
    const p12 = only(m, 'P12')
    expect(p12.map((i) => i.elements[0]).sort()).toEqual([start.id, end.id].sort())
  })

  it('P13: more than 30 steps on one level', () => {
    const m = emptyModel()
    let last = put(m, START, 'Order received')
    for (let i = 0; i < 30; i++) last = appendNode(m, last.id, TASK, `Check item ${i}`)
    appendNode(m, last.id, END, 'Order checked')
    expect(only(m, 'P13')).toHaveLength(1)
  })

  it('P14: two tasks with the same name in one pool', () => {
    const { m, task } = line()
    const again = appendNode(m, task.id, TASK, 'check  order')
    m.flows = m.flows.filter((f) => !(f.source === task.id && f.target !== again.id))
    appendNode(m, again.id, END, 'Order done')
    expect(only(m, 'P14')[0].elements.sort()).toEqual([task.id, again.id].sort())
  })

  it('P15: an empty lane; a pool without lanes when the case names roles', () => {
    const m = emptyModel()
    addPool(m, { x: 0, y: 0 }, 'Shop')
    const s = addNode(m, START, { x: 100, y: 120 }, 'Order received')
    const t = appendNode(m, s.id, TASK, 'Check order')
    appendNode(m, t.id, END, 'Order checked')
    expect(rules(m)).toEqual([])
    expect(rules(m, { expectLanes: true })).toEqual(['P15'])
    addLane(m, 'Participant_1', 'Sales')
    addLane(m, 'Participant_1', 'Warehouse')
    expect(only(m, 'P15')[0].message).toContain('"Warehouse"')
  })

  it('P16: several end events, one unnamed', () => {
    const { m, g1 } = diamond(XOR, XOR)
    const extra = appendNode(m, g1.id, END)
    m.flows.filter((f) => f.source === g1.id && f.target === extra.id).forEach((f) => setFlow(m, f.id, { name: 'Maybe' }))
    expect(only(m, 'P16')[0].elements).toEqual([extra.id])
  })

  it('P17: a loop with no way out', () => {
    const m = emptyModel()
    const s = put(m, START, 'Ticket opened')
    const j = appendNode(m, s.id, XOR)
    const a = appendNode(m, j.id, TASK, 'Ask customer')
    const b = appendNode(m, a.id, TASK, 'Wait for answer')
    connect(m, b.id, j.id)
    put(m, END, 'Ticket closed')
    const p17 = only(m, 'P17')
    expect(p17).toHaveLength(1)
    expect(p17[0].elements.sort()).toEqual([j.id, a.id, b.id].sort())
    // The loop is not also reported as "no path to an end" step by step.
    expect(only(m, 'P02').map((i) => i.elements[0])).not.toContain(a.id)
  })

  it('sorts errors first and counts them', () => {
    const { m, task } = line()
    addBoundaryEvent(m, task.id, 'error')
    const s2 = put(m, START, 'Call received')
    connect(m, s2.id, task.id)
    const issues = lintModel(m)
    expect(issues.map((i) => i.severity)).toEqual(['error', 'info'])
    expect(summarize(issues)).toEqual({ error: 1, warning: 0, info: 1 })
    expect(updateNode).toBeTruthy()
  })
})

describe('P02 reports the cause, not every step after it', () => {
  it('one unconnected step hides the steps it leads to', () => {
    const { m, start, task } = line()
    m.flows = m.flows.filter((f) => f.source !== start.id)
    const p02 = only(m, 'P02')
    expect(p02.map((i) => i.elements[0]).sort()).toEqual([start.id, task.id].sort()) // the start leads nowhere now, too
  })
  it('a dead end is reported where the path stops', () => {
    const { m, task, end } = line()
    const t2 = appendNode(m, task.id, TASK, 'Archive order')
    const t3 = appendNode(m, t2.id, TASK, 'Close file')
    expect(only(m, 'P02').map((i) => i.elements[0])).toEqual([t3.id])
    expect(end).toBeTruthy()
  })
})
