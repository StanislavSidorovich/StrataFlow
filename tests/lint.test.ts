// The model check P01–P20 (SPEC §7): each rule fires on a small wrong model and stays quiet on the right one;
// the reference models lint clean.
import { describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel, type FlowNode } from '../src/core/metamodel'
import { lintModel, summarize, type RuleId } from '../src/core/lint'
import { addBoundaryEvent, addLane, addNode, addPool, appendNode, connect, setDefaultFlow, setFlow, updateNode, type NodeSpec } from '../src/core/ops'
import { parseModel } from '../src/core/serialize'
import { drawOrderFulfilment } from './fixtures/order-fulfilment'
import example from '../src/data/examples/library-loan.flow.json?raw'
import { CASES } from './fixtures/cases'
import { readFileSync } from 'node:fs'

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
    // The own cases name their roles, so lanes are expected.
    for (const c of CASES) expect(lintModel(parseModel(readFileSync(`cases/${c.id}.flow.json`, 'utf8')), { expectLanes: true }), c.id).toEqual([])
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

  it('P19: a sequence flow crosses the border of a sub-process', () => {
    const m = emptyModel()
    const start = put(m, START, 'Claim received')
    const sub = appendNode(m, start.id, { type: 'subProcess' }, 'Verify claim')
    const inner = addNode(m, TASK, { x: 400, y: 100 }, 'Review claim')
    inner.parentId = sub.id
    const end = appendNode(m, sub.id, END, 'Claim settled')
    // as the sub-process is drawn: start, step, end inside, flows at the border
    const s2 = addNode(m, START, { x: 300, y: 100 }, 'Review started')
    s2.parentId = sub.id
    const e2 = addNode(m, END, { x: 500, y: 100 }, 'Review done')
    e2.parentId = sub.id
    connect(m, s2.id, inner.id)
    connect(m, inner.id, e2.id)
    expect(rules(m)).not.toContain('P19')
    // a flow straight into a step inside, and one straight out of it
    const into = connect(m, start.id, inner.id)
    const out = connect(m, inner.id, end.id)
    const hits = only(m, 'P19')
    expect(hits).toHaveLength(2)
    expect(hits.every((i) => i.severity === 'error')).toBe(true)
    expect(hits.flatMap((i) => i.elements)).toEqual(expect.arrayContaining([into.id, out.id]))
    expect(hits[0].message).toContain('Verify claim')
  })

  it('P20: a step inside a sub-process sits in another lane', () => {
    const m = emptyModel()
    m.lanes.push({ id: 'L1', name: 'Handler' }, { id: 'L2', name: 'Finance' })
    const sub = put(m, { type: 'subProcess' }, 'Settle claim')
    sub.laneId = 'L1'
    const approve = put(m, TASK, 'Approve claim')
    const pay = put(m, TASK, 'Pay claim')
    for (const n of [approve, pay]) (n.parentId = sub.id), (n.laneId = 'L1')
    expect(rules(m)).not.toContain('P20')
    pay.laneId = 'L2'
    const [hit] = only(m, 'P20')
    expect(hit.severity).toBe('info')
    expect(hit.elements).toEqual([sub.id, pay.id])
    expect(hit.message).toContain('"Finance"')
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

  it('P07: the branches of an event-based gateway are closed by an exclusive join', () => {
    const m = emptyModel()
    const s = put(m, START, 'Offer sent')
    const g = appendNode(m, s.id, { type: 'gateway', kind: 'eventBased' })
    const yes = appendNode(m, g.id, { type: 'event', position: 'intermediate', trigger: 'message' }, 'Answer received')
    const late = appendNode(m, g.id, { type: 'event', position: 'intermediate', trigger: 'timer' }, '5 days')
    const j = appendNode(m, yes.id, XOR)
    connect(m, late.id, j.id)
    appendNode(m, j.id, END, 'Offer closed')
    expect(rules(m)).toEqual([])
    updateNode(m, j.id, { kind: 'parallel' })
    expect(only(m, 'P07')[0].message).toContain('deadlock')
  })

  it('P18: waiting for a message the other pool sends on one branch only (exercise 3.7)', () => {
    const m = emptyModel()
    addPool(m, { x: 0, y: 0 }, 'Customer')
    addPool(m, { x: 0, y: 300 }, 'Shop')
    const need = addNode(m, START, { x: 80, y: 125 }, 'Goods needed')
    const place = appendNode(m, need.id, { type: 'task', kind: 'send' }, 'Place order')
    const invoiced = appendNode(m, place.id, { type: 'event', position: 'intermediate', trigger: 'message' }, 'Invoice received')
    const pay = appendNode(m, invoiced.id, TASK, 'Pay invoice')
    appendNode(m, pay.id, END, 'Invoice paid')
    const order = addNode(m, { type: 'event', position: 'start', trigger: 'message' }, { x: 80, y: 425 }, 'Order received')
    const check = appendNode(m, order.id, TASK, 'Check stock')
    const inStock = appendNode(m, check.id, XOR, 'In stock?')
    const rejected = appendNode(m, inStock.id, { type: 'event', position: 'end', trigger: 'message' }, 'Order rejected')
    const invoice = appendNode(m, inStock.id, { type: 'task', kind: 'send' }, 'Send invoice')
    appendNode(m, invoice.id, END, 'Invoice sent')
    const [no, yes] = m.flows.filter((f) => f.source === inStock.id)
    setFlow(m, no.id, { name: 'No' })
    setFlow(m, yes.id, { name: 'Yes' })
    connect(m, place.id, order.id)
    connect(m, invoice.id, invoiced.id)
    connect(m, rejected.id, 'Participant_1')
    const p18 = only(m, 'P18')
    expect(p18).toHaveLength(1)
    expect(p18[0].elements).toEqual([invoiced.id, invoice.id, inStock.id])
    expect(p18[0].message).toContain('"In stock?"')
    expect(rules(m)).toEqual(['P18'])

    // The repair: the customer waits for whichever message comes first.
    m.flows = m.flows.filter((f) => !(f.source === place.id && f.target === invoiced.id))
    const g = addNode(m, { type: 'gateway', kind: 'eventBased' }, { x: 330, y: 200 })
    connect(m, place.id, g.id)
    connect(m, g.id, invoiced.id)
    const refused = addNode(m, { type: 'event', position: 'intermediate', trigger: 'message' }, { x: 420, y: 200 }, 'Rejection received')
    connect(m, g.id, refused.id)
    appendNode(m, refused.id, END, 'Order cancelled')
    m.flows = m.flows.filter((f) => !(f.source === rejected.id))
    connect(m, rejected.id, refused.id)
    expect(rules(m)).toEqual([])
  })

  it('P18: a message sent on every path, or a wait with a deadline, is fine', () => {
    const m = emptyModel()
    addPool(m, { x: 0, y: 0 }, 'Customer')
    addPool(m, { x: 0, y: 300 }, 'Shop')
    const need = addNode(m, START, { x: 80, y: 125 }, 'Goods needed')
    const place = appendNode(m, need.id, { type: 'task', kind: 'send' }, 'Place order')
    const wait = appendNode(m, place.id, { type: 'task', kind: 'receive' }, 'Receive invoice')
    appendNode(m, wait.id, END, 'Invoice received')
    const order = addNode(m, { type: 'event', position: 'start', trigger: 'message' }, { x: 80, y: 425 }, 'Order received')
    const invoice = appendNode(m, order.id, { type: 'task', kind: 'send' }, 'Send invoice')
    const shipped = appendNode(m, invoice.id, END, 'Invoice sent')
    connect(m, place.id, order.id)
    connect(m, invoice.id, wait.id)
    expect(rules(m)).toEqual([])
    // Now the invoice goes out on one branch only, but a timer ends the wait.
    m.flows = m.flows.filter((f) => !(f.source === invoice.id && f.target === shipped.id))
    const ok = appendNode(m, invoice.id, XOR, 'Paid in advance?')
    m.flows = m.flows.filter((f) => !(f.source === order.id))
    connect(m, order.id, ok.id)
    m.flows = m.flows.filter((f) => !(f.source === ok.id))
    connect(m, ok.id, invoice.id)
    connect(m, ok.id, shipped.id)
    m.flows = m.flows.filter((f) => !(f.source === invoice.id && f.kind === 'sequence'))
    connect(m, invoice.id, shipped.id)
    expect(only(m, 'P18')).toHaveLength(1)
    const late = addBoundaryEvent(m, wait.id, 'timer')
    appendNode(m, late.id, END, 'No invoice')
    expect(only(m, 'P18')).toEqual([])
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

  it('P07: a fork and join inside a rework loop is not a "join on a loop"', () => {
    const m = emptyModel()
    const s = put(m, START, 'Draft requested')
    const top = appendNode(m, s.id, XOR)
    const split = appendNode(m, top.id, AND)
    const a = appendNode(m, split.id, TASK, 'Check facts')
    const b = put(m, TASK, 'Check style')
    const c = put(m, TASK, 'Check numbers')
    connect(m, split.id, b.id)
    connect(m, split.id, c.id)
    const join = put(m, AND)
    for (const t of [a, b, c]) connect(m, t.id, join.id)
    const rework = appendNode(m, join.id, XOR, 'Rework?')
    const back = connect(m, rework.id, top.id)
    const done = appendNode(m, rework.id, END, 'Draft approved')
    setFlow(m, back.id, { name: 'Yes' })
    setFlow(m, m.flows.find((f) => f.source === rework.id && f.target === done.id)!.id, { name: 'No' })
    expect(only(m, 'P07')).toEqual([])
  })

  it('P07: a loop that returns into an AND join with an entry from outside is still caught', () => {
    const m = emptyModel()
    const s = put(m, START, 'Request received')
    const prep = appendNode(m, s.id, TASK, 'Prepare request')
    const join = appendNode(m, prep.id, AND)
    const work = appendNode(m, join.id, TASK, 'Process request')
    const again = appendNode(m, work.id, XOR, 'Again?')
    const back = connect(m, again.id, join.id)
    const done = appendNode(m, again.id, END, 'Request done')
    setFlow(m, back.id, { name: 'Yes' })
    setFlow(m, m.flows.find((f) => f.source === again.id && f.target === done.id)!.id, { name: 'No' })
    expect(only(m, 'P07')[0].message).toContain('on a loop')
  })

  it('P07: a way back into one branch of a fork and join is still caught', () => {
    const m = emptyModel()
    const s = put(m, START, 'Request received')
    const split = appendNode(m, s.id, AND)
    const a = appendNode(m, split.id, TASK, 'Check part one')
    const b = put(m, TASK, 'Check part two')
    connect(m, split.id, b.id)
    const join = put(m, AND)
    connect(m, a.id, join.id)
    connect(m, b.id, join.id)
    const again = appendNode(m, join.id, XOR, 'Again?')
    const back = connect(m, again.id, b.id)
    const done = appendNode(m, again.id, END, 'Request done')
    setFlow(m, back.id, { name: 'Yes' })
    setFlow(m, m.flows.find((f) => f.source === again.id && f.target === done.id)!.id, { name: 'No' })
    expect(only(m, 'P07').length).toBeGreaterThan(0)
  })

  it('P05: an event-based gateway entered twice (first entry and the loop back) and left twice; an XOR merge before it clears it', () => {
    const m = emptyModel()
    const s = put(m, START, 'Question needed')
    const ask = appendNode(m, s.id, TASK, 'Ask partner')
    const g = appendNode(m, ask.id, { type: 'gateway', kind: 'eventBased' })
    const reply = appendNode(m, g.id, { type: 'event', position: 'intermediate', trigger: 'message' }, 'Reply received')
    const timer = appendNode(m, g.id, { type: 'event', position: 'intermediate', trigger: 'timer' }, 'Two days passed')
    const chase = appendNode(m, timer.id, TASK, 'Chase partner')
    connect(m, chase.id, g.id)
    appendNode(m, reply.id, END, 'Answer used')
    expect(only(m, 'P05')[0].elements).toEqual([g.id])

    // The repair: both entries meet in an exclusive merge in front of the gateway.
    m.flows = m.flows.filter((f) => !(f.target === g.id))
    const merge = put(m, XOR)
    connect(m, ask.id, merge.id)
    connect(m, chase.id, merge.id)
    connect(m, merge.id, g.id)
    expect(only(m, 'P05')).toEqual([])
    expect(rules(m)).toEqual([])
  })

  it('P14: the same task in two lanes of one pool is not a duplicate; twice in one lane is', () => {
    const m = emptyModel()
    addPool(m, { x: 0, y: 0 }, 'Shop')
    const sales = addLane(m, 'Participant_1', 'Sales')
    const stock = addLane(m, 'Participant_1', 'Warehouse')
    const mk = (laneId: string, name: string) => {
      const n = put(m, TASK, name)
      n.participantId = 'Participant_1'
      n.laneId = laneId
      return n
    }
    const a = mk(sales.id, 'Confirm order')
    const b = mk(stock.id, 'Confirm  order')
    expect(only(m, 'P14')).toEqual([])
    const c = mk(stock.id, 'confirm order')
    expect(only(m, 'P14')[0].elements.sort()).toEqual([b.id, c.id].sort())
    expect(a).toBeTruthy()
  })
})
