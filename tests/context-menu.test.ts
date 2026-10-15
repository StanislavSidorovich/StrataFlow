// The context menu and the "Change type" popup (src/ui/canvas/menu.ts) and the trigger rules they use
// (triggersFor, updateNode in core/ops). Each entry is one op on the model.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import { addBoundaryEvent, addNode, groupIntoSubprocess, ModelError, nodeOf, triggersFor, updateNode, canInterrupt, flowOf } from '../src/core/ops'
import { parseModel } from '../src/core/serialize'
import { flatEntries, menuFor, typeEntries, type MenuItem } from '../src/ui/canvas/menu'

const example = () => parseModel(readFileSync('src/data/examples/library-loan.flow.json', 'utf8'))
const entry = (items: MenuItem[], id: string) => {
  const e = flatEntries(items).find((x) => x.id === id)
  if (!e) throw new Error(`No entry ${id} in ${flatEntries(items).map((x) => x.id).join(', ')}`)
  return e
}
const run = (m: FlowModel, items: MenuItem[], id: string) => entry(items, id).edit!(m)
const ids = (items: MenuItem[]) => flatEntries(items).map((x) => x.id)

describe('triggers per position', () => {
  it('lists only what BPMN allows where the event is', () => {
    expect(triggersFor({ position: 'start', throwing: false })).toEqual(['none', 'message', 'timer', 'signal', 'conditional'])
    expect(triggersFor({ position: 'intermediate', throwing: false })).toContain('timer')
    expect(triggersFor({ position: 'intermediate', throwing: true })).not.toContain('timer')
    expect(triggersFor({ position: 'end', throwing: true })).toContain('terminate')
    expect(triggersFor({ position: 'end', throwing: true })).not.toContain('timer')
    expect(triggersFor({ position: 'boundary', throwing: false })).not.toContain('none')
    expect(triggersFor({ position: 'start', throwing: false })).not.toContain('error')
  })

  it('updateNode refuses a trigger not allowed there and resets one that no longer fits', () => {
    const m = emptyModel()
    const e = addNode(m, { type: 'event', position: 'intermediate', trigger: 'timer' }, { x: 0, y: 0 })
    expect(() => updateNode(m, e.id, { trigger: 'terminate' })).toThrow(ModelError)
    expect(nodeOf(m, e.id)).toMatchObject({ trigger: 'timer' })
    updateNode(m, e.id, { position: 'end' }) // an end event has no timer
    expect(nodeOf(m, e.id)).toMatchObject({ position: 'end', trigger: 'none', throwing: true })
    updateNode(m, e.id, { position: 'start', trigger: 'message' }) // a message is allowed at the start
    expect(nodeOf(m, e.id)).toMatchObject({ position: 'start', trigger: 'message' })
    updateNode(m, e.id, { position: 'intermediate', throwing: true })
    expect(nodeOf(m, e.id)).toMatchObject({ trigger: 'message', throwing: true })
  })

  it('interrupting is a choice on a boundary event and a start event in a sub-process', () => {
    const m = emptyModel()
    const t = addNode(m, { type: 'task' }, { x: 300, y: 100 })
    const s = addNode(m, { type: 'event', position: 'start' }, { x: 100, y: 100 })
    const b = addBoundaryEvent(m, t.id)
    expect([canInterrupt(m, b.id), canInterrupt(m, s.id), canInterrupt(m, t.id)]).toEqual([true, false, false])
    const sp = addNode(m, { type: 'subProcess' }, { x: 600, y: 100 })
    const inner = addNode(m, { type: 'event', position: 'start' }, { x: 600, y: 300 }, '', sp.id)
    expect(canInterrupt(m, inner.id)).toBe(true)
    updateNode(m, inner.id, { interrupting: false })
    expect(nodeOf(m, inner.id)).toMatchObject({ interrupting: false })
  })
})

