// Routes between chosen sides and the edits a user makes to a route.
import { describe, expect, it } from 'vitest'
import { emptyModel, type Bounds, type Side } from '../src/core/metamodel'
import { addNode, addPool, connect, reconnect, resetFlowRoute, setFlowRoute } from '../src/core/ops'
import { anchor, dragSegment, isOrthogonal, nearestSide, route, routeSides, simplify } from '../src/core/routing'

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const a: Bounds = { x: 0, y: 0, width: 100, height: 80 }
const placements: Record<string, Bounds> = {
  right: { x: 240, y: 20, width: 100, height: 80 },
  left: { x: -240, y: 20, width: 100, height: 80 },
  below: { x: 10, y: 200, width: 100, height: 80 },
  above: { x: 10, y: -200, width: 100, height: 80 },
  near: { x: 130, y: 100, width: 100, height: 80 },
}

describe('routeSides', () => {
  for (const [where, t] of Object.entries(placements))
    for (const ss of SIDES)
      for (const ts of SIDES)
        it(`${ss} to ${ts}, target ${where}: orthogonal, starts and ends on the chosen sides`, () => {
          const pts = routeSides(a, ss, t, ts)
          expect(isOrthogonal(pts)).toBe(true)
          expect(pts[0]).toEqual(anchor(a, ss))
          expect(pts.at(-1)).toEqual(anchor(t, ts))
          expect(simplify(pts)).toEqual(pts)
        })

  it('leaves by the right and enters by the left: one bend in the middle', () => {
    expect(routeSides(a, 'right', placements.right, 'left')).toEqual([
      { x: 100, y: 40 },
      { x: 170, y: 40 },
      { x: 170, y: 60 },
      { x: 240, y: 60 },
    ])
  })

  it('enters the left side of a task that is below: not through its top', () => {
    const pts = routeSides(a, 'bottom', placements.below, 'left')
    expect(pts.at(-1)).toEqual({ x: 10, y: 240 })
    expect(pts.at(-2)!.y).toBe(240)
    expect(pts.at(-2)!.x).toBeLessThan(10)
  })
})

describe('chosen sides in a model', () => {
  it('connect keeps the sides and the exported route follows them', () => {
    const m = emptyModel('x')
    const p = addPool(m, { x: 0, y: 0 })
    const s = addNode(m, { type: 'task' }, { x: 100, y: 100 }, 'A')
    const t = addNode(m, { type: 'task' }, { x: 100, y: 300 }, 'B')
    void p
    const f = connect(m, s.id, t.id, { source: 'right', target: 'left' })
    expect(f).toMatchObject({ sourceSide: 'right', targetSide: 'left' })
    const pts = route(f, m.diagram.shapes[s.id], m.diagram.shapes[t.id])!
    expect(pts[0].x).toBe(m.diagram.shapes[s.id].x + m.diagram.shapes[s.id].width)
    expect(pts.at(-1)!.x).toBe(m.diagram.shapes[t.id].x)
  })

  it('reconnect replaces the side of the moved end and drops the bends', () => {
    const m = emptyModel('x')
    addPool(m, { x: 0, y: 0 })
    const s = addNode(m, { type: 'task' }, { x: 100, y: 100 }, 'A')
    const t = addNode(m, { type: 'task' }, { x: 300, y: 100 }, 'B')
    const u = addNode(m, { type: 'task' }, { x: 500, y: 100 }, 'C')
    const f = connect(m, s.id, t.id, { source: 'right', target: 'left' })
    m.diagram.edges[f.id] = [{ x: 1, y: 1 }, { x: 2, y: 2 }]
    reconnect(m, f.id, 'target', u.id, 'top')
    expect(f).toMatchObject({ sourceSide: 'right', targetSide: 'top', target: u.id })
    expect(m.diagram.edges[f.id]).toBeUndefined()
    reconnect(m, f.id, 'source', t.id)
    expect(f.sourceSide).toBeUndefined()
  })

  it('setFlowRoute sets bends or sides; resetFlowRoute puts everything back', () => {
    const m = emptyModel('x')
    addPool(m, { x: 0, y: 0 })
    const s = addNode(m, { type: 'task' }, { x: 100, y: 100 }, 'A')
    const t = addNode(m, { type: 'task' }, { x: 300, y: 100 }, 'B')
    const f = connect(m, s.id, t.id)
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 5 }]
    setFlowRoute(m, f.id, { points: pts })
    expect(m.diagram.edges[f.id]).toEqual(pts)
    setFlowRoute(m, f.id, { target: 'top' })
    expect(f.targetSide).toBe('top')
    expect(m.diagram.edges[f.id]).toBeUndefined() // a new side makes the old bends meaningless
    setFlowRoute(m, f.id, { points: pts })
    resetFlowRoute(m, f.id)
    expect(f.sourceSide ?? f.targetSide).toBeUndefined()
    expect(m.diagram.edges[f.id]).toBeUndefined()
    expect(() => setFlowRoute(m, f.id, { points: [{ x: 0, y: 0 }] })).toThrow()
  })
})

describe('dragSegment', () => {
  const z = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 100 },
  ]
  it('moves a middle segment and stretches its neighbours', () => {
    expect(dragSegment(z, 1, { x: 40, y: 999 })).toEqual([
      { x: 0, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 100 },
      { x: 200, y: 100 },
    ])
  })
  it('an end segment gets a step so the end stays on its shape', () => {
    expect(dragSegment(z, 0, { x: 5, y: 30 })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 100, y: 30 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ])
  })
  it('a straight line becomes a path with two steps', () => {
    const out = dragSegment([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0, { x: 0, y: 20 })
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 0 }])
    expect(isOrthogonal(out)).toBe(true)
  })
  it('dragging back to the start restores the path', () => {
    expect(dragSegment(z, 1, { x: 0, y: 0 })).toEqual(z.filter((p) => !(p.x === 100 && p.y === 0 && false)))
  })
})

describe('nearestSide', () => {
  it('picks the side the point is closest to', () => {
    expect(nearestSide(a, { x: 5, y: 40 })).toBe('left')
    expect(nearestSide(a, { x: 95, y: 40 })).toBe('right')
    expect(nearestSide(a, { x: 50, y: 5 })).toBe('top')
    expect(nearestSide(a, { x: 50, y: 78 })).toBe('bottom')
  })
})
