// Stage 2: auto layout (SPEC §4). Whatever the drawing was, after one click: every element keeps its pool,
// lane and sub-process; nothing overlaps; steps run left to right; lanes are bands with room on the left;
// the result still round-trips through BPMN XML.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyModel, isArtifact, type Bounds, type FlowModel, type FlowNode } from '../src/core/metamodel'
import { addLane, addNode, addPool, connect } from '../src/core/ops'
import { autoLayout, LEFT_MARGIN } from '../src/core/layout'
import { readBpmn } from '../src/core/bpmn/read'
import { writeBpmn } from '../src/core/bpmn/write'
import { parseModel } from '../src/core/serialize'
import { drawOrderFulfilment } from './fixtures/order-fulfilment'
import { kitchenSink, pools } from './fixtures/models'

/** Pool, lane and sub-process of every element. An artifact's lane is only where it is drawn (BPMN has none for it). */
const where = (m: FlowModel) => Object.fromEntries(m.nodes.map((n) => [n.id, [n.participantId, isArtifact(n) ? '' : n.laneId, n.parentId]]))
const overlap = (a: Bounds, b: Bounds) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const inside = (a: Bounds, b: Bounds) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height

function hiddenIds(m: FlowModel) {
  const out = new Set<string>()
  for (const n of m.nodes)
    for (let p = n.parentId; p; p = m.nodes.find((x) => x.id === p)?.parentId)
      if (m.nodes.find((x) => x.id === p && x.type === 'subProcess' && x.collapsed)) out.add(n.id)
  return out
}

/** The layout invariants, for any model. */
async function expectLaidOut(m: FlowModel) {
  const before = where(m)
  await autoLayout(m)
  const s = m.diagram.shapes
  expect(where(m)).toEqual(before)
  expect(m.diagram.edges).toEqual({})

  const hidden = hiddenIds(m)
  const shown = m.nodes.filter((n) => !hidden.has(n.id) && !(n.type === 'event' && n.attachedTo))
  // Siblings (same sub-process or none) never overlap.
  for (const a of shown)
    for (const b of shown)
      if (a.id < b.id && a.parentId === b.parentId) expect(overlap(s[a.id], s[b.id]), `${a.id} on ${b.id}`).toBe(false)
  // Content sits inside its expanded sub-process.
  for (const n of shown) if (n.parentId) expect(inside(s[n.id], s[n.parentId]), `${n.id} in ${n.parentId}`).toBe(true)
  // Pools do not overlap; lanes fill their pool, one under the other.
  for (const a of m.participants) for (const b of m.participants) if (a.id < b.id) expect(overlap(s[a.id], s[b.id])).toBe(false)
  for (const p of m.participants) {
    const top = m.lanes.filter((l) => l.participantId === p.id && !l.parentLaneId).sort((a, b) => s[a.id].y - s[b.id].y)
    if (!top.length) continue
    expect(s[top[0].id].y).toBe(s[p.id].y)
    for (let i = 1; i < top.length; i++) expect(s[top[i].id].y).toBe(s[top[i - 1].id].y + s[top[i - 1].id].height)
    // Steps outside every lane (Bizagi allows it) get a band below the lanes.
    const laneless = m.nodes.some((n) => n.participantId === p.id && !n.laneId && !isArtifact(n))
    if (!laneless) expect(s[top.at(-1)!.id].y + s[top.at(-1)!.id].height).toBe(s[p.id].y + s[p.id].height)
    for (const l of top) expect(s[l.id].x + s[l.id].width).toBe(s[p.id].x + s[p.id].width)
  }
  // Steps in a pool keep the left margin clear (Bizagi writes lane names there) and sit wholly in their lane.
  for (const n of shown) {
    if (!n.participantId || n.parentId) continue
    const band = s[n.laneId ?? n.participantId]
    expect(s[n.id].x, n.id).toBeGreaterThanOrEqual(band.x + LEFT_MARGIN)
    expect(inside(s[n.id], band), `${n.id} in ${n.laneId}`).toBe(true)
  }
  // Boundary events sit on their host's lower border.
  for (const n of m.nodes)
    if (n.type === 'event' && n.attachedTo && !hidden.has(n.id)) expect(s[n.id].y + s[n.id].height / 2).toBe(s[n.attachedTo].y + s[n.attachedTo].height)
  return m
}

/** Sequence flows that go right (not loops back): elkjs puts each target in a later column. */
function rightward(m: FlowModel, f: { source: string; target: string }) {
  const s = m.diagram.shapes
  return s[f.source].x + s[f.source].width / 2 < s[f.target].x + s[f.target].width / 2
}

