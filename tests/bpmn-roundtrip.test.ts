// Stage 2: BPMN XML round-trip (SPEC §12). read(write(m)) gives m back for every model we ship or draw;
// the only addition is waypoints for flows the canvas routes itself, and writing that again changes nothing.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BpmnModdle } from 'bpmn-moddle'
import { emptyModel, SIZES, type FlowModel, type FlowNode } from '../src/core/metamodel'
import { addBoundaryEvent, addLane, addNode, addPool, appendNode, connect } from '../src/core/ops'
import { readBpmn } from '../src/core/bpmn/read'
import { route, writeBpmn } from '../src/core/bpmn/write'
import { parseModel } from '../src/core/serialize'
import { drawOrderFulfilment } from './fixtures/order-fulfilment'

/** JSON drops undefined keys, as a saved file does. List order is not compared: BPMN groups elements by
 *  container and kind, so pools, lanes, nodes and flows come back sorted by id. */
const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const plain = (m: FlowModel): FlowModel => {
  const c: FlowModel = JSON.parse(JSON.stringify(m))
  return { ...c, participants: byId(c.participants), lanes: byId(c.lanes), nodes: byId(c.nodes), flows: byId(c.flows) }
}

async function roundTrip(m: FlowModel) {
  const xml = await writeBpmn(m)
  const { model, warnings } = await readBpmn(xml)
  return { xml, back: plain(model), warnings }
}

/** The model as read back, minus the waypoints the writer added for flows that had none. */
function withoutAddedEdges(back: FlowModel, original: FlowModel): FlowModel {
  const edges = Object.fromEntries(Object.entries(back.diagram.edges).filter(([id]) => original.diagram.edges[id]))
  return { ...back, diagram: { ...back.diagram, edges } }
}

async function expectLossless(original: FlowModel) {
  const m = plain(original)
  const { xml, back, warnings } = await roundTrip(m)
  expect(warnings).toEqual([])
  expect(withoutAddedEdges(back, m)).toEqual(m)
  // Every flow is drawn, and a second trip is a fixpoint.
  for (const f of m.flows) expect(back.diagram.edges[f.id]?.length, f.id).toBeGreaterThanOrEqual(2)
  const again = await roundTrip(back)
  expect(again.back).toEqual(back)
  expect(again.xml).toBe(await writeBpmn(back))
  return { xml, back }
}

