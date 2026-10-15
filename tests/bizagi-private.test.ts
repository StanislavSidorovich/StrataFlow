// The owner's own Bizagi exports (coursework, gitignored in /private). Skipped where they are absent (CI).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBpmn } from '../src/core/bpmn/read'
import { lintModel } from '../src/core/lint'

const root = 'private/course/bizagi'
const files = existsSync(root) ? (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.bpmn')).map((f) => join(root, f)) : []

describe.skipIf(files.length === 0)('readBpmn on real Bizagi exports', () => {
  it.each(files)('%s', async (file) => {
    const { model } = await readBpmn(readFileSync(file, 'utf8'))
    expect(model.nodes.length).toBeGreaterThan(0)
    // Every kept node and pool has a shape, and lanes sit inside their pool.
    for (const n of model.nodes) expect(model.diagram.shapes[n.id], n.id).toBeDefined()
    for (const l of model.lanes) {
      const lane = model.diagram.shapes[l.id]
      const pool = model.diagram.shapes[l.participantId!]
      expect(lane.x).toBeGreaterThanOrEqual(pool.x)
      expect(lane.x + lane.width).toBeLessThanOrEqual(pool.x + pool.width)
    }
  })
})

// The linter finds the mistakes known to be in two of these files (see private/course/README.md).
describe.skipIf(files.length === 0)('lintModel on real Bizagi exports', () => {
  const lint = async (name: string) => lintModel((await readBpmn(readFileSync(files.find((f) => f.endsWith(name))!, 'utf8'))).model)
  it('an unconnected gateway (clinic, diagram 4)', async () => {
    expect((await lint('Diagram 4.bpmn')).filter((i) => i.rule === 'P02').map((i) => i.message)).toEqual([expect.stringContaining('exclusive gateway has no incoming flow')])
  })
  it('a task without incoming and one without outgoing flow (clinic, diagram 5)', async () => {
    const p02 = (await lint('Diagram 5.bpmn')).filter((i) => i.rule === 'P02').map((i) => i.message)
    expect(p02).toEqual([expect.stringContaining('re-enter prescription'), expect.stringContaining('call doctor')])
  })
})
