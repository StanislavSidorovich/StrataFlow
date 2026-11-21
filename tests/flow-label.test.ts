// A flow's name can be dragged off whatever it overlaps (v0.22.0): the offset is kept in the model, in the file, in
// BPMN label bounds and in a share link, follows the line when it is re-routed, and survives auto layout.
import { describe, expect, it } from 'vitest'
import { labelBox, labelHome } from '../src/core/edgeLabel'
import { readBpmn } from '../src/core/bpmn/read'
import { writeBpmn } from '../src/core/bpmn/write'
import { autoLayout } from '../src/core/layout'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import { addNode, addPool, connect, flowPath, setFlow, setFlowLabelOffset, setFlowRoute } from '../src/core/ops'
import { parseModel, serializeModel } from '../src/core/serialize'
import { packShare, unpackShare } from '../src/core/shareLink'
import { useEditor } from '../src/ui/store'

function gatewayModel(): { m: FlowModel; yes: string; no: string } {
  const m = emptyModel('Labels')
  addPool(m, { x: 0, y: 0 }, 'Shop')
  const a = addNode(m, { type: 'task' }, { x: 100, y: 80 }, 'Check order')
  const g = addNode(m, { type: 'gateway', kind: 'exclusive' }, { x: 260, y: 95 }, 'OK?')
  const b = addNode(m, { type: 'task' }, { x: 380, y: 30 }, 'Ship')
  const c = addNode(m, { type: 'task' }, { x: 380, y: 150 }, 'Reject')
  connect(m, a.id, g.id)
  const yes = connect(m, g.id, b.id)
  const no = connect(m, g.id, c.id)
  setFlow(m, yes.id, { name: 'Yes' })
  setFlow(m, no.id, { name: 'No' })
  return { m, yes: yes.id, no: no.id }
}

describe('flow name offset', () => {
  it('setFlowLabelOffset stores whole units; zero or null removes it; an unknown flow is refused', () => {
    const { m, yes } = gatewayModel()
    setFlowLabelOffset(m, yes, { dx: 10.4, dy: -7.6 })
    expect(m.flows.find((f) => f.id === yes)!.labelOffset).toEqual({ dx: 10, dy: -8 })
    setFlowLabelOffset(m, yes, { dx: 0.2, dy: -0.3 })
    expect(m.flows.find((f) => f.id === yes)!.labelOffset).toBeUndefined()
    setFlowLabelOffset(m, yes, { dx: 5, dy: 5 })
    setFlowLabelOffset(m, yes, null)
    expect(m.flows.find((f) => f.id === yes)!.labelOffset).toBeUndefined()
    expect(() => setFlowLabelOffset(m, 'nope', { dx: 1, dy: 1 })).toThrow()
  })

  it('labelBox moves the home box by the offset', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    const home = labelHome(pts, 'Yes')
    expect(labelBox(pts, 'Yes', [], { dx: 20, dy: -9 })).toEqual({ ...home, x: home.x + 20, y: home.y - 9 })
    expect(labelBox(pts, 'Yes')).toEqual(home)
  })

  it('follows the line when the flow is re-routed or a shape moves (the offset is from the default place)', () => {
    const { m, yes } = gatewayModel()
    setFlowLabelOffset(m, yes, { dx: 12, dy: 10 })
    const f = m.flows.find((x) => x.id === yes)!
    const before = labelBox(flowPath(m, f)!, 'Yes', [], f.labelOffset)
    setFlowRoute(m, yes, { source: 'bottom' })
    expect(f.labelOffset).toEqual({ dx: 12, dy: 10 })
    const after = labelBox(flowPath(m, f)!, 'Yes', [], f.labelOffset)
    const home = labelHome(flowPath(m, f)!, 'Yes')
    expect(after).toEqual({ ...home, x: home.x + 12, y: home.y + 10 })
    expect(after).not.toEqual(before)
  })

  it('is kept in the file, with a bad value dropped', () => {
    const { m, yes } = gatewayModel()
    setFlowLabelOffset(m, yes, { dx: -15, dy: 20 })
    const back = parseModel(serializeModel(m))
    expect(back.flows.find((f) => f.id === yes)!.labelOffset).toEqual({ dx: -15, dy: 20 })
    const raw = JSON.parse(serializeModel(m))
    raw.flows.find((f: { id: string }) => f.id === yes).labelOffset = { dx: 'x', dy: null }
    expect(parseModel(JSON.stringify(raw)).flows.find((f) => f.id === yes)!.labelOffset).toBeUndefined()
  })

  it('goes into BPMN label bounds and comes back as the same offset (a second trip changes nothing)', async () => {
    const { m, yes, no } = gatewayModel()
    setFlowLabelOffset(m, yes, { dx: 14, dy: -22 })
    const once = await readBpmn(await writeBpmn(m))
    expect(once.model.flows.find((f) => f.id === yes)!.labelOffset).toEqual({ dx: 14, dy: -22 })
    // A name nobody moved is not turned into an offset.
    expect(once.model.flows.find((f) => f.id === no)!.labelOffset).toBeUndefined()
    const twice = await readBpmn(await writeBpmn(once.model))
    expect(twice.model.flows.map((f) => f.labelOffset)).toEqual(once.model.flows.map((f) => f.labelOffset))
    // The label bounds in the XML are where the canvas draws the name.
    expect(await writeBpmn(m)).toContain('<bpmndi:BPMNLabel>')
  })

  it('an empty name keeps no label bounds and no offset on a round trip', async () => {
    const { m, yes } = gatewayModel()
    setFlow(m, yes, { name: '' })
    setFlowLabelOffset(m, yes, { dx: 30, dy: 30 })
    const back = await readBpmn(await writeBpmn(m))
    expect(back.model.flows.find((f) => f.id === yes)!.labelOffset).toBeUndefined()
  })

  it('survives auto layout (the offset is from the new default place)', async () => {
    const { m, yes } = gatewayModel()
    setFlowLabelOffset(m, yes, { dx: 8, dy: 9 })
    await autoLayout(m)
    expect(m.flows.find((f) => f.id === yes)!.labelOffset).toEqual({ dx: 8, dy: 9 })
  })

  it('travels in a share link', async () => {
    const { m, yes } = gatewayModel()
    setFlowLabelOffset(m, yes, { dx: 3, dy: -40 })
    const back = await unpackShare(await packShare({ kind: 'model', model: m }))
    expect(back.kind === 'model' && back.model.flows.find((f) => f.id === yes)!.labelOffset).toEqual({ dx: 3, dy: -40 })
  })

  it('a drag is one undo step', () => {
    const { m, yes } = gatewayModel()
    useEditor.getState().load(m)
    const ed = useEditor.getState()
    ed.apply((x) => setFlowLabelOffset(x, yes, { dx: 4, dy: 4 }), { coalesce: `label:${yes}` })
    ed.apply((x) => setFlowLabelOffset(x, yes, { dx: 9, dy: 12 }), { coalesce: `label:${yes}` })
    expect(useEditor.getState().model.flows.find((f) => f.id === yes)!.labelOffset).toEqual({ dx: 9, dy: 12 })
    useEditor.getState().undo()
    expect(useEditor.getState().model.flows.find((f) => f.id === yes)!.labelOffset).toBeUndefined()
  })
})
