// What Bizagi needs from our .bpmn (v0.19.1): the X of an exclusive gateway, the gateway direction its validation
// reads, a Check rule for the gateway Bizagi refuses, and the sheet of figures to type into Simulation View
// (Bizagi does not read Flow's sf: figures). Generic models only: nothing from a real project.
import { describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import { lintModel } from '../src/core/lint'
import { addLane, addNode, addPool, appendNode, connect } from '../src/core/ops'
import { readBpmn } from '../src/core/bpmn/read'
import { writeBpmn } from '../src/core/bpmn/write'
import { bizagiSheet, flowLabelsSheet, bizagiTime } from '../src/core/bizagiSheet'
import { forBizagiSimulation, restoreFlowNames } from '../src/core/bpmn/simCopy'

/** start → XOR (a / b) → XOR merge → AND split → c, d → AND join → end. */
function diamond(): FlowModel {
  const m = emptyModel('Diamond')
  const s = addNode(m, { type: 'event', position: 'start' }, { x: 100, y: 100 }, 'Start')
  const x = appendNode(m, s.id, { type: 'gateway', kind: 'exclusive' }, 'Ready?')
  const a = appendNode(m, x.id, { type: 'task' }, 'Do A')
  const b = addNode(m, { type: 'task' }, { x: 400, y: 260 }, 'Do B')
  connect(m, x.id, b.id)
  const merge = appendNode(m, a.id, { type: 'gateway', kind: 'exclusive' })
  connect(m, b.id, merge.id)
  const split = appendNode(m, merge.id, { type: 'gateway', kind: 'parallel' })
  const c = appendNode(m, split.id, { type: 'task' }, 'Do C')
  const d = addNode(m, { type: 'task' }, { x: 700, y: 260 }, 'Do D')
  connect(m, split.id, d.id)
  const join = appendNode(m, c.id, { type: 'gateway', kind: 'parallel' })
  connect(m, d.id, join.id)
  appendNode(m, join.id, { type: 'event', position: 'end' }, 'Done')
  return m
}

const tag = (xml: string, id: string) => xml.match(new RegExp(`<bpmn:\\w+Gateway id="${id}"[^>]*>`))![0]
const shapeTag = (xml: string, id: string) => xml.match(new RegExp(`<bpmndi:BPMNShape id="${id}_di"[^>]*>`))![0]

describe('Bizagi export: gateways', () => {
  it('draws the X of an exclusive gateway, and only of that kind', async () => {
    const m = diamond()
    const xml = await writeBpmn(m)
    for (const n of m.nodes.filter((n) => n.type === 'gateway')) {
      const marker = shapeTag(xml, n.id).includes('isMarkerVisible="true"')
      expect(marker, n.id).toBe(n.type === 'gateway' && n.kind === 'exclusive')
    }
  })

  it('writes the direction Bizagi validates: split, merge, or nothing for a pass-through', async () => {
    const m = diamond()
    const xml = await writeBpmn(m)
    const dirs = m.nodes.filter((n) => n.type === 'gateway').map((n) => /gatewayDirection="(\w+)"/.exec(tag(xml, n.id))?.[1])
    expect(dirs).toEqual(['Diverging', 'Converging', 'Diverging', 'Converging'])
  })

  it('a gateway with several flows in and out reads back as Mixed, and the file still round-trips', async () => {
    const m = diamond()
    const merge = m.nodes.filter((n) => n.type === 'gateway')[1]
    const c = m.nodes.find((n) => n.name === 'Do C')!
    connect(m, merge.id, c.id)
    const xml = await writeBpmn(m)
    expect(tag(xml, merge.id)).toContain('gatewayDirection="Mixed"')
    const back = await readBpmn(xml)
    expect(back.model.flows.length).toBe(m.flows.length)
    expect(back.model.nodes.map((n) => n.id).sort()).toEqual(m.nodes.map((n) => n.id).sort())
  })

  it('P21: a gateway with one way in and one way out neither splits nor joins', () => {
    const m = emptyModel('Pass')
    const s = addNode(m, { type: 'event', position: 'start' }, { x: 100, y: 100 }, 'Start')
    const g = appendNode(m, s.id, { type: 'gateway', kind: 'exclusive' })
    const t = appendNode(m, g.id, { type: 'task' }, 'Do A')
    appendNode(m, t.id, { type: 'event', position: 'end' }, 'Done')
    const hits = lintModel(m).filter((i) => i.rule === 'P21')
    expect(hits).toHaveLength(1)
    expect(hits[0].elements).toEqual([g.id])
    expect(lintModel(diamond()).filter((i) => i.rule === 'P21')).toEqual([])
  })
})

describe('Bizagi entry sheet', () => {
  it('converts a time to minutes and a triangular one to Most likely / Min / Max', () => {
    expect(bizagiTime(1, undefined, 'h')).toMatchObject({ dist: 'Constant', value: 60 })
    expect(bizagiTime(2, { kind: 'triangular', min: 0.5, mode: 1, max: 2 }, 'h')).toMatchObject({ dist: 'Triangular', likely: 60, min: 30, max: 120 })
    expect(bizagiTime(1, { kind: 'uniform', min: 1, max: 2 }, 'd')).toMatchObject({ dist: 'Uniform', min: 1440, max: 2880 })
    expect(bizagiTime(30, { kind: 'normal', sd: 5 }, 'min')).toMatchObject({ dist: 'Normal', value: 30, sd: 5 })
    expect(bizagiTime(undefined, undefined, 'h')).toBeUndefined()
  })

  it('lists levels 1 to 3 in Bizagi units and order', () => {
    const m = diamond()
    m.sim = { unit: 'h', arrivals: 1 / 168, cases: 200 }
    const task = m.nodes.find((n) => n.name === 'Do A')!
    task.sim = { duration: 1, durationShape: { kind: 'triangular', min: 0.5, mode: 1, max: 2 } }
    const xor = m.nodes.find((n) => n.type === 'gateway')!
    for (const f of m.flows.filter((f) => f.source === xor.id)) f.probability = f.target === task.id ? 0.9 : 0.1
    const { sheets, rows } = bizagiSheet(m)
    const body = sheets[0].rows
    const text = JSON.stringify(body)
    expect(rows).toBeGreaterThan(0)
    expect(text).toContain('Interval between arrivals')
    const interval = body.find((r) => r[3] === 'Interval between arrivals')!
    expect(interval[5]).toBe(10080) // one week, as Bizagi wants it
    const arrivalsCount = body.find((r) => r[3] === 'Trigger counter (Max. arrival count)')!
    expect(arrivalsCount[5]).toBe(200)
    const time = body.find((r) => r[3] === 'Processing time')!
    expect(time.slice(4, 10)).toEqual(['Triangular', null, 60, 30, 120, null]) // Most likely, Min, Max
    const shares = body.filter((r) => typeof r[3] === 'string' && (r[3] as string).startsWith('Share of the flow')).map((r) => r[5])
    expect(shares.sort()).toEqual([10, 90])
  })

  it('says so when Flow holds no figures', () => {
    const { sheets, rows } = bizagiSheet(diamond())
    expect(rows).toBe(0)
    expect(JSON.stringify(sheets[0].rows)).toContain('no simulation figures')
  })

  it('lists one resource per lane with its people', () => {
    const m = emptyModel('Lanes')
    const pool = addPool(m, { x: 0, y: 0 }, 'Team')
    const lane = addLane(m, pool.id, 'Clerk')
    lane.capacity = 3
    m.sim = { unit: 'min', arrivals: 1 }
    const { sheets } = bizagiSheet(m)
    const row = sheets[0].rows.find((r) => r[0] === '3 Resources')!
    expect(row[2]).toBe('Clerk')
    expect(row[5]).toBe(3)
  })
})

describe('Bizagi simulation copy', () => {
  /** start → Ask → event gateway → (timer wait | message wait) → end; a boundary timer on Ask. */
  function waits(): FlowModel {
    const m = emptyModel('Waits')
    const s = addNode(m, { type: 'event', position: 'start' }, { x: 100, y: 100 }, 'Start')
    const ask = appendNode(m, s.id, { type: 'task' }, 'Ask')
    const g = appendNode(m, ask.id, { type: 'gateway', kind: 'eventBased' })
    const timer = appendNode(m, g.id, { type: 'event', position: 'intermediate', trigger: 'timer' }, 'Next day')
    const reply = addNode(m, { type: 'event', position: 'intermediate', trigger: 'message' }, { x: 500, y: 260 }, 'Reply')
    connect(m, g.id, reply.id)
    const end = appendNode(m, timer.id, { type: 'event', position: 'end' }, 'Done')
    connect(m, reply.id, end.id)
    timer.sim = { wait: 24 }
    reply.sim = { wait: 13, waitShape: { kind: 'triangular', min: 4, mode: 12, max: 24 } }
    return m
  }

  it('draws a waiting event as an activity that takes the wait as its time, and the event gateway as XOR', async () => {
    const m = waits()
    const { model, waits: w, gateways } = forBizagiSimulation(m)
    expect(w).toHaveLength(2)
    expect(gateways).toHaveLength(1)
    const reply = model.nodes.find((n) => n.name === 'Reply')!
    expect(reply).toMatchObject({ type: 'task', kind: 'task' })
    expect(reply.sim).toMatchObject({ duration: 13, durationShape: { kind: 'triangular', mode: 12 } })
    expect(reply.sim).not.toHaveProperty('wait')
    expect(model.nodes.find((n) => n.name === 'Next day')).toMatchObject({ type: 'task', kind: 'task', sim: { duration: 24 } })
    expect(model.nodes.find((n) => n.type === 'gateway')).toMatchObject({ kind: 'exclusive' })
    expect(model.flows).toHaveLength(m.flows.length)
    // the export carries no catch event after the gateway and no event-based gateway
    const xml = await writeBpmn(model)
    expect(xml).not.toContain('IntermediateCatchEvent')
    expect(xml).not.toContain('intermediateCatchEvent')
    expect(xml).not.toContain('eventBasedGateway')
    expect((await readBpmn(xml)).model.flows).toHaveLength(m.flows.length)
  })

  it('leaves the model alone and keeps events that do not wait', () => {
    const m = waits()
    const before = JSON.stringify(m)
    const copy = forBizagiSimulation(m)
    expect(JSON.stringify(m)).toBe(before)
    expect(copy.model.nodes.filter((n) => n.type === 'event').map((n) => n.name)).toEqual(['Start', 'Done'])
    const plain = forBizagiSimulation(diamond())
    expect(plain.waits).toEqual([])
    expect(plain.gateways).toEqual([])
  })

  it('the numbers sheet of the copy lists the wait as the time of the activity', () => {
    const { model } = forBizagiSimulation(waits())
    model.sim = { unit: 'h', arrivals: 1 }
    const rows = bizagiSheet(model).sheets[0].rows
    const time = rows.filter((r) => r[3] === 'Processing time')
    expect(time.map((r) => r[2]).sort()).toEqual(['Next day', 'Reply'])
    expect(time.find((r) => r[2] === 'Reply')!.slice(4, 10)).toEqual(['Triangular', null, 720, 240, 1440, null])
  })
  it('leaves the names of sequence flows out of the copy (a named flow after a gateway fails in Bizagi), not the gateway question', async () => {
    const m = diamond()
    const g = m.nodes.find((n) => n.type === 'gateway')!
    g.name = 'Behind the schedule?'
    const named = m.flows.filter((f) => f.kind === 'sequence' && f.source === g.id)
    named[0].name = 'Yes'
    named[1].name = 'No'
    named[0].labelOffset = { dx: 4, dy: 4 }
    const before = JSON.stringify(m)
    const copy = forBizagiSimulation(m)
    expect(copy.droppedNames).toBe(2)
    expect(copy.model.flows.filter((f) => f.kind === 'sequence').every((f) => !f.name)).toBe(true)
    expect(copy.model.nodes.find((n) => n.id === g.id)!.name).toBe('Behind the schedule?')
    expect(JSON.stringify(m)).toBe(before)
    const xml = await writeBpmn(copy.model)
    expect(xml).toContain('Behind the schedule?')
    expect(xml).not.toMatch(/<bpmn:sequenceFlow [^>]*name="(Yes|No)"/)
    expect(forBizagiSimulation(diamond()).droppedNames).toBe(0)
  })

  it('the numbers sheet keeps the flow names ("Yes") although the copy dropped them, and says how long to run', () => {
    const m = diamond()
    m.sim = { unit: 'h', arrivals: 1 / 168, cases: 200 }
    const xor = m.nodes.find((n) => n.type === 'gateway')!
    const outs = m.flows.filter((f) => f.source === xor.id)
    outs[0].name = 'Yes'
    outs[0].probability = 0.9
    outs[1].probability = 0.1
    const copy = forBizagiSimulation(m).model
    expect(copy.flows.find((f) => f.id === outs[0].id)!.name).toBe('')
    restoreFlowNames(copy, m)
    expect(copy.flows.find((f) => f.id === outs[0].id)!.name).toBe('Yes')
    const rows = bizagiSheet(copy).sheets[0].rows
    expect(rows.find((r) => typeof r[3] === 'string' && (r[3] as string).includes('(Yes)'))).toBeTruthy()
    expect(JSON.stringify(rows)).toContain('Scenario duration: 200 cases')
    expect(JSON.stringify(rows)).toContain('1400 days')
  })

  it('lists the dropped flow names on a sheet of their own, for typing them into Bizagi by hand', () => {
    const m = diamond()
    const xor = m.nodes.find((n) => n.type === 'gateway')!
    xor.name = 'Ready?'
    const outs = m.flows.filter((f) => f.source === xor.id)
    outs[0].name = 'Yes'
    outs[1].name = 'No'
    const copy = forBizagiSimulation(m).model
    const sheet = flowLabelsSheet(m, copy)!
    expect(sheet.name).toBe('Labels to add')
    const body = sheet.rows.slice(4)
    expect(body).toHaveLength(2)
    expect(body.map((r) => r[3]).sort()).toEqual(['No', 'Yes'])
    expect(body.every((r) => r[1] === 'Ready?')).toBe(true)
    expect(flowLabelsSheet(diamond(), forBizagiSimulation(diamond()).model)).toBeUndefined()
  })

  /** start → XOR → (A → end 1 | B → end 2 | end 3 directly); a second XOR with one end of its own. */
  function threeEnds(): FlowModel {
    const m = emptyModel('Ends')
    const s = addNode(m, { type: 'event', position: 'start' }, { x: 100, y: 100 }, 'Start')
    const x = appendNode(m, s.id, { type: 'gateway', kind: 'exclusive' })
    const a = appendNode(m, x.id, { type: 'task' }, 'A')
    const b = addNode(m, { type: 'task' }, { x: 400, y: 260 }, 'B')
    connect(m, x.id, b.id)
    appendNode(m, a.id, { type: 'event', position: 'end' }, 'End 1')
    appendNode(m, b.id, { type: 'event', position: 'end' }, 'End 2')
    const e3 = addNode(m, { type: 'event', position: 'end' }, { x: 500, y: 400 }, 'End 3')
    connect(m, x.id, e3.id)
    return m
  }

  it('lets the branches of one exclusive gateway finish in one end event (Bizagi fails on several)', async () => {
    const m = threeEnds()
    const copy = forBizagiSimulation(m)
    const ends = copy.model.nodes.filter((n) => n.type === 'event' && n.position === 'end')
    expect(ends).toHaveLength(1)
    expect(copy.mergedEnds).toHaveLength(2)
    expect(copy.model.flows).toHaveLength(m.flows.length)
    expect(copy.model.flows.filter((f) => f.target === ends[0].id)).toHaveLength(3)
    expect(Object.keys(copy.model.diagram.shapes)).not.toContain(copy.mergedEnds[0])
    const xml = await writeBpmn(copy.model)
    expect((xml.match(/<bpmn:endEvent /g) ?? []).length).toBe(1)
    expect(m.nodes.filter((n) => n.type === 'event' && n.position === 'end')).toHaveLength(3)
  })

  it('keeps ends that are not siblings of one exclusive gateway', () => {
    const copy = forBizagiSimulation(diamond())
    expect(copy.mergedEnds).toEqual([])
    const m = emptyModel('Par')
    const s = addNode(m, { type: 'event', position: 'start' }, { x: 100, y: 100 }, 'Start')
    const p = appendNode(m, s.id, { type: 'gateway', kind: 'parallel' })
    appendNode(m, p.id, { type: 'event', position: 'end' }, 'End 1')
    const e2 = addNode(m, { type: 'event', position: 'end' }, { x: 500, y: 300 }, 'End 2')
    connect(m, p.id, e2.id)
    expect(forBizagiSimulation(m).model.nodes.filter((n) => n.type === 'event' && n.position === 'end')).toHaveLength(2)
  })
})