/** Everything the metamodel has: no pool, every task kind, gateway kind and trigger, sub-processes both ways, artifacts. */
function kitchenSink(): FlowModel {
  const m = emptyModel('Kitchen sink')
  let last = addNode(m, { type: 'event', position: 'start', trigger: 'timer' }, { x: 60, y: 100 }, 'Every Monday')
  for (const kind of ['task', 'user', 'service', 'manual', 'send', 'receive', 'script', 'businessRule'] as const)
    last = appendNode(m, last.id, { type: 'task', kind }, `A ${kind} task`)
  for (const kind of ['exclusive', 'parallel', 'inclusive', 'eventBased', 'complex'] as const) last = appendNode(m, last.id, { type: 'gateway', kind })
  for (const trigger of ['none', 'message', 'timer', 'signal', 'conditional', 'link'] as const)
    last = appendNode(m, last.id, { type: 'event', position: 'intermediate', trigger }, `Catch ${trigger}`)
  for (const trigger of ['none', 'message', 'signal', 'escalation', 'compensation', 'link'] as const)
    last = appendNode(m, last.id, { type: 'event', position: 'intermediate', trigger, throwing: true }, `Throw ${trigger}`)
  for (const trigger of ['error', 'terminate'] as const) appendNode(m, last.id, { type: 'event', position: 'end', trigger })

  // An expanded sub-process with content, and a collapsed one with hidden content.
  const open = addNode(m, { type: 'subProcess' }, { x: 300, y: 400 }, 'Pack and ship')
  const os = m.diagram.shapes[open.id]
  Object.assign(os, { x: 100, y: 300, width: 500, height: 200 })
  ;(open as Extract<FlowNode, { type: 'subProcess' }>).collapsed = false
  const inStart = addNode(m, { type: 'event' }, { x: 150, y: 400 })
  const inTask = appendNode(m, inStart.id, { type: 'task' }, 'Pack')
  appendNode(m, inTask.id, { type: 'event', position: 'end' })
  expect(m.nodes.find((n) => n.id === inTask.id)?.parentId).toBe(open.id)
  const err = addBoundaryEvent(m, open.id, 'error')
  appendNode(m, err.id, { type: 'task' }, 'Handle damage')
  const closed = addNode(m, { type: 'subProcess' }, { x: 300, y: 700 }, 'Bill')
  Object.assign(m.diagram.shapes[closed.id], { x: 100, y: 600, width: 400, height: 200 })
  ;(closed as Extract<FlowNode, { type: 'subProcess' }>).collapsed = false
  const hiddenTask = addNode(m, { type: 'task' }, { x: 250, y: 700 }, 'Write invoice')
  ;(closed as Extract<FlowNode, { type: 'subProcess' }>).collapsed = true
  Object.assign(m.diagram.shapes[closed.id], { x: 250, y: 660, ...SIZES.subProcess })
  expect(m.nodes.find((n) => n.id === hiddenTask.id)?.parentId).toBe(closed.id)

  const store = addNode(m, { type: 'dataStore' }, { x: 900, y: 400 }, 'Orders')
  connect(m, store.id, inTask.id)
  const doc = addNode(m, { type: 'dataObject' }, { x: 1000, y: 400 }, 'Invoice')
  ;(doc as Extract<FlowNode, { type: 'dataObject' }>).state = 'sent'
  connect(m, hiddenTask.id, doc.id)
  const note = addNode(m, { type: 'annotation' }, { x: 1100, y: 400 }, 'Runs weekly')
  connect(m, note.id, m.nodes[0].id)
  return m
}

/** Two pools, one with nested lanes; an empty white-box pool; a message flow to a black-box pool. */
function pools(): FlowModel {
  const m = emptyModel('Pools and lanes')
  addPool(m, { x: 0, y: 0 }, 'Hotel')
  const front = addLane(m, 'Participant_1', 'Front office')
  addLane(m, 'Participant_1', 'Housekeeping')
  // Nested lanes are not drawn by the editor yet, but read and kept.
  const fs = m.diagram.shapes[front.id]
  m.lanes.push({ id: 'Lane_day', name: 'Day shift', participantId: 'Participant_1', parentLaneId: front.id }, { id: 'Lane_night', name: 'Night shift', participantId: 'Participant_1', parentLaneId: front.id })
  m.diagram.shapes.Lane_day = { x: fs.x + 30, y: fs.y, width: fs.width - 30, height: fs.height / 2 }
  m.diagram.shapes.Lane_night = { x: fs.x + 30, y: fs.y + fs.height / 2, width: fs.width - 30, height: fs.height / 2 }
  const start = addNode(m, { type: 'event', trigger: 'message' }, { x: 120, y: 60 }, 'Booking received')
  m.nodes.find((n) => n.id === start.id)!.laneId = 'Lane_day'
  const t = appendNode(m, start.id, { type: 'task', kind: 'user' }, 'Confirm booking')
  m.nodes.find((n) => n.id === t.id)!.laneId = 'Lane_day'
  const clean = addNode(m, { type: 'task', kind: 'manual' }, { x: 400, y: 330 }, 'Prepare room')
  connect(m, t.id, clean.id)
  appendNode(m, clean.id, { type: 'event', position: 'end' }, 'Room ready')
  addPool(m, { x: 0, y: 500 }, 'Guest')
  m.participants[1].processId = undefined
  connect(m, 'Participant_2', start.id)
  connect(m, t.id, 'Participant_2')
  addPool(m, { x: 0, y: 800 }, 'Laundry')
  return m
}