describe('auto layout', () => {
  it('order fulfilment: lanes kept, steps left to right, data under its task', async () => {
    const m = emptyModel()
    const { slip, late } = drawOrderFulfilment(m)
    await expectLaidOut(m)
    const s = m.diagram.shapes
    for (const f of m.flows.filter((x) => x.kind === 'sequence')) expect(rightward(m, f), f.id).toBe(true)
    // The packing slip sits below Pack goods, in the same lane, so its line goes straight down.
    const pack = m.nodes.find((n) => n.name === 'Pack goods')!
    expect(s[slip.id].y).toBeGreaterThan(s[pack.id].y + s[pack.id].height)
    expect(Math.abs(s[slip.id].x + s[slip.id].width / 2 - (s[pack.id].x + s[pack.id].width / 2))).toBeLessThan(1)
    expect(m.nodes.find((n) => n.id === late.id)?.laneId).toBe(m.nodes.find((n) => n.name === 'Send invoice')?.laneId)
    // Both pools are as wide as each other; the black box keeps its place below.
    expect(s.Participant_1.width).toBe(s.Participant_2.width)
    expect(s.Participant_2.y).toBeGreaterThan(s.Participant_1.y + s.Participant_1.height)
  })

  it('the example lays out and still round-trips through BPMN XML', async () => {
    const m = await expectLaidOut(parseModel(readFileSync('src/data/examples/library-loan.flow.json', 'utf8')))
    const { model } = await readBpmn(await writeBpmn(m))
    expect(where(model)).toEqual(where(m))
  })

  it('a second run changes nothing', async () => {
    const m = emptyModel()
    drawOrderFulfilment(m)
    await autoLayout(m)
    const once = structuredClone(m.diagram.shapes)
    await autoLayout(m)
    expect(m.diagram.shapes).toEqual(once)
  })

  it('sub-processes: an expanded one grows round its content, a collapsed one takes its hidden content along', async () => {
    const m = kitchenSink()
    const closed = m.nodes.find((n) => n.name === 'Bill')!
    const hiddenTask = m.nodes.find((n) => n.name === 'Write invoice')!
    const offset = (id: string) => ({ x: m.diagram.shapes[id].x - m.diagram.shapes[closed.id].x, y: m.diagram.shapes[id].y - m.diagram.shapes[closed.id].y })
    const was = offset(hiddenTask.id)
    await expectLaidOut(m)
    expect(offset(hiddenTask.id)).toEqual(was)
    const open = m.nodes.find((n) => n.name === 'Pack and ship')!
    const inner = m.nodes.filter((n) => n.parentId === open.id)
    expect(inner.length).toBe(3)
    for (const n of inner) expect(m.diagram.shapes[n.id].x).toBeGreaterThan(m.diagram.shapes[open.id].x)
  })

  it('pools with nested lanes and an empty pool', async () => {
    const m = await expectLaidOut(pools())
    const s = m.diagram.shapes
    // The parent lane spans its two shift lanes.
    const front = m.lanes.find((l) => l.name === 'Front office')!
    expect(s[front.id].y).toBe(s.Lane_day.y)
    expect(s[front.id].y + s[front.id].height).toBe(s.Lane_night.y + s.Lane_night.height)
    expect(s.Lane_day.x).toBe(s[front.id].x + 30)
  })

  it('a step in each of three lanes, joined back and forth, stays in its lane', async () => {
    const m = emptyModel()
    addPool(m, { x: 0, y: 0 }, 'Shop')
    const lanes = ['A', 'B', 'C'].map((n) => addLane(m, 'Participant_1', n))
    const ys = lanes.map((l) => m.diagram.shapes[l.id].y + 75)
    const nodes: FlowNode[] = []
    for (let i = 0; i < 6; i++) nodes.push(addNode(m, { type: 'task' }, { x: 900 - i * 120, y: ys[i % 3] }, `Step ${i}`))
    for (let i = 0; i < 5; i++) connect(m, nodes[i].id, nodes[i + 1].id)
    await expectLaidOut(m)
    for (let i = 0; i < 5; i++) expect(rightward(m, { source: nodes[i].id, target: nodes[i + 1].id })).toBe(true)
  })

  it('artifacts without a line and steps outside any pool', async () => {
    const m = emptyModel()
    const a = addNode(m, { type: 'task' }, { x: 400, y: 100 }, 'A')
    const b = addNode(m, { type: 'task' }, { x: 100, y: 300 }, 'B')
    connect(m, a.id, b.id)
    addNode(m, { type: 'annotation' }, { x: 100, y: 100 }, 'A loose note')
    await expectLaidOut(m)
    expect(rightward(m, { source: a.id, target: b.id })).toBe(true)
    expect(m.nodes.filter(isArtifact).length).toBe(1)
  })
})

// The owner's Bizagi exports (gitignored in /private): skipped where they are absent (CI).
const root = 'private/course/bizagi'
const files = existsSync(root) ? (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.bpmn')).map((f) => join(root, f)) : []
describe.skipIf(files.length === 0)('auto layout of real Bizagi exports', () => {
  it.each(files)('%s', async (file) => {
    const { model } = await readBpmn(readFileSync(file, 'utf8'))
    await expectLaidOut(model)
  })
})