describe('context menu', () => {
  it('on the timer event of the example: its triggers, position and direction; Message changes it', () => {
    const m = example()
    const items = menuFor(m, ['Timer_due'], { x: 0, y: 0 }, null)
    expect(ids(entry(items, 'trigger').items!)).toEqual(triggersFor({ position: 'intermediate', throwing: false }).map((t) => `trigger-${t}`))
    expect(entry(items, 'trigger-timer').checked).toBe(true)
    expect(ids(items)).toEqual(expect.arrayContaining(['position-start', 'direction-throw', 'rename', 'help', 'delete']))
    expect(ids(items)).not.toContain('interrupting')
    run(m, items, 'trigger-message')
    expect(nodeOf(m, 'Timer_due')).toMatchObject({ trigger: 'message', position: 'intermediate' })
  })

  it('a boundary event: no position, an interrupting switch', () => {
    const m = emptyModel()
    const t = addNode(m, { type: 'task' }, { x: 300, y: 100 })
    const b = addBoundaryEvent(m, t.id)
    const items = typeEntries(m, b.id)
    expect(ids(items)).not.toContain('position')
    expect(entry(items, 'interrupting').checked).toBe(true)
    run(m, items, 'interrupting')
    expect(nodeOf(m, b.id)).toMatchObject({ interrupting: false })
    expect(entry(typeEntries(m, b.id), 'interrupting').checked).toBe(false)
  })

  it('a task: its kind, convert to sub-process, a boundary event', () => {
    const m = example()
    const items = menuFor(m, ['Task_check'], { x: 0, y: 0 }, null)
    run(m, items, 'kind-user')
    expect(nodeOf(m, 'Task_check')).toMatchObject({ kind: 'user' })
    run(m, items, 'to-subprocess')
    expect(nodeOf(m, 'Task_check')?.type).toBe('subProcess')
    expect(ids(menuFor(m, ['Task_check'], { x: 0, y: 0 }, null))).toContain('to-task')
  })

  it('a gateway: its kind; parallel drops the default flow', () => {
    const m = example()
    const items = menuFor(m, ['Gateway_valid'], { x: 0, y: 0 }, null)
    expect(entry(items, 'kind-exclusive').checked).toBe(true)
    run(m, items, 'kind-parallel')
    expect(nodeOf(m, 'Gateway_valid')).toMatchObject({ kind: 'parallel' })
    expect(nodeOf(m, 'Gateway_valid')).not.toHaveProperty('defaultFlow')
  })

  it('a flow out of an exclusive gateway: default flow and reverse', () => {
    const m = example()
    let items = menuFor(m, ['Flow_no'], { x: 0, y: 0 }, null)
    expect(entry(items, 'default').checked).toBe(false)
    run(m, items, 'default')
    expect(nodeOf(m, 'Gateway_valid')).toMatchObject({ defaultFlow: 'Flow_no' })
    items = menuFor(m, ['Flow_no'], { x: 0, y: 0 }, null)
    expect(entry(items, 'default').checked).toBe(true)
    run(m, items, 'reverse')
    expect(flowOf(m, 'Flow_no')).toMatchObject({ source: 'End_refused', target: 'Gateway_valid' })
    expect(ids(menuFor(m, ['Flow_1'], { x: 0, y: 0 }, null))).not.toContain('default')
  })

  it('several selected: group and delete; the empty canvas: add here, layout, check', () => {
    const m = example()
    expect(ids(menuFor(m, ['Task_check', 'Gateway_valid'], { x: 0, y: 0 }, null))).toEqual(['group', 'delete'])
    run(m, menuFor(m, ['Task_check', 'Gateway_valid'], { x: 0, y: 0 }, null), 'delete')
    expect(nodeOf(m, 'Task_check')).toBeUndefined()
    const pane = menuFor(m, [], { x: 400, y: 120 }, null)
    expect(ids(pane)).toEqual(expect.arrayContaining(['add-task', 'add-exclusive', 'add-end', 'add-pool', 'layout', 'check']))
    const id = run(m, pane, 'add-task') as string
    const s = m.diagram.shapes[id]
    expect([s.x + s.width / 2, s.y + s.height / 2]).toEqual([400, 120])
    expect(nodeOf(m, id)?.participantId).toBe('Participant_library')
  })

  it('a refused change throws ModelError, which the store shows', () => {
    const m = emptyModel()
    const t = addNode(m, { type: 'task' }, { x: 300, y: 100 })
    const sp = groupIntoSubprocess(m, [t.id])
    expect(() => run(m, typeEntries(m, sp.id), 'to-task')).toThrow(ModelError)
  })
})
