// Stage 2: BPMN XML round-trip (SPEC §12). read(write(m)) gives m back for every model we ship or draw, up
// to what the export settles on purpose: the drawing moves so the leftmost pool sits at x = 0, a pool
// without steps is a black box, and flows the canvas routes itself get waypoints. A second trip changes nothing.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BpmnModdle } from 'bpmn-moddle'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import { readBpmn } from '../src/core/bpmn/read'
import { route, writeBpmn } from '../src/core/bpmn/write'
import { parseModel } from '../src/core/serialize'
import { drawOrderFulfilment } from './fixtures/order-fulfilment'
import { kitchenSink, pools } from './fixtures/models'
import { CASES } from './fixtures/cases'

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

/** What the export settles on purpose: leftmost pool at x = 0; a pool without steps is a black box. */
function settled(m: FlowModel): FlowModel {
  const c = plain(m)
  const xs = c.participants.flatMap((p) => (c.diagram.shapes[p.id] ? [c.diagram.shapes[p.id].x] : []))
  const dx = xs.length ? -Math.min(...xs) : 0
  for (const s of Object.values(c.diagram.shapes)) s.x += dx
  for (const pts of Object.values(c.diagram.edges)) for (const p of pts) p.x += dx
  for (const p of c.participants) if (!c.nodes.some((n) => n.participantId === p.id && !['dataObject', 'dataStore', 'annotation'].includes(n.type))) delete p.processId
  return c
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
  expect(withoutAddedEdges(back, m)).toEqual(settled(m))
  // Every flow is drawn, and a second trip is a fixpoint.
  for (const f of m.flows) expect(back.diagram.edges[f.id]?.length, f.id).toBeGreaterThanOrEqual(2)
  const again = await roundTrip(back)
  expect(again.back).toEqual(back)
  expect(again.xml).toBe(await writeBpmn(back))
  return { xml, back }
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

  for (const c of CASES)
    it(`the case reference model ${c.id}.flow.json is lossless`, async () => {
      await expectLossless(parseModel(readFileSync(`cases/${c.id}.flow.json`, 'utf8')))
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
    // Bizagi drops a pool without a process: the black box gets an empty one.
    expect(xml).toMatch(/<bpmn:participant id="Participant_2" name="Guest" processRef="Process_Participant_2" \/>/)
    expect(xml).toMatch(/<bpmn:process id="Process_Participant_2" name="Guest" isExecutable="false" \/>/)
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

describe('BPMN export for Bizagi', () => {
  it('writes data as references only, with a plain association along each data association', async () => {
    const xml = await writeBpmn(parseModel(readFileSync('src/data/examples/library-loan.flow.json', 'utf8')))
    expect(xml).not.toMatch(/<bpmn:dataObject /)
    expect(xml).toMatch(/<bpmn:dataObjectReference id="DataRef_slip" name="Loan slip">/)
    expect(xml).toMatch(/<bpmn:association id="\w+_line" associationDirection="One" sourceRef="Task_fetch" targetRef="DataRef_slip" \/>/)
  })

  it('puts the leftmost pool at x = 0, so lane x reads the same as absolute and as relative', async () => {
    const xml = await writeBpmn(parseModel(readFileSync('src/data/examples/library-loan.flow.json', 'utf8')))
    expect(xml).toMatch(/bpmnElement="Participant_library" isHorizontal="true">\s*<dc:Bounds x="0"/)
    expect(xml).toMatch(/bpmnElement="Lane_desk" isHorizontal="true">\s*<dc:Bounds x="30"/)
  })

  it('gives labels the place the canvas shows them: above a gateway, below an event', async () => {
    const xml = await writeBpmn(parseModel(readFileSync('src/data/examples/library-loan.flow.json', 'utf8')))
    const { model } = await readBpmn(xml)
    const at = (id: string) => model.diagram.shapes[id]
    const labelOf = (id: string) => {
      const m = xml.match(new RegExp(String.raw`bpmnElement="${id}">[\s\S]*?<bpmndi:BPMNLabel>\s*<dc:Bounds x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"`))!
      return { x: +m[1], y: +m[2], width: +m[3], height: +m[4] }
    }
    const g = labelOf('Gateway_valid')
    expect(g.y + g.height).toBeLessThanOrEqual(at('Gateway_valid').y)
    expect(labelOf('Start_requested').y).toBeGreaterThanOrEqual(at('Start_requested').y + at('Start_requested').height)
    expect(xml).toMatch(/bpmnElement="Flow_no">[\s\S]*?<bpmndi:BPMNLabel>/)
  })

  it('reads Bizagi\'s bare data object and its drawn association as one data flow', async () => {
    const xml = `<?xml version="1.0"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="D" targetNamespace="http://www.bizagi.com/definitions/D">
  <process id="P">
    <dataObject id="Doc" name="Results" />
    <task id="T" name="Print results">
      <dataOutputAssociation id="DOA"><targetRef>Doc</targetRef></dataOutputAssociation>
    </task>
    <association id="A" sourceRef="T" targetRef="Doc" />
  </process>
  <bpmndi:BPMNDiagram id="Di"><bpmndi:BPMNPlane id="Pl" bpmnElement="P">
    <bpmndi:BPMNShape id="S1" bpmnElement="T"><dc:Bounds x="100" y="100" width="90" height="60" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="S2" bpmnElement="Doc"><dc:Bounds x="250" y="100" width="40" height="50" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="E1" bpmnElement="A"><di:waypoint x="190" y="130" /><di:waypoint x="250" y="125" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`
    const { model, warnings } = await readBpmn(xml)
    expect(warnings).toEqual([])
    expect(model.nodes.find((n) => n.id === 'Doc')).toMatchObject({ type: 'dataObject', name: 'Results' })
    expect(model.flows).toEqual([{ id: 'DOA', kind: 'data', source: 'T', target: 'Doc', name: '' }])
    expect(model.diagram.edges.DOA).toEqual([{ x: 190, y: 130 }, { x: 250, y: 125 }])
  })
})
