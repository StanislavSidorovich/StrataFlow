// Stage 2: group into / ungroup sub-process (SPEC §6), with one and several ways in and out.
import { describe, expect, it } from 'vitest'
import { emptyModel, type Bounds, type FlowModel } from '../src/core/metamodel'
import {
  addBoundaryEvent,
  addLane,
  addNode,
  addPool,
  appendNode,
  connect,
  groupIntoSubprocess,
  ModelError,
  NeedsGatewaysError,
  nodeOf,
  resizeElement,
  setDefaultFlow,
  setFlow,
  ungroupSubprocess,
  updateNode,
} from '../src/core/ops'
import { readBpmn } from '../src/core/bpmn/read'
import { writeBpmn } from '../src/core/bpmn/write'
import { kitchenSink } from './fixtures/models'

const overlap = (a: Bounds, b: Bounds) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
/** Sequence flows as "source > target" by name (or id), sorted: the process, whatever the drawing. */
const paths = (m: FlowModel) =>
  m.flows
    .filter((f) => f.kind === 'sequence')
    .map((f) => `${label(m, f.source)} > ${label(m, f.target)}${f.condition ? ` [${f.condition}]` : ''}`)
    .sort()
const label = (m: FlowModel, id: string) => nodeOf(m, id)?.name || id

/** Siblings never overlap, flows join existing elements, every default flow leaves its gateway. */
function expectSound(m: FlowModel) {
  const shown = m.nodes.filter((n) => !(n.type === 'event' && n.attachedTo))
  for (const a of shown) for (const b of shown) if (a.id < b.id && a.parentId === b.parentId) expect(overlap(m.diagram.shapes[a.id], m.diagram.shapes[b.id]), `${a.id} on ${b.id}`).toBe(false)
  const ids = new Set([...m.nodes, ...m.participants].map((x) => x.id))
  for (const f of m.flows) expect(ids.has(f.source) && ids.has(f.target), f.id).toBe(true)
  for (const n of m.nodes) if (n.type === 'gateway' && n.defaultFlow) expect(m.flows.find((f) => f.id === n.defaultFlow)?.source).toBe(n.id)
  for (const n of m.nodes) if (n.parentId) expect(nodeOf(m, n.parentId)?.type).toBe('subProcess')
}

/** Start → Receive → Check → Approve → Archive → end, in a pool with two lanes (Approve below). */
function line() {
  const m = emptyModel('Line')
  addPool(m, { x: 0, y: 0 }, 'Office')
  addLane(m, 'Participant_1', 'Clerk')
  addLane(m, 'Participant_1', 'Manager')
  const start = addNode(m, { type: 'event' }, { x: 100, y: 75 }, 'Start')
  const receive = appendNode(m, start.id, { type: 'task' }, 'Receive')
  const check = appendNode(m, receive.id, { type: 'task' }, 'Check')
  const approve = appendNode(m, check.id, { type: 'task' }, 'Approve')
  const archive = appendNode(m, approve.id, { type: 'task' }, 'Archive')
  appendNode(m, archive.id, { type: 'event', position: 'end' }, 'End')
  return { m, start, receive, check, approve, archive }
}

