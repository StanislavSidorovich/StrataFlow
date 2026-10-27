// Collapsing a sub-process (setCollapsed, and the Bizagi export that does the same): no gap where the content was,
// the box in the lane of its steps, the pool narrows back, messages of one sub-process do not share a line.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collapseForBizagi } from '../src/core/bpmn/pages'
import { groupIntoSubprocess, nodeOf, setCollapsed } from '../src/core/ops'
import { parseModel } from '../src/core/serialize'
import type { FlowModel } from '../src/core/metamodel'

const shopOrder = () => parseModel(readFileSync('cases/shop-order.flow.json', 'utf8'))
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('collapse leaves no gap', () => {
  it('shop-order: Receive payment + 14 days + Reminder sent collapse into Collect payment in the Sales lane', () => {
    const m = shopOrder()
    const before = structuredClone(m)
    const sp = groupIntoSubprocess(m, ['Task_4', 'Event_4', 'Event_5'], { name: 'Collect payment' })
    const poolOpen = m.diagram.shapes.Participant_1.width
    setCollapsed(m, sp.id, true)
    const box = m.diagram.shapes[sp.id]
    const lane = m.diagram.shapes.Lane_1
    expect(nodeOf(m, sp.id)).toMatchObject({ collapsed: true, laneId: 'Lane_1' })
    expect(box.y).toBeGreaterThanOrEqual(lane.y)
    expect(box.y + box.height).toBeLessThanOrEqual(lane.y + lane.height)
    // the boundary timer belongs to the page, with the task it is on
    expect(nodeOf(m, 'Event_4')).toMatchObject({ parentId: sp.id, attachedTo: 'Task_4' })
    expect(nodeOf(m, 'Event_5')?.parentId).toBe(sp.id)
    // what followed is back near where it was, not 280 units left of it
    const ship = m.diagram.shapes.Task_5
    expect(Math.abs(ship.x - before.diagram.shapes.Task_5.x)).toBeLessThanOrEqual(10)
    expect(ship.x - (box.x + box.width)).toBeGreaterThanOrEqual(40 - 1)
    // the pool is back to about what it was
    expect(m.diagram.shapes.Participant_1.width).toBeLessThan(poolOpen)
    expect(Math.abs(m.diagram.shapes.Participant_1.width - before.diagram.shapes.Participant_1.width)).toBeLessThanOrEqual(40)
    // nothing visible overlaps
    const shown = m.nodes.filter((n) => !n.parentId && !(n.type === 'event' && n.attachedTo) && n.type !== 'dataObject').map((n) => n.id)
    for (const a of shown) for (const b of shown) if (a < b) expect(overlap(m.diagram.shapes[a], m.diagram.shapes[b]), `${a} ${b}`).toBe(false)
  })

  it('the export collapses to the same result as the editor', () => {
    const m = shopOrder()
    const sp = groupIntoSubprocess(m, ['Task_4', 'Event_4', 'Event_5'], { name: 'Collect payment' })
    const exported = collapseForBizagi(m).model
    setCollapsed(m, sp.id, true)
    expect(exported.diagram.shapes[sp.id]).toEqual(m.diagram.shapes[sp.id])
    expect(exported.diagram.shapes.Task_5).toEqual(m.diagram.shapes.Task_5)
    expect(exported.diagram.shapes.Participant_1).toEqual(m.diagram.shapes.Participant_1)
  })

  it('does not close up past the room the next step had', () => {
    const m = shopOrder()
    const sp = groupIntoSubprocess(m, ['Task_1'], { name: 'Check' })
    setCollapsed(m, sp.id, true)
    const box = m.diagram.shapes[sp.id]
    expect(m.diagram.shapes.Gateway_1.x - (box.x + box.width)).toBeGreaterThanOrEqual(39)
  })
})

