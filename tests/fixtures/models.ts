// Models that cover the metamodel, shared by the BPMN round-trip and the auto layout tests.
import { expect } from 'vitest'
import { emptyModel, SIZES, type FlowModel, type FlowNode } from '../../src/core/metamodel'
import { addBoundaryEvent, addLane, addNode, addPool, appendNode, connect } from '../../src/core/ops'

/** Everything the metamodel has: no pool, every task kind, gateway kind and trigger, sub-processes both ways, artifacts. */
export function kitchenSink(): FlowModel {
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
export function pools(): FlowModel {
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