describe('group into sub-process', () => {
  it('one way in, one way out: start and end events inside, the rest moves right, ungroup gives it back', () => {
    const { m, receive, check, archive } = line()
    const before = paths(m)
    const lane = receive.laneId
    const right = m.diagram.shapes[archive.id].x
    const sp = groupIntoSubprocess(m, [receive.id, check.id], { name: 'Intake' })
    expectSound(m)
    expect(sp).toMatchObject({ type: 'subProcess', collapsed: false, name: 'Intake', laneId: lane, participantId: 'Participant_1' })
    expect(nodeOf(m, receive.id)?.parentId).toBe(sp.id)
    expect(nodeOf(m, check.id)?.parentId).toBe(sp.id)
    const inner = m.nodes.filter((n) => n.parentId === sp.id)
    expect(inner.map((n) => n.type).sort()).toEqual(['event', 'event', 'task', 'task'])
    expect(paths(m)).toEqual(
      ['Start > Intake', 'Intake > Approve', 'Approve > Archive', 'Archive > End', 'Receive > Check', `${inner.find((n) => n.type === 'event' && n.position === 'start')!.id} > Receive`, `Check > ${inner.find((n) => n.type === 'event' && n.position === 'end')!.id}`].sort(),
    )
    // Room was made: what came after moved right, and the pool grew with it.
    expect(m.diagram.shapes[archive.id].x).toBeGreaterThan(right)
    const pool = m.diagram.shapes.Participant_1
    expect(m.diagram.shapes[archive.id].x + 100).toBeLessThanOrEqual(pool.x + pool.width)

    ungroupSubprocess(m, sp.id)
    expectSound(m)
    expect(paths(m)).toEqual(before)
    expect(m.nodes.some((n) => n.parentId)).toBe(false)
  })

  it('the sub-process lands in the lane holding most of the steps', () => {
    const { m, check, approve, archive } = line()
    const manager = m.lanes[1].id
    for (const n of [approve, archive]) {
      const s = m.diagram.shapes[n.id]
      s.y += 250
      nodeOf(m, n.id)!.laneId = manager
    }
    const sp = groupIntoSubprocess(m, [check.id, approve.id, archive.id])
    expect(sp.laneId).toBe(manager)
    // The steps keep their own lanes inside.
    expect(nodeOf(m, check.id)?.laneId).toBe(m.lanes[0].id)
  })

  it('two ways in (branches of an exclusive gateway): asks first, then a gateway inside', () => {
    const m = emptyModel()
    addPool(m, { x: 0, y: 0 }, 'Shop')
    const start = addNode(m, { type: 'event' }, { x: 80, y: 120 }, 'Order')
    const g = appendNode(m, start.id, { type: 'gateway' }, 'Paid?')
    const a = appendNode(m, g.id, { type: 'task' }, 'Ship')
    const b = appendNode(m, g.id, { type: 'task' }, 'Ask to pay')
    const join = addNode(m, { type: 'gateway' }, { x: 600, y: 120 }, 'Join')
    connect(m, a.id, join.id)
    connect(m, b.id, join.id)
    appendNode(m, join.id, { type: 'event', position: 'end' }, 'Done')
    const [toA, toB] = m.flows.filter((f) => f.source === g.id)
    setFlow(m, toA.id, { name: 'Yes' })
    setFlow(m, toB.id, { name: 'No', condition: 'not paid' })
    setDefaultFlow(m, toA.id, true)

    expect(() => groupIntoSubprocess(structuredClone(m), [a.id, b.id])).toThrow(NeedsGatewaysError)
    const sp = groupIntoSubprocess(m, [a.id, b.id], { gateways: true, name: 'Handle' })
    expectSound(m)
    // One flow from the gateway to the sub-process, still its default; inside, start → gateway → both steps.
    const toSp = m.flows.filter((f) => f.target === sp.id)
    expect(toSp.map((f) => label(m, f.source))).toEqual(['Paid?'])
    expect(nodeOf(m, g.id)).toMatchObject({ defaultFlow: toSp[0].id })
    const inner = m.nodes.filter((n) => n.parentId === sp.id)
    const split = inner.find((n) => n.type === 'gateway')!
    expect(m.flows.filter((f) => f.source === split.id).map((f) => label(m, f.target)).sort()).toEqual(['Ask to pay', 'Ship'])
    expect(m.flows.filter((f) => f.source === sp.id).map((f) => label(m, f.target))).toEqual(['Join'])
  })

  it('two ways out (a decision inside): an end event for each, and a gateway after that keeps the conditions', () => {
    const m = emptyModel()
    addPool(m, { x: 0, y: 0 }, 'Bank')
    const start = addNode(m, { type: 'event' }, { x: 80, y: 120 }, 'Apply')
    const check = appendNode(m, start.id, { type: 'task' }, 'Check')
    const ok = appendNode(m, check.id, { type: 'gateway' }, 'OK?')
    const grant = appendNode(m, ok.id, { type: 'task' }, 'Grant')
    const refuse = appendNode(m, ok.id, { type: 'task' }, 'Refuse')
    const [toGrant, toRefuse] = m.flows.filter((f) => f.source === ok.id)
    setFlow(m, toGrant.id, { name: 'Yes', condition: 'score ≥ 60' })
    setFlow(m, toRefuse.id, { name: 'No' })
    setDefaultFlow(m, toRefuse.id, true)
    void grant
    void refuse

    expect(() => groupIntoSubprocess(structuredClone(m), [check.id, ok.id])).toThrow(/2 ways out/)
    const sp = groupIntoSubprocess(m, [check.id, ok.id], { gateways: true, name: 'Assess' })
    expectSound(m)
    const after = m.flows.find((f) => f.source === sp.id)!
    const outer = nodeOf(m, after.target)!
    expect(outer).toMatchObject({ type: 'gateway', kind: 'exclusive', parentId: undefined })
    expect(paths(m).filter((p) => p.startsWith(outer.id))).toEqual([`${outer.id} > Grant [score ≥ 60]`, `${outer.id} > Refuse`])
    // Inside, each branch ends in an end event of its own, with its condition; the default stays the default.
    const fromOk = m.flows.filter((f) => f.source === ok.id)
    expect(fromOk.map((f) => f.id).sort()).toEqual([toGrant.id, toRefuse.id].sort())
    for (const f of fromOk) expect(nodeOf(m, f.target)).toMatchObject({ type: 'event', position: 'end', parentId: sp.id })
    expect(fromOk.find((f) => f.id === toGrant.id)?.condition).toBe('score ≥ 60')
    expect(nodeOf(m, ok.id)).toMatchObject({ defaultFlow: toRefuse.id })
    // Ungrouping joins each branch to the gateway after: the process reads the same.
    ungroupSubprocess(m, sp.id)
    expectSound(m)
    expect(paths(m)).toEqual(['Apply > Check', `Check > OK?`, `OK? > ${outer.id} [score ≥ 60]`, `OK? > ${outer.id}`, `${outer.id} > Grant [score ≥ 60]`, `${outer.id} > Refuse`].sort())
  })

  it('message flows stay on the inner steps; data and boundary events come along', () => {
    const { m, receive, check } = line()
    addPool(m, { x: 0, y: 400 }, 'Customer')
    m.participants[1].processId = undefined
    const msg = connect(m, 'Participant_2', receive.id)
    const doc = addNode(m, { type: 'dataObject' }, { x: m.diagram.shapes[check.id].x + 50, y: 230 }, 'Form')
    connect(m, check.id, doc.id)
    const late = addBoundaryEvent(m, check.id, 'timer')
    const sp = groupIntoSubprocess(m, [receive.id, check.id, late.id])
    expectSound(m)
    expect(m.flows.find((f) => f.id === msg.id)).toMatchObject({ kind: 'message', target: receive.id })
    expect(nodeOf(m, late.id)?.parentId).toBe(sp.id)
    expect(m.diagram.shapes[late.id].y + 18).toBe(m.diagram.shapes[check.id].y + m.diagram.shapes[check.id].height)
  })

  it('refuses what cannot be one sub-process', () => {
    const { m, receive, check, approve } = line()
    addPool(m, { x: 0, y: 400 }, 'Other')
    const there = addNode(m, { type: 'task' }, { x: 200, y: 475 }, 'There')
    expect(() => groupIntoSubprocess(m, [receive.id, there.id])).toThrow(/one process level/)
    expect(() => groupIntoSubprocess(m, [])).toThrow(ModelError)
    const late = addBoundaryEvent(m, check.id, 'timer')
    expect(() => groupIntoSubprocess(m, [late.id])).toThrow(/boundary event/)
    // A step drawn under the selection, not selected, moves out of the way instead of ending up inside.
    m.nodes = m.nodes.filter((n) => n.id !== late.id)
    const under = addNode(m, { type: 'task' }, { x: m.diagram.shapes[check.id].x + 50, y: 200 }, 'Under')
    const sp = groupIntoSubprocess(m, [receive.id, check.id, approve.id])
    expect(nodeOf(m, under.id)?.parentId).toBeUndefined()
    expectSound(m)
    expect(m.diagram.shapes[sp.id].y).toBeGreaterThanOrEqual(m.diagram.shapes.Participant_1.y)
  })

  it('the grouped model round-trips through BPMN XML', async () => {
    const { m, receive, check } = line()
    groupIntoSubprocess(m, [receive.id, check.id], { name: 'Intake' })
    const { model } = await readBpmn(await writeBpmn(m))
    expect(paths(model)).toEqual(paths(m))
    expect(model.nodes.filter((n) => n.parentId).map((n) => n.id).sort()).toEqual(m.nodes.filter((n) => n.parentId).map((n) => n.id).sort())
  })
})

