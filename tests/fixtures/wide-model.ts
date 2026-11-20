// A generic large model for the layout tests: five lanes, an AND split into four branches of the same tasks,
// a boundary timer with a fallback path in every branch, an XOR in front of the AND join, a loop back, a
// collapsed and an expanded sub-process, data, an annotation, a black-box client pool, 60+ elements.
// Positions are scattered on purpose: auto layout has to make it tidy from any drawing.
import type { FlowModel } from '../../src/core/metamodel'
import { addBoundaryEvent, addLane, addNode, addPool, connect, rename, setDefaultFlow, setFlow, updateNode } from '../../src/core/ops'

const LANES = ['Requester', 'Analyst', 'Manager', 'Finance', 'System']

export function drawWideModel(m: FlowModel, branches = 4) {
  addPool(m, { x: 0, y: 0 }, 'Operations')
  for (const l of LANES) addLane(m, 'Participant_1', l)
  addPool(m, { x: 0, y: 1000 }, 'Client')
  m.participants[1].processId = undefined // black box
  const row = (lane: number) => 75 + 150 * lane + 15
  let k = 0
  const at = (lane: number) => ({ x: 90 + ((k++ * 53) % 640), y: row(lane) + ((k * 17) % 40) - 20 })
  const task = (name: string, lane: number, kind: 'task' | 'user' | 'manual' | 'send' | 'receive' = 'task') => addNode(m, { type: 'task', kind }, at(lane), name)
  const gate = (kind: 'exclusive' | 'parallel', lane: number, name = '') => addNode(m, { type: 'gateway', kind }, at(lane), name)
  const end = (name: string, lane: number) => addNode(m, { type: 'event', position: 'end' }, at(lane), name)

  const start = addNode(m, { type: 'event', position: 'start', trigger: 'message' }, at(0), 'Request received')
  const register = task('Register request', 4)
  const classify = task('Classify request', 1)
  const dupes = task('Check duplicates', 4)
  const submit = task('Submit request', 0, 'user')
  const triage = task('Triage request', 1)
  const complete = gate('exclusive', 1, 'Complete?')
  const fix = task('Ask for details', 0, 'send')
  const split = gate('parallel', 1)
  connect(m, start.id, register.id)
  connect(m, register.id, classify.id)
  connect(m, classify.id, dupes.id)
  connect(m, dupes.id, submit.id)
  connect(m, submit.id, triage.id)
  connect(m, triage.id, complete.id)
  connect(m, complete.id, fix.id)
  connect(m, fix.id, submit.id) // loop back
  connect(m, complete.id, split.id)
  const [back, ahead] = m.flows.filter((f) => f.source === complete.id)
  setFlow(m, back.id, { name: 'No' })
  setFlow(m, ahead.id, { name: 'Yes' })
  setDefaultFlow(m, ahead.id, true)

  const join = gate('parallel', 3)
  const joins: string[] = []
  for (let b = 1; b <= branches; b++) {
    const notify = task('Notify owner', 0, 'send')
    const collect = task('Collect figures', 1, 'user')
    const sheet = addNode(m, { type: 'dataObject' }, at(1), 'Figures')
    const approve = task('Approve figures', 2)
    const check = task('Check figures', 2, 'user')
    const timer = addBoundaryEvent(m, check.id, 'timer')
    rename(m, timer.id, '2 days')
    const remind = task('Remind owner', 0, 'send')
    const merge = gate('exclusive', 2)
    const log = task('Log result', 4, 'task')
    const before = gate('exclusive', 3)
    connect(m, split.id, notify.id)
    connect(m, notify.id, collect.id)
    connect(m, collect.id, sheet.id)
    connect(m, collect.id, check.id)
    connect(m, check.id, merge.id)
    connect(m, timer.id, remind.id)
    connect(m, remind.id, merge.id)
    connect(m, merge.id, approve.id)
    connect(m, approve.id, log.id)
    connect(m, log.id, before.id)
    connect(m, before.id, join.id)
    joins.push(before.id)
  }
  // The decision after the join, a loop back, two ends.
  const consolidate = task('Consolidate', 3, 'user')
  const approved = gate('exclusive', 2, 'Approved?')
  const rework = task('Rework figures', 1)
  const review = addNode(m, { type: 'subProcess' }, at(2), 'Board review')
  const open = addNode(m, { type: 'subProcess' }, at(3), 'Payment run')
  updateNode(m, open.id, { collapsed: false })
  const tell = task('Notify finance', 4, 'send')
  const pay = task('Pay', 3, 'manual')
  const archive = task('Archive file', 4)
  const done = end('Request closed', 4)
  const refused = end('Request refused', 2)
  connect(m, join.id, consolidate.id)
  connect(m, consolidate.id, approved.id)
  connect(m, approved.id, rework.id)
  connect(m, rework.id, consolidate.id) // loop back
  connect(m, approved.id, review.id)
  connect(m, review.id, tell.id)
  connect(m, tell.id, pay.id)
  connect(m, pay.id, archive.id)
  connect(m, archive.id, done.id)
  connect(m, approved.id, refused.id)
  const outs = m.flows.filter((f) => f.source === approved.id)
  setFlow(m, outs[0].id, { name: 'Rework' })
  setFlow(m, outs[1].id, { name: 'Yes' })
  setFlow(m, outs[2].id, { name: 'No' })
  const slip = addNode(m, { type: 'dataObject' }, at(3), 'Figures sheet')
  connect(m, consolidate.id, slip.id)
  addNode(m, { type: 'annotation' }, at(4), 'Amounts above the limit need two signatures')
  connect(m, 'Participant_2', start.id)
  connect(m, done.id, 'Participant_2')
  connect(m, archive.id, 'Participant_2')
  return { start, split, join, joins, done, refused, approved }
}
