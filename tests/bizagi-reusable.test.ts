// Bizagi's reusable sub-processes (course practice, Chapter 3 exercise 3.4): a call activity per sub-process, its
// page a process in a file of its own with the same pool and only the sub-process's lane. Written and read back.
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readProject, splitReusable, writeReusable } from '../src/core/bpmn/reusable'
import { lintModel } from '../src/core/lint'
import { parseModel } from '../src/core/serialize'
import { isZip, readZip, writeZip } from '../src/core/zip'

const sh = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const ev = (id: string, position: 'start' | 'end', laneId: string, parentId?: string) => ({ id, name: id, participantId: 'P', laneId, type: 'event', position, trigger: 'none', throwing: position === 'end', ...(parentId ? { parentId } : {}) })
const task = (id: string, laneId: string, parentId?: string) => ({ id, name: `Check ${id}`, participantId: 'P', laneId, type: 'task', kind: 'user', ...(parentId ? { parentId } : {}) })
const f = (id: string, source: string, target: string, kind = 'sequence') => ({ id, kind, source, target, name: '' })

/**
 * Start → Settlement → End in the Handler lane. Settlement's page: start → Approve → Payment (nested) → end, and
 * Approve sends a message to the Customer (black box). Payment's page: start → Pay (Finance lane) → end.
 */
const model = () =>
  parseModel(
    JSON.stringify({
      format: 'strata-flow',
      version: 1,
      name: 'Claim',
      participants: [
        { id: 'P', name: 'Claim process', processId: 'Process_1' },
        { id: 'C', name: 'Customer' },
      ],
      lanes: [
        { id: 'L1', name: 'Handler', participantId: 'P' },
        { id: 'L2', name: 'Finance', participantId: 'P' },
      ],
      nodes: [
        ev('Start', 'start', 'L1'),
        { id: 'Sub', name: 'Settlement', participantId: 'P', laneId: 'L1', type: 'subProcess', collapsed: true },
        ev('End', 'end', 'L1'),
        ev('SubStart', 'start', 'L1', 'Sub'),
        task('Approve', 'L1', 'Sub'),
        { id: 'Inner', name: 'Payment', participantId: 'P', laneId: 'L1', type: 'subProcess', collapsed: true, parentId: 'Sub' },
        ev('SubEnd', 'end', 'L1', 'Sub'),
        ev('InStart', 'start', 'L1', 'Inner'),
        task('Pay', 'L2', 'Inner'),
        ev('InEnd', 'end', 'L1', 'Inner'),
      ],
      flows: [
        f('F1', 'Start', 'Sub'),
        f('F2', 'Sub', 'End'),
        f('F3', 'SubStart', 'Approve'),
        f('F4', 'Approve', 'Inner'),
        f('F5', 'Inner', 'SubEnd'),
        f('F6', 'InStart', 'Pay'),
        f('F7', 'Pay', 'InEnd'),
        f('M1', 'Approve', 'C', 'message'),
      ],
      diagram: {
        shapes: {
          P: sh(20, 50, 900, 400),
          L1: sh(50, 50, 870, 200),
          L2: sh(50, 250, 870, 200),
          C: sh(20, 500, 900, 80),
          Start: sh(80, 130, 36, 36),
          Sub: sh(200, 113, 100, 70),
          End: sh(400, 130, 36, 36),
          SubStart: sh(100, 117, 36, 36),
          Approve: sh(200, 100, 100, 70),
          Inner: sh(350, 100, 100, 70),
          SubEnd: sh(500, 117, 36, 36),
          InStart: sh(100, 117, 36, 36),
          Pay: sh(200, 100, 100, 70),
          InEnd: sh(350, 117, 36, 36),
        },
        edges: {},
      },
    }),
  )

