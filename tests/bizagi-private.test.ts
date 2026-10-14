// The owner's own Bizagi exports (coursework, gitignored in /private). Skipped where they are absent (CI).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBpmn } from '../src/core/bpmn/read'

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