describe('ungroup sub-process', () => {
  it('a collapsed sub-process: its content takes its place', () => {
    const m = kitchenSink()
    const bill = m.nodes.find((n) => n.name === 'Bill')!
    const task = m.nodes.find((n) => n.name === 'Write invoice')!
    const at = { ...m.diagram.shapes[bill.id] }
    ungroupSubprocess(m, bill.id)
    expectSound(m)
    expect(nodeOf(m, bill.id)).toBeUndefined()
    expect(nodeOf(m, task.id)?.parentId).toBeUndefined()
    expect(m.diagram.shapes[task.id].x).toBe(at.x)
  })

  it('several steps after the start and before the end: each joins the outer flows', () => {
    const { m, receive, check } = line()
    const sp = groupIntoSubprocess(m, [receive.id, check.id], { name: 'Intake' })
    // A second branch inside: start → Note → end.
    const start = m.nodes.find((n) => n.parentId === sp.id && n.type === 'event' && n.position === 'start')!
    const end = m.nodes.find((n) => n.parentId === sp.id && n.type === 'event' && n.position === 'end')!
    const box = m.diagram.shapes[sp.id]
    resizeElement(m, sp.id, { ...box, height: box.height + 150 })
    const note = addNode(m, { type: 'task' }, { x: m.diagram.shapes[receive.id].x + 50, y: m.diagram.shapes[receive.id].y + 40 + 100 }, 'Note')
    expect(nodeOf(m, note.id)?.parentId).toBe(sp.id)
    connect(m, start.id, note.id)
    connect(m, note.id, end.id)
    ungroupSubprocess(m, sp.id)
    expectSound(m)
    expect(paths(m)).toEqual(['Approve > Archive', 'Archive > End', 'Check > Approve', 'Note > Approve', 'Receive > Check', 'Start > Note', 'Start > Receive'])
  })

  it('refuses a sub-process with boundary events, or flows in without a plain start event', () => {
    const { m, receive, check } = line()
    const sp = groupIntoSubprocess(m, [receive.id, check.id])
    const err = addBoundaryEvent(m, sp.id, 'error')
    expect(() => ungroupSubprocess(m, sp.id)).toThrow(/boundary events/)
    m.nodes = m.nodes.filter((n) => n.id !== err.id)
    const start = m.nodes.find((n) => n.parentId === sp.id && n.type === 'event' && n.position === 'start')!
    updateNode(m, start.id, { trigger: 'message' })
    expect(() => ungroupSubprocess(m, sp.id)).toThrow(/plain start event/)
  })
})