describe('BPMN round-trip', () => {
  it('order fulfilment (stage 1 acceptance) is lossless', async () => {
    const m = emptyModel('Order fulfilment')
    drawOrderFulfilment(m)
    await expectLossless(m)
  })

  it('the bundled example (.flow.json) is lossless', async () => {
    await expectLossless(parseModel(readFileSync('src/data/examples/library-loan.flow.json', 'utf8')))
  })

  it('the Bizagi-shaped sample, once read, is lossless', async () => {
    const { model } = await readBpmn(readFileSync('src/data/examples/library-loan.bpmn', 'utf8'))
    await expectLossless(model)
  })

  it('every element type, sub-processes and artifacts are lossless', async () => {
    const { xml } = await expectLossless(kitchenSink())
    // The collapsed sub-process draws its content in a diagram of its own.
    expect(xml.match(/<bpmndi:BPMNDiagram /g)).toHaveLength(2)
  })

  it('pools, nested lanes, empty and black-box pools are lossless', async () => {
    const { xml } = await expectLossless(pools())
    expect(xml).toContain('<bpmn:childLaneSet')
    expect(xml).toMatch(/<bpmn:participant id="Participant_2" name="Guest" \/>/)
  })
})

describe('BPMN export', () => {
  const m = emptyModel('Order fulfilment')
  drawOrderFulfilment(m)

  it('is valid for bpmn-moddle and names the exporter', async () => {
    const xml = await writeBpmn(m)
    const { warnings } = await new BpmnModdle().fromXML(xml)
    expect(warnings).toEqual([])
    expect(xml).toMatch(/exporter="StrataFlow"/)
    expect(xml).toContain('<bpmn:collaboration id="Collaboration_1" name="Order fulfilment">')
  })

  it('lists incoming and outgoing flows on each step (Bizagi writes them too)', async () => {
    const xml = await writeBpmn(m)
    const check = m.nodes.find((n) => n.name === 'Check stock')!
    const block = xml.slice(xml.indexOf(`id="${check.id}"`), xml.indexOf('</bpmn:userTask>'))
    expect(block).toMatch(/<bpmn:incoming>Flow_\d+<\/bpmn:incoming>/)
    expect(block).toMatch(/<bpmn:outgoing>Flow_\d+<\/bpmn:outgoing>/)
  })

  it('routes a flow without waypoints between facing sides', () => {
    expect(route({ kind: 'sequence' }, { x: 0, y: 0, width: 100, height: 80 }, { x: 200, y: 100, width: 100, height: 80 })).toEqual([
      { x: 100, y: 40 },
      { x: 150, y: 40 },
      { x: 150, y: 140 },
      { x: 200, y: 140 },
    ])
    expect(route({ kind: 'message' }, { x: 0, y: 0, width: 100, height: 80 }, { x: 0, y: 300, width: 800, height: 200 }, true)).toEqual([
      { x: 50, y: 80 },
      { x: 50, y: 300 },
    ])
    // Message from far right of a narrow pool end: it meets the pool's border below its source.
    expect(route({ kind: 'message' }, { x: 900, y: 0, width: 100, height: 80 }, { x: 0, y: 300, width: 800, height: 200 }, true)).toEqual([
      { x: 950, y: 80 },
      { x: 950, y: 190 },
      { x: 790, y: 190 },
      { x: 790, y: 300 },
    ])
  })
})

// The owner's own Bizagi exports (gitignored); skipped where absent (CI).
const root = 'private/course/bizagi'
const files = existsSync(root) ? (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.bpmn')).map((f) => join(root, f)) : []
describe.skipIf(files.length === 0)('BPMN round-trip of real Bizagi exports', () => {
  it.each(files)('%s', async (file) => {
    const { model } = await readBpmn(readFileSync(file, 'utf8'))
    await expectLossless(model)
  })
})
