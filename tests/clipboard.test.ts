// Copy, cut, paste and duplicate (copyElements, pasteClip, pasteOffset in core/ops): new ids, the flows
// between the copied shapes, boundary events and sub-process content along, the lane kept when it fits.
import { describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import {
  addBoundaryEvent,
  addLane,
  addNode,
  addPool,
  connect,
  copyElements,
  deleteElements,
  ModelError,
  nodeOf,
  pasteClip,
  pasteOffset,
  setCollapsed,
  setDefaultFlow,
  groupIntoSubprocess,
} from '../src/core/ops'

/** A pool at 0,0 (800 × 400) with two lanes: Clerk 0–250, Manager 250–400, and three tasks in a row in Clerk. */
function threeInARow(): FlowModel {
  const m = emptyModel()
  addPool(m, { x: 0, y: 0 }, 'Office')
  addLane(m, 'Participant_1', 'Clerk')
  addLane(m, 'Participant_1', 'Manager')
  addNode(m, { type: 'task' }, { x: 150, y: 100 }, 'Receive')
  addNode(m, { type: 'task' }, { x: 300, y: 100 }, 'Check')
  addNode(m, { type: 'task' }, { x: 450, y: 100 }, 'File')
  connect(m, 'Task_1', 'Task_2')
  connect(m, 'Task_2', 'Task_3')
  return m
}

describe('copy', () => {
  it('takes the shapes and only the flows between them', () => {
    const m = threeInARow()
    const clip = copyElements(m, ['Task_1', 'Task_2'])!
    expect(clip.nodes.map((n) => n.id)).toEqual(['Task_1', 'Task_2'])
    expect(clip.flows.map((f) => f.id)).toEqual(['Flow_1'])
    expect(clip.shapes.Task_1).toEqual(m.diagram.shapes.Task_1)
  })

  it('leaves out pools, lanes, a lone flow and a boundary event without its task', () => {
    const m = threeInARow()
    addBoundaryEvent(m, 'Task_2')
    expect(copyElements(m, ['Participant_1', 'Lane_1', 'Flow_1', 'Event_1'])).toBeNull()
  })

  it('is a plain copy: changing the model later does not change the clip', () => {
    const m = threeInARow()
    const clip = copyElements(m, ['Task_1'])!
    m.diagram.shapes.Task_1.x = 999
    nodeOf(m, 'Task_1')!.name = 'Changed'
    expect(clip.shapes.Task_1.x).toBe(100)
    expect(clip.nodes[0].name).toBe('Receive')
  })
})

describe('paste', () => {
  it('three joined tasks come back with new ids, their two flows, shifted and in the same lane', () => {
    const m = threeInARow()
    const clip = copyElements(m, ['Task_1', 'Task_2', 'Task_3'])!
    const ids = pasteClip(m, clip, { offset: pasteOffset(m, clip) })
    expect(ids).toEqual(['Task_4', 'Task_5', 'Task_6'])
    expect(m.nodes.map((n) => n.name)).toEqual(['Receive', 'Check', 'File', 'Receive', 'Check', 'File'])
    expect(m.diagram.shapes.Task_4).toEqual({ ...m.diagram.shapes.Task_1, x: 124, y: 84 })
    for (const id of ids) expect(nodeOf(m, id)).toMatchObject({ participantId: 'Participant_1', laneId: 'Lane_1' })
    const pasted = m.flows.filter((f) => ids.includes(f.source))
    expect(pasted.map((f) => [f.id, f.source, f.target])).toEqual([
      ['Flow_3', 'Task_4', 'Task_5'],
      ['Flow_4', 'Task_5', 'Task_6'],
    ])
    expect(m.flows).toHaveLength(4)
  })

  it('a second paste lands one step further', () => {
    const m = threeInARow()
    const clip = copyElements(m, ['Task_1'])!
    pasteClip(m, clip, { offset: pasteOffset(m, clip, 1) })
    pasteClip(m, clip, { offset: pasteOffset(m, clip, 2) })
    expect(m.diagram.shapes.Task_4).toMatchObject({ x: 124, y: 84 })
    expect(m.diagram.shapes.Task_5).toMatchObject({ x: 148, y: 108 })
  })

  it('shifts only to the right when going down would leave the lane', () => {
    const m = threeInARow()
    addNode(m, { type: 'task' }, { x: 600, y: 235 }, 'Near the border') // centre 15 above Manager
    const clip = copyElements(m, ['Task_4'])!
    expect(pasteOffset(m, clip)).toEqual({ x: 24, y: 0 })
    const [id] = pasteClip(m, clip, { offset: pasteOffset(m, clip) })
    expect(nodeOf(m, id)!.laneId).toBe('Lane_1')
  })

  it('pasted at a point (another lane) is centred there and takes that lane', () => {
    const m = threeInARow()
    const clip = copyElements(m, ['Task_1', 'Task_2', 'Task_3'])!
    const ids = pasteClip(m, clip, { at: { x: 400, y: 325 } })
    for (const id of ids) expect(nodeOf(m, id)!.laneId).toBe('Lane_2')
    expect(m.diagram.shapes.Task_5).toMatchObject({ x: 350, y: 285 })
  })

  it('works into another model (another tab) with ids free there', () => {
    const a = threeInARow()
    const b = emptyModel()
    addNode(b, { type: 'task' }, { x: 0, y: 0 }, 'Already here')
    const ids = pasteClip(b, copyElements(a, ['Task_1', 'Task_2'])!)
    expect(ids).toEqual(['Task_2', 'Task_3'])
    expect(b.flows).toEqual([expect.objectContaining({ source: 'Task_2', target: 'Task_3', kind: 'sequence' })])
    expect(nodeOf(b, 'Task_2')!.participantId).toBeUndefined()
  })

  it('a boundary event goes with its task and its outgoing flow when the target is copied', () => {
    const m = threeInARow()
    const ev = addBoundaryEvent(m, 'Task_2')
    const late = addNode(m, { type: 'task' }, { x: 300, y: 200 }, 'Chase')
    connect(m, ev.id, late.id)
    const clip = copyElements(m, ['Task_2', late.id])!
    expect(clip.nodes.map((n) => n.id)).toEqual(['Task_2', 'Event_1', 'Task_4'])
    const ids = pasteClip(m, clip)
    expect(ids).toEqual(['Task_5', 'Task_6'])
    const copy = nodeOf(m, 'Event_2')!
    expect(copy).toMatchObject({ attachedTo: 'Task_5', position: 'boundary', laneId: 'Lane_1' })
    expect(m.diagram.shapes.Event_2.x - m.diagram.shapes.Event_1.x).toBe(24)
    expect(m.flows.some((f) => f.source === 'Event_2' && f.target === 'Task_6')).toBe(true)
  })

  it('a collapsed sub-process brings its page; the page content does not move', () => {
    const m = threeInARow()
    const sp = groupIntoSubprocess(m, ['Task_2'])
    setCollapsed(m, sp.id, true)
    const inner = m.nodes.filter((n) => n.parentId === sp.id)
    const clip = copyElements(m, [sp.id])!
    const [copy] = pasteClip(m, clip)
    const copied = m.nodes.filter((n) => n.parentId === copy)
    expect(copied.map((n) => n.name)).toEqual(inner.map((n) => n.name))
    for (const [i, n] of copied.entries()) expect(m.diagram.shapes[n.id]).toEqual(m.diagram.shapes[inner[i].id])
    expect(nodeOf(m, copy)).toMatchObject({ type: 'subProcess', collapsed: true, laneId: 'Lane_1' })
  })

  it('on a sub-process page the pasted shapes belong to that page', () => {
    const m = threeInARow()
    const sp = groupIntoSubprocess(m, ['Task_2'])
    setCollapsed(m, sp.id, true)
    const [id] = pasteClip(m, copyElements(m, ['Task_1'])!, { page: sp.id })
    expect(nodeOf(m, id)).toMatchObject({ parentId: sp.id, participantId: 'Participant_1' })
  })

  it('keeps a gateway default flow pointing at the pasted flow', () => {
    const m = threeInARow()
    const g = addNode(m, { type: 'gateway' }, { x: 600, y: 100 })
    const a = addNode(m, { type: 'task' }, { x: 700, y: 60 })
    const b = addNode(m, { type: 'task' }, { x: 700, y: 180 })
    connect(m, g.id, a.id)
    const def = connect(m, g.id, b.id)
    setDefaultFlow(m, def.id, true)
    pasteClip(m, copyElements(m, [g.id, a.id, b.id])!)
    const pasted = nodeOf(m, 'Gateway_2')!
    expect(pasted.type === 'gateway' && pasted.defaultFlow).toBe('Flow_6')
    expect(m.flows.find((f) => f.id === 'Flow_6')).toMatchObject({ source: 'Gateway_2', target: 'Task_7' })
  })

  it('cut = copy, then delete: the shapes and their flows go, a paste brings them back', () => {
    const m = threeInARow()
    const clip = copyElements(m, ['Task_2'])!
    deleteElements(m, ['Task_2'])
    expect(m.nodes.map((n) => n.id)).toEqual(['Task_1', 'Task_3'])
    expect(m.flows).toHaveLength(0)
    const [id] = pasteClip(m, clip, { offset: { x: 0, y: 0 } })
    expect(nodeOf(m, id)!.name).toBe('Check')
    expect(m.diagram.shapes[id]).toEqual(clip.shapes.Task_2)
  })

  it('refuses an empty clip', () => {
    expect(() => pasteClip(emptyModel(), { nodes: [], flows: [], shapes: {}, edges: {} })).toThrow(ModelError)
  })
})
