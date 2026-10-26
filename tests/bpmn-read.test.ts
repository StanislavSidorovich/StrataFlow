import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readBpmn } from '../src/core/bpmn/read'

const sample = readFileSync('src/data/examples/library-loan.bpmn', 'utf8')

describe('readBpmn on a Bizagi-shaped export', async () => {
  const { model, warnings } = await readBpmn(sample)
  const node = (id: string) => model.nodes.find((n) => n.id === id)

  it('reads without warnings', () => expect(warnings).toEqual([]))

  it('drops the empty "Main Process" pool and keeps the black-box pool', () => {
    expect(model.participants).toEqual([
      { id: 'Participant_library', name: 'Library', processId: 'Process_loan' },
      { id: 'Participant_member', name: 'Member', processId: undefined },
    ])
    expect(model.diagram.shapes.Participant_main).toBeUndefined()
  })

  it('reads lanes and puts nodes in them', () => {
    expect(model.lanes.map((l) => l.name)).toEqual(['Front desk', 'Stacks'])
    expect(node('Task_fetch')?.laneId).toBe('Lane_stacks')
    expect(node('Task_check')).toMatchObject({ laneId: 'Lane_desk', participantId: 'Participant_library' })
  })

  it('puts a step in the lane it is drawn in when the lanes list nothing (as Bizagi writes them)', async () => {
    const bare = sample.replace(/<(bpmn:)?flowNodeRef>[^<]*<\/(bpmn:)?flowNodeRef>/g, '')
    expect(bare).not.toContain('flowNodeRef>')
    const back = (await readBpmn(bare)).model
    for (const n of model.nodes) expect(back.nodes.find((x) => x.id === n.id)?.laneId, n.id).toBe(n.laneId)
  })

  it('maps element types', () => {
    expect(node('Start_requested')).toMatchObject({ type: 'event', position: 'start', trigger: 'message', throwing: false })
    expect(node('Timer_due')).toMatchObject({ type: 'event', position: 'intermediate', trigger: 'timer' })
    expect(node('Gateway_valid')).toMatchObject({ type: 'gateway', kind: 'exclusive', defaultFlow: 'Flow_yes' })
    expect(node('Task_remind')).toMatchObject({ type: 'task', kind: 'send' })
    expect(node('DataRef_slip')).toMatchObject({ type: 'dataObject', name: 'Loan slip', state: 'filled' })
  })

  it('reads sequence, message and data flows', () => {
    const kinds = model.flows.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }), {})
    expect(kinds).toEqual({ sequence: 8, message: 2, data: 1 })
    expect(model.flows.find((f) => f.id === 'Flow_no')).toMatchObject({ name: 'No', condition: 'membership expired' })
  })

  it('undoes Bizagi\'s relative lane x', () => {
    expect(model.diagram.shapes.Lane_desk).toEqual({ x: 60, y: 30, width: 930, height: 180 })
  })

  it('keeps edge waypoints', () => {
    expect(model.diagram.edges.Flow_yes).toEqual([{ x: 345, y: 110 }, { x: 445, y: 110 }, { x: 445, y: 250 }])
  })
})
