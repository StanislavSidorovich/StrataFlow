// What Bizagi needs from our .bpmn (v0.19.1): the X of an exclusive gateway, the gateway direction its validation
// reads, a Check rule for the gateway Bizagi refuses, and the sheet of figures to type into Simulation View
// (Bizagi does not read Flow's sf: figures). Generic models only: nothing from a real project.
import { describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import { lintModel } from '../src/core/lint'
import { addLane, addNode, addPool, appendNode, connect } from '../src/core/ops'
import { readBpmn } from '../src/core/bpmn/read'
import { writeBpmn } from '../src/core/bpmn/write'
import { bizagiSheet, bizagiTime } from '../src/core/bizagiSheet'

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
