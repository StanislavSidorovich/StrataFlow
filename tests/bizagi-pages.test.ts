// The file for Bizagi: Bizagi draws an expanded sub-process as one huge box (owner's check, 2026-10-26, files V0, V3,
// V4), a collapsed one opens on a page of its own (V1). So the export collapses a copy in place.
import { describe, expect, it } from 'vitest'
import { collapseForBizagi } from '../src/core/bpmn/pages'
import { writeBpmn } from '../src/core/bpmn/write'
import { readBpmn } from '../src/core/bpmn/read'
import { parseModel } from '../src/core/serialize'
import { lintModel } from '../src/core/lint'

const sh = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const ev = (id: string, position: 'start' | 'end', laneId: string, parentId?: string) => ({ id, name: id, participantId: 'P', laneId, type: 'event', position, trigger: 'none', throwing: position === 'end', ...(parentId ? { parentId } : {}) })
const task = (id: string, laneId: string, parentId?: string) => ({ id, name: `Check ${id}`, participantId: 'P', laneId, type: 'task', kind: 'user', ...(parentId ? { parentId } : {}) })
const f = (id: string, source: string, target: string) => ({ id, kind: 'sequence', source, target, name: '' })

/** Start → Settlement (expanded, spans two lanes: start, Approve, Pay in the lower lane, end) → End. */
const model = () =>
  parseModel(
    JSON.stringify({
      format: 'strata-flow',
      version: 1,
      name: 'Claim',
      participants: [{ id: 'P', name: 'Claim process', processId: 'Process_1' }],
      lanes: [
        { id: 'L1', name: 'Handler', participantId: 'P' },
        { id: 'L2', name: 'Finance', participantId: 'P' },
      ],
      nodes: [
        ev('Start', 'start', 'L1'),
        { id: 'Sub', name: 'Settlement', participantId: 'P', laneId: 'L1', type: 'subProcess', collapsed: false },
        ev('SubStart', 'start', 'L1', 'Sub'),
        task('Approve', 'L1', 'Sub'),
        task('Pay', 'L2', 'Sub'),
        ev('SubEnd', 'end', 'L1', 'Sub'),
        ev('End', 'end', 'L1'),
      ],
      flows: [f('F1', 'Start', 'Sub'), f('F2', 'SubStart', 'Approve'), f('F3', 'Approve', 'Pay'), f('F4', 'Pay', 'SubEnd'), f('F5', 'Sub', 'End')],
      diagram: {
        shapes: {
          P: sh(20, 50, 1400, 500),
          L1: sh(50, 50, 1370, 200),
          L2: sh(50, 250, 1370, 300),
          Start: sh(80, 130, 36, 36),
          Sub: sh(200, 70, 900, 440),
          SubStart: sh(220, 130, 36, 36),
          Approve: sh(300, 113, 100, 70),
          Pay: sh(500, 380, 100, 70),
          SubEnd: sh(900, 130, 36, 36),
          End: sh(1200, 130, 36, 36),
        },
        edges: { F2: [{ x: 256, y: 148 }, { x: 300, y: 148 }], F5: [{ x: 1100, y: 148 }, { x: 1200, y: 148 }] },
      },
    }),
  )

describe('collapseForBizagi', () => {
  it('collapses an expanded sub-process in place, in its own lane, and leaves the model alone', () => {
    const m = model()
    const before = JSON.stringify(m)
    const { model: copy, collapsed } = collapseForBizagi(m)
    expect(collapsed).toBe(1)
    expect(JSON.stringify(m)).toBe(before)
    expect(copy.nodes.find((n) => n.id === 'Sub')).toMatchObject({ collapsed: true })
    const box = copy.diagram.shapes.Sub
    const lane = copy.diagram.shapes.L1
    expect(box.y).toBeGreaterThanOrEqual(lane.y)
    expect(box.y + box.height).toBeLessThanOrEqual(lane.y + lane.height)
    expect(box.width).toBeLessThan(200)
    // nothing moved, so nothing lands on the neighbours
    expect(copy.diagram.shapes.End).toEqual(m.diagram.shapes.End)
    expect(box.x + box.width).toBeLessThan(copy.diagram.shapes.End.x)
    // the flows at the old border are routed again; the steps keep their page
    expect(copy.diagram.edges.F5).toBeUndefined()
    expect(copy.diagram.edges.F2).toBeDefined()
    expect(copy.nodes.find((n) => n.id === 'Pay')?.parentId).toBe('Sub')
  })

  it('writes the steps on a page of their own and reads back collapsed', async () => {
    const xml = await writeBpmn(collapseForBizagi(model()).model)
    expect(xml).toContain('isExpanded="false"')
    expect(xml.match(/<bpmndi:BPMNDiagram /g)).toHaveLength(2)
    const back = (await readBpmn(xml)).model
    expect(back.nodes.find((n) => n.type === 'subProcess')).toMatchObject({ collapsed: true })
    expect(back.nodes.filter((n) => n.parentId)).toHaveLength(4)
  })

  it('a page of its own starts at the top left, its inner flows move with the steps', () => {
    const { model: m } = collapseForBizagi(model())
    const boxes = m.nodes.filter((n) => n.parentId === 'Sub').map((n) => m.diagram.shapes[n.id])
    expect(Math.min(...boxes.map((b) => b.x))).toBe(100)
    expect(Math.min(...boxes.map((b) => b.y))).toBe(100)
    // F2 ran from SubStart (right edge x 256) to Approve (x 300): the same 44 px after the move
    const [a, b] = m.diagram.edges.F2
    expect(b.x - a.x).toBe(44)
    expect(a.x).toBe(m.diagram.shapes.SubStart.x + 36)
  })

  it('a message flow to a step on a page ends at the sub-process box', () => {
    const src = model()
    src.nodes.push({ id: 'BankTask', name: 'Bank', participantId: 'Bank', type: 'task', kind: 'task' } as never)
    src.participants.push({ id: 'Bank', name: 'Bank' })
    src.diagram.shapes.Bank = sh(20, 600, 1400, 100)
    src.flows.push({ id: 'M1', kind: 'message', source: 'Pay', target: 'Bank', name: 'Payment' })
    src.diagram.edges.M1 = [{ x: 550, y: 450 }, { x: 550, y: 600 }]
    const { model: m } = collapseForBizagi(src)
    const mf = m.flows.find((f) => f.id === 'M1')!
    expect(mf.source).toBe('Sub')
    expect(m.diagram.edges.M1).toBeUndefined()
  })

  it('does nothing to a model without expanded sub-processes', () => {
    const m = collapseForBizagi(model()).model
    const again = collapseForBizagi(m)
    expect(again.collapsed).toBe(0)
    expect(again.model).toEqual(m)
  })

  it('the model itself is clean for the check (flows end at the border)', () => {
    expect(lintModel(model()).filter((i) => i.rule === 'P19')).toEqual([])
  })
})