describe('splitReusable', () => {
  it('makes a main sheet and a page per sub-process, each page one pool with the sub-process lane', () => {
    const m = model()
    const before = JSON.stringify(m)
    const { parts, calls, moved } = splitReusable(m)
    expect(JSON.stringify(m)).toBe(before)
    expect(parts.map((p) => p.model.name)).toEqual(['Claim', 'Settlement', 'Payment'])
    expect(Object.keys(calls)).toEqual(['Sub', 'Inner'])
    const [main, settle, pay] = parts.map((p) => p.model)
    expect(main.nodes.map((n) => n.id)).toEqual(['Start', 'Sub', 'End'])
    // The message of a step inside is drawn on its page only, not a second time to the box.
    expect(main.flows.some((x) => x.kind === 'message')).toBe(false)
    // Settlement's page: the same pool name, only the Handler lane, the Customer as a black box.
    expect(settle.participants.map((p) => p.name)).toEqual(['Claim process', 'Customer'])
    expect(settle.participants[0].processId).toBe(calls.Sub)
    expect(settle.participants[1].processId).toBeUndefined()
    expect(settle.lanes.map((l) => l.name)).toEqual(['Handler'])
    expect(settle.nodes.map((n) => n.id)).toEqual(['SubStart', 'Approve', 'Inner', 'SubEnd'])
    expect(settle.nodes.every((n) => n.participantId === settle.participants[0].id && n.laneId === settle.lanes[0].id && !n.parentId)).toBe(true)
    expect(settle.flows.filter((x) => x.kind === 'message')).toEqual([expect.objectContaining({ source: 'Approve', target: settle.participants[1].id })])
    // The pool holds its steps.
    const pool = settle.diagram.shapes[settle.participants[0].id]
    for (const n of settle.nodes) {
      const b = settle.diagram.shapes[n.id]
      expect(b.x).toBeGreaterThan(pool.x)
      expect(b.y + b.height).toBeLessThan(pool.y + pool.height)
    }
    // Pay sits in Finance, the page's start and end in Handler: the page has both lanes, each step in its own.
    expect(pay.lanes.map((l) => l.name)).toEqual(['Handler', 'Finance'])
    const lane = (id: string) => pay.lanes.find((l) => l.id === pay.nodes.find((n) => n.id === id)?.laneId)?.name
    expect([lane('InStart'), lane('Pay'), lane('InEnd')]).toEqual(['Handler', 'Finance', 'Handler'])
    expect(moved).toBe(0)
    // The lanes are bands one below the other, the pool round them, every step inside its band.
    const [a, b] = pay.lanes.map((l) => pay.diagram.shapes[l.id])
    expect(b.y).toBeCloseTo(a.y + a.height)
    const poolBox = pay.diagram.shapes[pay.participants[0].id]
    expect(poolBox.height).toBeCloseTo(a.height + b.height)
    for (const n of pay.nodes) {
      const box = pay.diagram.shapes[n.id]
      const band = pay.diagram.shapes[n.laneId!]
      expect(box.y, n.id).toBeGreaterThanOrEqual(band.y)
      expect(box.y + box.height, n.id).toBeLessThanOrEqual(band.y + band.height)
    }
    // A flow between two bands is routed again by the writer, not drawn through the old place.
    expect(pay.diagram.edges.F6).toBeUndefined()
  })

  it('writes call activities that call the page processes, one file per page', async () => {
    const { files, split } = await writeReusable(model())
    expect(files.map((x) => x.name)).toEqual(['Diagram 1 - Claim.bpmn', 'Diagram 2 - Settlement.bpmn', 'Diagram 3 - Payment.bpmn'])
    expect(files[0].xml).toMatch(new RegExp(`<bpmn:callActivity id="Sub" name="Settlement" calledElement="${split.calls.Sub}"`))
    expect(files[0].xml).not.toContain('Approve')
    expect(files[1].xml).toContain(`<bpmn:process id="${split.calls.Sub}" name="Claim process"`)
    expect(files[1].xml).toMatch(new RegExp(`<bpmn:callActivity id="Inner" name="Payment" calledElement="${split.calls.Inner}"`))
    expect(files[2].xml).toContain(`<bpmn:process id="${split.calls.Inner}"`)
    // The ids the writer makes up differ between the files.
    const defs = files.map((x) => x.xml.match(/<bpmn:definitions [^>]*id="([^"]+)"/)![1])
    expect(new Set(defs).size).toBe(3)
  })
})