describe('collapse of a sub-process over several lanes', () => {
  /** Steps in Sales (two) and Warehouse (one) grouped, then collapsed. */
  function group(ids: string[]) {
    const m = shopOrder()
    const sp = groupIntoSubprocess(m, ids, { name: 'Group', gateways: true })
    return { m, sp }
  }
  const unrelated = (m: FlowModel, skip: string[]) => Object.fromEntries(m.nodes.filter((n) => !skip.includes(n.id) && !n.parentId).map((n) => [n.id, m.diagram.shapes[n.id]]))

  it('the box goes to the lane holding most of its steps', () => {
    const { m, sp } = group(['Task_3', 'Task_2', 'Gateway_3'])
    // Task_3 sits in Sales, Task_2 and Gateway_3 in Warehouse (plus the start and end events grouping adds)
    const kids = m.nodes.filter((n) => n.parentId === sp.id && !(n.type === 'event' && n.attachedTo) && n.type !== 'dataObject')
    const lanes = ['Lane_1', 'Lane_2'].map((l) => kids.filter((k) => k.laneId === l).length)
    const expected = lanes[1] > lanes[0] ? 'Lane_2' : 'Lane_1'
    setCollapsed(m, sp.id, true)
    const box = m.diagram.shapes[sp.id]
    const lane = m.diagram.shapes.Lane_2
    const ls = m.diagram.shapes[expected]
    expect(nodeOf(m, sp.id)!.laneId).toBe(expected)
    expect(box.y).toBeGreaterThanOrEqual(ls.y)
    expect(box.y + box.height).toBeLessThanOrEqual(ls.y + ls.height)
    expect(lane).toBeDefined()
  })

  it('a box centred between the lanes is moved into the lane of its first step on a tie', () => {
    const { m, sp } = group(['Task_3', 'Task_2'])
    const s = m.diagram.shapes[sp.id]
    // opened box straddling the border of the lanes
    Object.assign(s, { y: m.diagram.shapes.Lane_2.y - s.height / 2 })
    const lane = nodeOf(m, 'Task_3')!.laneId
    nodeOf(m, sp.id)!.laneId = undefined
    setCollapsed(m, sp.id, true)
    expect(nodeOf(m, sp.id)!.laneId).toBe(lane)
    const box = m.diagram.shapes[sp.id]
    const ls = m.diagram.shapes[lane!]
    expect(box.y).toBeGreaterThanOrEqual(ls.y)
    expect(box.y + box.height).toBeLessThanOrEqual(ls.y + ls.height)
  })

  it('does not move what is left of it or in no way to its right', () => {
    const { m, sp } = group(['Task_3', 'Task_2'])
    const before = unrelated(m, [sp.id, 'Task_3', 'Task_2'])
    setCollapsed(m, sp.id, true)
    const s = m.diagram.shapes[sp.id]
    for (const [id, b] of Object.entries(before)) {
      if (b.x + b.width / 2 <= s.x + 1) expect(m.diagram.shapes[id], id).toEqual(b)
    }
  })
})

describe('messages of one collapsed sub-process', () => {
  it('are drawn at different x on the main sheet', () => {
    const m = shopOrder()
    const sp = groupIntoSubprocess(m, ['Task_3'], { name: 'Invoice' })
    // two messages with the sub-process box itself as the end
    m.flows.push({ id: 'MessageFlow_a', kind: 'message', source: sp.id, target: 'Participant_2', name: '' })
    m.flows.push({ id: 'MessageFlow_b', kind: 'message', source: 'Participant_2', target: sp.id, name: '' })
    const { model } = collapseForBizagi(m)
    const a = model.diagram.edges.MessageFlow_a
    const b = model.diagram.edges.MessageFlow_b
    expect(a?.length).toBeGreaterThan(1)
    expect(b?.length).toBeGreaterThan(1)
    expect(a[0].x).not.toBe(b[b.length - 1].x)
    const box = model.diagram.shapes[sp.id]
    for (const x of [a[0].x, b[b.length - 1].x]) expect(x > box.x && x < box.x + box.width).toBe(true)
  })
})
