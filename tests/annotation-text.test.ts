// A text annotation can be larger and bold (the days of the week on a schedule must be read first);
// the BPMN export carries it as a label style.
import { describe, expect, it } from 'vitest'
import { emptyModel } from '../src/core/metamodel'
import { addNode, updateNode } from '../src/core/ops'
import { writeBpmn } from '../src/core/bpmn/write'
import { parseModel, serializeModel } from '../src/core/serialize'

function noted() {
  const m = emptyModel('Weekly report')
  const a = addNode(m, { type: 'annotation' }, { x: 200, y: 100 }, 'Mon')
  return { m, a }
}

describe('annotation text size and bold', () => {
  it('is stored only when it differs from the default, and survives a save', () => {
    const { m, a } = noted()
    updateNode(m, a.id, { textSize: 'L', bold: true })
    const n = m.nodes.find((x) => x.id === a.id)
    expect(n).toMatchObject({ size: 'L', bold: true })
    expect(parseModel(serializeModel(m)).nodes.find((x) => x.id === a.id)).toMatchObject({ size: 'L', bold: true })
    updateNode(m, a.id, { textSize: 'M', bold: false })
    expect(m.nodes.find((x) => x.id === a.id)).not.toHaveProperty('size')
    expect(m.nodes.find((x) => x.id === a.id)).not.toHaveProperty('bold')
  })

  it('goes into the BPMN export as a label style, and only for the annotations that ask for it', async () => {
    const { m, a } = noted()
    addNode(m, { type: 'annotation' }, { x: 400, y: 100 }, 'plain note')
    expect(await writeBpmn(m)).not.toContain('BPMNLabelStyle')
    updateNode(m, a.id, { textSize: 'XL', bold: true })
    const xml = await writeBpmn(m)
    expect(xml.match(/<bpmndi:BPMNLabelStyle/g)).toHaveLength(1)
    expect(xml).toMatch(/<dc:Font[^>]*size="20"[^>]*isBold="true"/)
    expect(xml).toContain('labelStyle=')
  })
})