describe('Bizagi guid ids', () => {
  // Bizagi reads every id starting with "Id_" as a GUID: on a page file "Id_<guid>_process" fails to import.
  const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  const exact = new RegExp(`^Id_${GUID}(_di)?$`)
  const guidModel = () => {
    const ids = new Map<string, string>()
    let n = 0
    const swap = (s: string) => {
      const hex = (++n).toString(16).padStart(12, '0')
      ids.set(s, `Id_aaaaaaaa-bbbb-4ccc-8ddd-${hex}`)
    }
    const raw = JSON.parse(JSON.stringify(model()))
    for (const x of [...raw.participants, ...raw.lanes, ...raw.nodes, ...raw.flows]) swap(x.id)
    const text = JSON.stringify(raw).replace(/"([A-Za-z0-9_]+)"/g, (all, s) => (ids.has(s) ? `"${ids.get(s)}"` : all))
    return parseModel(text)
  }

  it('writes page files with exact guid ids only', async () => {
    const { files, split } = await writeReusable(guidModel())
    for (const p of split.parts.slice(1)) expect(p.processId).toMatch(exact)
    for (const file of files.slice(1)) {
      const ids = [...file.xml.matchAll(/\b(?:id|bpmnElement|processRef|calledElement|sourceRef|targetRef)="([^"]+)"/g)].map((x) => x[1])
      const guids = ids.filter((x) => x.startsWith('Id_'))
      expect(guids.length).toBeGreaterThan(10)
      for (const id of guids) expect(id, id).toMatch(exact)
      expect(file.xml).not.toMatch(/MF_|Pool_PH|Id_[0-9a-f-]{36}_(process|pool|lane|store|line)/)
    }
    expect(files[0].xml).toContain(`calledElement="${split.calls[Object.keys(split.calls)[0]]}"`)
    expect(files[1].xml).toContain(`<bpmn:process id="${split.calls[Object.keys(split.calls)[0]]}"`)
  })

  it('gives the same ids for the same model, all different from each other', async () => {
    const a = await writeReusable(guidModel())
    const b = await writeReusable(guidModel())
    expect(a.files.map((x) => x.xml)).toEqual(b.files.map((x) => x.xml))
    for (const file of a.files.slice(1)) {
      const ids = [...file.xml.matchAll(/<bpmn:\w+ [^>]*?\bid="([^"]+)"/g)].map((x) => x[1])
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('reads the guid project back with its pages', async () => {
    const { files } = await writeReusable(guidModel())
    const { model: back, pages, warnings } = await readProject(files.map((x) => ({ name: x.name, text: x.xml })))
    expect(pages).toBe(2)
    expect(warnings).toEqual([])
    expect(back.nodes.filter((n) => n.type === 'subProcess').length).toBe(2)
    expect(back.nodes.length).toBe(guidModel().nodes.length)
  })
})

describe('readProject', () => {
  const texts = async () => (await writeReusable(model())).files.map((x) => ({ name: x.name, text: x.xml }))

  it('reads the files back into one model with pages', async () => {
    const { model: back, warnings, pages } = await readProject(await texts())
    expect(pages).toBe(2)
    expect(warnings).toEqual([])
    const node = (id: string) => back.nodes.find((n) => n.id === id)
    expect(node('Sub')).toMatchObject({ type: 'subProcess', collapsed: true, laneId: 'L1', participantId: 'P' })
    expect(node('Inner')).toMatchObject({ type: 'subProcess', collapsed: true, parentId: 'Sub' })
    expect(node('Approve')).toMatchObject({ parentId: 'Sub', participantId: 'P', laneId: 'L1' })
    expect(node('Pay')).toMatchObject({ parentId: 'Inner', participantId: 'P', laneId: 'L2' })
    expect(back.nodes.map((n) => n.id).sort()).toEqual(model().nodes.map((n) => n.id).sort())
    expect(back.flows.filter((x) => x.kind === 'sequence').map((x) => x.id).sort()).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'])
    // One message, from the step itself (the main sheet's copy to the box is dropped).
    expect(back.flows.filter((x) => x.kind === 'message')).toEqual([expect.objectContaining({ source: 'Approve', target: 'C' })])
    for (const n of back.nodes) expect(back.diagram.shapes[n.id], n.id).toBeDefined()
    expect(lintModel(back).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('finds the main file in any order', async () => {
    const files = (await texts()).reverse()
    const { model: back } = await readProject(files)
    expect(back.name).toBe('Claim')
    expect(back.nodes.find((n) => n.id === 'Sub')?.type).toBe('subProcess')
  })

  it('keeps a call activity whose page is missing as a task, with a warning', async () => {
    const [main, settle] = await texts()
    const { model: back, warnings } = await readProject([main, settle])
    expect(back.nodes.find((n) => n.id === 'Sub')?.type).toBe('subProcess')
    expect(back.nodes.find((n) => n.id === 'Inner')).toMatchObject({ type: 'task', parentId: 'Sub' })
    expect(warnings).toEqual([expect.stringContaining('"Payment" is not among the files')])
  })

  it('says which lanes of a page are not in the main pool', async () => {
    const files = await texts()
    files[1].text = files[1].text.replace('name="Handler"', 'name="Claim handler"')
    const { model: back, warnings } = await readProject(files)
    expect(back.nodes.find((n) => n.id === 'Approve')?.laneId).toBe('L1')
    expect(warnings).toEqual([expect.stringContaining('lane "Claim handler" not in the main pool')])
  })

  it('warns about a file nobody calls', async () => {
    const files = await texts()
    const extra = (await writeReusable({ ...model(), name: 'Other' })).files[0]
    const { warnings } = await readProject([...files, { name: 'zz.bpmn', text: extra.xml.replace(/Sub_process/g, 'Other_process').replace(/id="P"/g, 'id="P9"') }])
    expect(warnings).toEqual([expect.stringContaining('zz.bpmn is not called')])
  })
})

describe('zip', () => {
  it('reads back what it writes', async () => {
    const enc = new TextEncoder()
    const data = writeZip([
      { name: 'Diagram 1 - Claim.bpmn', data: enc.encode('<a/>') },
      { name: 'Página 2.bpmn', data: enc.encode('<b>ü</b>') },
    ])
    expect(isZip(data)).toBe(true)
    const back = await readZip(data)
    expect(back.map((e) => e.name)).toEqual(['Diagram 1 - Claim.bpmn', 'Página 2.bpmn'])
    expect(new TextDecoder().decode(back[1].data)).toBe('<b>ü</b>')
  })

  it('reads a deflated entry (as Windows and Bizagi zip them)', async () => {
    const text = '<definitions>'.repeat(50)
    const plain = new TextEncoder().encode(text)
    const packed = new Uint8Array(deflateRawSync(plain))
    // A stored archive of the packed bytes, then marked as deflated with the real sizes.
    const zip = writeZip([{ name: 'a.bpmn', data: packed }])
    const v = new DataView(zip.buffer)
    v.setUint16(8, 8, true)
    v.setUint32(22, plain.length, true)
    const dir = 30 + 'a.bpmn'.length + packed.length
    v.setUint16(dir + 10, 8, true)
    v.setUint32(dir + 24, plain.length, true)
    const [e] = await readZip(zip)
    expect(new TextDecoder().decode(e.data)).toBe(text)
  })
})
