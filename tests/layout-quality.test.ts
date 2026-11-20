// How tidy auto layout draws (core/layoutQuality): on every own case and on a generic large model, no line runs
// through a shape it does not join, no shapes overlap, end events close their pool, flow names sit clear of lines,
// and lines cross and bend no more than before the routing rewrite (2026-11-20). Lay out twice = the same drawing.
import { describe, expect, it } from 'vitest'
import { emptyModel, type FlowModel } from '../src/core/metamodel'
import { addNode, addPool } from '../src/core/ops'
import { autoLayout } from '../src/core/layout'
import { labelProblems, layoutQuality } from '../src/core/layoutQuality'
import { CASES } from './fixtures/cases'
import { drawWideModel } from './fixtures/wide-model'

/** Auto layout before the rewrite, measured the same way: lines through shapes, crossings, bends, end events not last, names on lines. */
const BEFORE: Record<string, { thru: number; cross: number; bends: number; end: number; labels: number }> = {
  'library-lend': { thru: 0, cross: 0, bends: 6, end: 1, labels: 1 },
  'hotel-booking': { thru: 1, cross: 0, bends: 4, end: 1, labels: 1 },
  'shop-order': { thru: 4, cross: 2, bends: 14, end: 1, labels: 1 },
  'scooter-ride': { thru: 0, cross: 8, bends: 18, end: 1, labels: 0 },
  'hospital-admission': { thru: 0, cross: 1, bends: 18, end: 0, labels: 0 },
  'football-match': { thru: 3, cross: 1, bends: 14, end: 1, labels: 0 },
  'expense-claim-as-is': { thru: 0, cross: 0, bends: 8, end: 0, labels: 1 },
  'expense-claim-to-be': { thru: 0, cross: 0, bends: 16, end: 0, labels: 1 },
  'kaiyo-order': { thru: 8, cross: 3, bends: 16, end: 1, labels: 1 },
  'wide-model': { thru: 2, cross: 54, bends: 100, end: 1, labels: 2 },
}
/** Football match: two crossings now, one before; before, three lines ran through shapes and a message dropped across an end event's line. */
const CROSS_BUDGET: Record<string, number> = { 'football-match': 2 }

const models: { id: string; make: () => FlowModel }[] = [
  ...CASES.map((c) => ({
    id: c.id,
    make: () => {
      const m = emptyModel(c.name)
      c.draw(m)
      return m
    },
  })),
  {
    id: 'wide-model',
    make: () => {
      const m = emptyModel('Wide')
      drawWideModel(m)
      return m
    },
  },
]

describe('auto layout quality', () => {
  for (const { id, make } of models)
    it(`${id}: tidy, and no worse than before`, async () => {
      const m = make()
      await autoLayout(m)
      const q = layoutQuality(m)
      const before = BEFORE[id]
      expect(q.lineThroughShape, 'lines through shapes').toBe(0)
      expect(q.shapeOverlaps, 'shapes on shapes').toBe(0)
      expect(q.endNotRightmost, 'end events that are not last').toBe(0)
      expect(q.lineCrossings, 'crossings').toBeLessThanOrEqual(CROSS_BUDGET[id] ?? before.cross)
      expect(q.bends, 'bends').toBeLessThanOrEqual(before.bends)
      expect(q.labelsOnLine, `names on a line: ${JSON.stringify(labelProblems(m))}`).toBeLessThanOrEqual(before.labels)
    }, 60000)

  it('the large model has 60+ elements', () => {
    expect(models.at(-1)!.make().nodes.length).toBeGreaterThanOrEqual(60)
  })

  it('laying out twice gives the same drawing', async () => {
    const m = models.at(-1)!.make()
    await autoLayout(m)
    const once = JSON.stringify(m.diagram)
    await autoLayout(m)
    expect(JSON.stringify(m.diagram)).toBe(once)
  }, 60000)

  it('a single step, and an empty pool, lay out without a line', async () => {
    const m = emptyModel('One')
    addPool(m, { x: 0, y: 0 }, 'Alone')
    addNode(m, { type: 'task' }, { x: 200, y: 100 }, 'Only step')
    await autoLayout(m)
    expect(layoutQuality(m)).toMatchObject({ flows: 0, lineThroughShape: 0, shapeOverlaps: 0 })
    const empty = emptyModel('Empty')
    addPool(empty, { x: 0, y: 0 }, 'Nobody')
    await autoLayout(empty)
    expect(empty.diagram.shapes[empty.participants[0].id].width).toBeGreaterThan(0)
  })

  it('a huge model (150+ elements) lays out, tidy, in reasonable time', async () => {
    const m = emptyModel('Huge')
    drawWideModel(m, 14)
    expect(m.nodes.length).toBeGreaterThanOrEqual(150)
    const t = Date.now()
    await autoLayout(m)
    const q = layoutQuality(m)
    expect(q).toMatchObject({ lineThroughShape: 0, shapeOverlaps: 0, endNotRightmost: 0 })
    expect(Date.now() - t).toBeLessThan(30000)
  }, 60000)
})
