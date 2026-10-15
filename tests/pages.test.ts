// Collapsed sub-processes as pages of their own (as in Bizagi: Edit Sub-Process opens its diagram):
// collapse / expand, drawing on a page, grouping into a collapsed sub-process, and the BPMN export that
// Bizagi opened with the sub-process on a tab of its own (owner's check, 2026-10-15).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BpmnModdle } from 'bpmn-moddle'
import type { FlowModel } from '../src/core/metamodel'
import { addBoundaryEvent, addNode, appendNode, groupIntoSubprocess, nodeOf, pageOf, setCollapsed, ungroupSubprocess } from '../src/core/ops'
import { readBpmn } from '../src/core/bpmn/read'
import { writeBpmn } from '../src/core/bpmn/write'
import { parseModel } from '../src/core/serialize'

const example = () => parseModel(readFileSync('src/data/examples/library-loan.flow.json', 'utf8'))
/** Fetch book and Lend book grouped and collapsed, as the Group button does. */
function grouped() {
  const m = example()
  const sp = groupIntoSubprocess(m, ['Task_fetch', 'Task_lend'], { name: 'Get the book' })
  setCollapsed(m, sp.id, true)
  return { m, sp: nodeOf(m, sp.id)! }
}
const paths = (m: FlowModel) =>
  m.flows
    .filter((f) => f.kind === 'sequence')
    .map((f) => `${f.source}>${f.target}`)
    .sort()

describe('collapsed sub-process pages', () => {
  it('grouping takes the data linked only to the grouped steps along', () => {
    const { m, sp } = grouped()
    expect(nodeOf(m, 'DataRef_slip')?.parentId).toBe(sp.id)
    expect(pageOf(m, 'DataRef_slip')).toBe(sp.id)
    expect(pageOf(m, 'Task_fetch')).toBe(sp.id)
  })

  it('collapsing gives the width back: what came after moves left; expanding pushes it right again', () => {
    const m = example()
    const sp = groupIntoSubprocess(m, ['Task_fetch', 'Task_lend'], { name: 'Get the book' })
    const wide = { ...m.diagram.shapes[sp.id] }
    const timer = m.diagram.shapes.Timer_due.x
    setCollapsed(m, sp.id, true)
    expect(m.diagram.shapes[sp.id]).toMatchObject({ x: wide.x, width: 100, height: 80 })
    expect(m.diagram.shapes.Timer_due.x).toBe(timer - (wide.width - 100))
    // The steps stay in the sub-process, where they were drawn.
    expect(nodeOf(m, 'Task_fetch')).toMatchObject({ parentId: sp.id, participantId: 'Participant_library' })

    setCollapsed(m, sp.id, false)
    const s = m.diagram.shapes[sp.id]
    expect(s.width).toBe(wide.width)
    expect(m.diagram.shapes.Timer_due.x).toBe(timer)
    for (const id of ['Task_fetch', 'Task_lend']) {
      const b = m.diagram.shapes[id]
      expect(b.x >= s.x && b.x + b.width <= s.x + s.width && b.y >= s.y && b.y + b.height <= s.y + s.height, id).toBe(true)
      expect(nodeOf(m, id)?.parentId).toBe(sp.id)
    }
  })

  it('a collapsed sub-process moved elsewhere opens round its steps where it now is', () => {
    const { m, sp } = grouped()
    const s = m.diagram.shapes[sp.id]
    s.y += 300 // drawn somewhere else, its steps left where they were
    setCollapsed(m, sp.id, false)
    const b = m.diagram.shapes.Task_fetch
    expect(b.y).toBeGreaterThan(s.y)
    expect(b.y + b.height).toBeLessThan(s.y + s.height)
  })

  it('drawing on a page: new steps belong to the sub-process, whatever main-canvas shape sits under them', () => {
    const { m, sp } = grouped()
    // A point on the page that is inside the Library pool on the main canvas.
    const t = addNode(m, { type: 'task' }, { x: 200, y: 100 }, 'Stamp card', sp.id)
    expect(nodeOf(m, t.id)).toMatchObject({ parentId: sp.id, participantId: 'Participant_library' })
    const next = appendNode(m, 'Task_lend', { type: 'task' }, 'Record loan')
    expect(nodeOf(m, next.id)?.parentId).toBe(sp.id)
    expect(pageOf(m, next.id)).toBe(sp.id)
    const late = addBoundaryEvent(m, next.id, 'timer')
    expect(pageOf(m, late.id)).toBe(sp.id)
    expect(() => addNode(m, { type: 'task' }, { x: 0, y: 0 }, '', 'Task_check')).toThrow(/not a collapsed sub-process/)
  })

  it('grouping on a page makes a sub-process inside it; the main canvas does not move', () => {
    const { m, sp } = grouped()
    const before = JSON.stringify({ sp: m.diagram.shapes[sp.id], pool: m.diagram.shapes.Participant_library, timer: m.diagram.shapes.Timer_due })
    const inner = groupIntoSubprocess(m, ['Task_lend'], { name: 'Hand over' })
    expect(nodeOf(m, inner.id)).toMatchObject({ parentId: sp.id, participantId: 'Participant_library' })
    expect(nodeOf(m, 'Task_lend')?.parentId).toBe(inner.id)
    expect(pageOf(m, 'Task_lend')).toBe(sp.id)
    for (const n of m.nodes.filter((x) => x.parentId === inner.id)) expect(n.participantId).toBe('Participant_library')
    expect(JSON.stringify({ sp: m.diagram.shapes[sp.id], pool: m.diagram.shapes.Participant_library, timer: m.diagram.shapes.Timer_due })).toBe(before)
    setCollapsed(m, inner.id, true)
    expect(pageOf(m, 'Task_lend')).toBe(inner.id)
  })

  it('exports as Bizagi opened it: the sub-process collapsed, its steps and data in a diagram of their own', async () => {
    const { m, sp } = grouped()
    const xml = await writeBpmn(m)
    const defs: any = (await new BpmnModdle().fromXML(xml)).rootElement
    const planes = defs.diagrams.map((d: any) => d.plane)
    const page = planes.find((p: any) => p.bpmnElement?.id === sp.id)
    const ids = page.planeElement.map((e: any) => e.bpmnElement?.id)
    expect(ids).toEqual(expect.arrayContaining(['Task_fetch', 'Task_lend', 'DataRef_slip']))
    const main = planes.find((p: any) => p.bpmnElement?.$type === 'bpmn:Collaboration')
    expect(main.planeElement.find((e: any) => e.bpmnElement?.id === sp.id)?.isExpanded).toBe(false)
    expect(main.planeElement.some((e: any) => e.bpmnElement?.id === 'DataRef_slip')).toBe(false)
    // And it reads back the same.
    const { model } = await readBpmn(xml)
    expect(paths(model)).toEqual(paths(m))
    expect(model.nodes.filter((n) => n.parentId === sp.id).map((n) => n.id).sort()).toEqual(m.nodes.filter((n) => n.parentId === sp.id).map((n) => n.id).sort())
  })

  it('ungrouping a collapsed sub-process brings its steps back to the process', () => {
    const { m, sp } = grouped()
    const before = paths(example())
    ungroupSubprocess(m, sp.id)
    expect(paths(m)).toEqual(before)
    expect(m.nodes.some((n) => n.parentId)).toBe(false)
  })
})
