// Review replay (core/reviewReplay.ts): the base first, one frame per fix in review order, the corrected model last;
// removed steps and flows as ghosts; a change that depends on another fix pulls it in and says so.
import { describe, expect, it } from 'vitest'
import { makeFix, reviewDiff, startReview, withoutReview } from '../src/core/diff'
import type { FlowModel } from '../src/core/metamodel'
import { addNode, connect, deleteElements, rename } from '../src/core/ops'
import { replayError, reviewReplay } from '../src/core/reviewReplay'
import { caseById } from '../src/data/cases'

const library = caseById('library-lend')!
const idOf = (m: FlowModel, name: string) => m.nodes.find((x) => x.name === name)!.id
const flowBetween = (m: FlowModel, a: string, b: string) => m.flows.find((f) => f.source === a && f.target === b)!.id

/** The ids and names a model is made of, to compare two models without caring about key order. */
const shape = (m: FlowModel) => ({
  nodes: m.nodes.map((n) => `${n.id}:${n.name}:${n.parentId ?? ''}`).sort(),
  flows: m.flows.map((f) => `${f.id}:${f.source}>${f.target}:${f.name}`).sort(),
  pools: [...m.participants, ...m.lanes].map((x) => `${x.id}:${x.name}`).sort(),
})

/** A reviewed copy of the library case: a rename, a new step, a removed step. Fixes are made in the given order. */
function reviewed(order: ('rename' | 'add' | 'remove')[] = ['rename', 'add', 'remove']) {
  const base = library.reference()
  const m = structuredClone(base)
  const fetch = idOf(m, 'Fetch book')
  const rec = idOf(m, 'Record loan')
  const stamp = idOf(m, 'Stamp due date')
  const hand = idOf(m, 'Hand over book')
  rename(m, fetch, 'Bring the book')
  // A step between two that stay.
  const flowRec = flowBetween(m, rec, stamp)
  deleteElements(m, [flowRec])
  const mail = addNode(m, { type: 'task', kind: 'service' }, { x: 700, y: 120 }, 'Email the member')
  connect(m, rec, mail.id)
  connect(m, mail.id, stamp)
  // A step taken out.
  const after = m.flows.find((f) => f.source === hand)!.target
  deleteElements(m, [hand])
  connect(m, stamp, after)
  startReview(m, base)
  const d = reviewDiff(m)!
  const key = { rename: `r:${fetch}`, add: `r:${mail.id}`, remove: `b:${hand}` }
  for (const w of order) expect(makeFix(m, [key[w]])).toBeTruthy()
  m.review!.fixes!.forEach((f, i) => (f.text = `Note ${i + 1}`))
  return { base, m, ids: { fetch, mail: mail.id, hand }, d }
}

describe('review replay', () => {
  it('refuses a model without a review, and two models drawn apart', () => {
    expect(replayError(library.reference())).toMatch(/Review this model/)
    expect(reviewReplay(library.reference())).toBeNull()
  })

  it.each([
    ['rename', 'add', 'remove'],
    ['remove', 'add', 'rename'],
    ['add', 'remove', 'rename'],
    ['add', 'rename', 'remove'],
    ['remove', 'rename', 'add'],
    ['rename', 'remove', 'add'],
  ] as const)('for the fix order %s: the first frame is the base, the last the corrected model', (...order) => {
    const { base, m } = reviewed([...order])
    const r = reviewReplay(m)!
    expect(r.frames).toHaveLength(3 + 2)
    expect(shape(r.frames[0].model)).toEqual(shape(base))
    const corrected = withoutReview(m)
    expect(shape(r.frames.at(-2)!.model)).toEqual(shape(corrected))
    expect(shape(r.frames.at(-1)!.model)).toEqual(shape(corrected))
    expect(r.frames.at(-1)!.overview).toBe(true)
    expect(r.frames.map((f) => f.index)).toEqual([0, 1, 2, 3, 4])
  })

  it('each frame applies only its fix: the rename, the new step and the removal come one at a time', () => {
    const { m, ids } = reviewed()
    const r = reviewReplay(m)!
    const has = (k: number, id: string) => r.frames[k].model.nodes.some((n) => n.id === id)
    const nameOf = (k: number) => r.frames[k].model.nodes.find((n) => n.id === ids.fetch)!.name
    // Fix 1 renames; the new step is not there yet, the removed one still is.
    expect([nameOf(0), nameOf(1), nameOf(2), nameOf(3)]).toEqual(['Fetch book', 'Bring the book', 'Bring the book', 'Bring the book'])
    expect([has(0, ids.mail), has(1, ids.mail), has(2, ids.mail), has(3, ids.mail)]).toEqual([false, false, true, true])
    expect([has(0, ids.hand), has(1, ids.hand), has(2, ids.hand), has(3, ids.hand)]).toEqual([true, true, true, false])
    // The new step's flows come with it; the flow it replaced goes with it.
    const rec = idOf(r.frames[2].model, 'Record loan')
    const stamp = idOf(r.frames[2].model, 'Stamp due date')
    expect(r.frames[1].model.flows.some((f) => f.source === rec && f.target === stamp)).toBe(true)
    expect(r.frames[2].model.flows.some((f) => f.source === rec && f.target === stamp)).toBe(false)
    expect(r.frames[2].model.flows.some((f) => f.source === ids.mail)).toBe(true)
  })

  it('numbers, notes and the marks: the fix number, its note as the comment, colours by kind', () => {
    const { m, ids } = reviewed()
    const r = reviewReplay(m)!
    expect(r.frames[1].beat.title).toMatch(/^Fix 1:/)
    expect(r.frames[1].beat.text![0]).toBe('Note 1')
    expect(r.frames[1].review!.marks[ids.fetch]).toEqual({ status: 'changed', n: 1 })
    expect(r.frames[2].review!.marks[ids.mail]).toEqual({ status: 'added', n: 2 })
    expect(r.frames[1].current).toContain(ids.fetch)
    expect(r.frames.at(-1)!.review!.marks[ids.mail]).toBeTruthy()
  })

  it('a removed step and its flows show as ghosts where they stood', () => {
    const { m, ids } = reviewed()
    const r = reviewReplay(m)!
    const f = r.frames[3]
    expect(f.review!.removedNodes.map((g) => g.id)).toEqual([ids.hand])
    expect(f.review!.removedNodes[0].box).toEqual(library.reference().diagram.shapes[ids.hand])
    expect(f.review!.removedNodes[0]).toMatchObject({ n: 3, page: null })
    expect(f.current).toContain(`ghost:${ids.hand}`)
    // Not a ghost in the frames before it, where the step is still real.
    expect(r.frames[2].review!.removedNodes).toEqual([])
    expect(r.frames.at(-1)!.review!.removedNodes).toHaveLength(1)
  })

  it('a removed flow between steps that stay is a ghost flow', () => {
    const base = library.reference()
    const m = structuredClone(base)
    const fetch = idOf(m, 'Fetch book')
    const rec = idOf(m, 'Record loan')
    const stamp = idOf(m, 'Stamp due date')
    const gone = flowBetween(m, rec, stamp)
    deleteElements(m, [gone])
    connect(m, fetch, stamp)
    startReview(m, base)
    const d = reviewDiff(m)!
    const flowChange = d.changes.find((c) => c.kind === 'flow' && c.status === 'removed')
    expect(flowChange).toBeTruthy()
    makeFix(m, [flowChange!.key])
    const r = reviewReplay(m)!
    const frame = r.frames[1]
    expect(frame.review!.removedFlows).toMatchObject([{ id: gone, source: rec, target: stamp, n: 1 }])
    expect(frame.model.flows.some((f) => f.id === gone)).toBe(false)
    expect(r.frames[0].model.flows.some((f) => f.id === gone)).toBe(true)
  })

  it('changes in no fix come after the fixes, one frame each, numbered as the panel numbers them', () => {
    const { m } = reviewed(['rename'])
    const r = reviewReplay(m)!
    const d = reviewDiff(m)!
    const others = d.changes.filter((c) => !c.fix)
    expect(others.length).toBeGreaterThan(0)
    expect(r.frames).toHaveLength(1 + 1 + others.length + 1)
    others.forEach((c, i) => expect(r.frames[2 + i].beat.title).toMatch(new RegExp(`^Change ${c.n}:`)))
    expect(shape(r.frames.at(-2)!.model)).toEqual(shape(withoutReview(m)))
  })

  it('a change that depends on another fix pulls it in and says so', () => {
    const base = library.reference()
    const m = structuredClone(base)
    const stamp = idOf(m, 'Stamp due date')
    const box = addNode(m, { type: 'subProcess' }, { x: 900, y: 60 }, 'Desk work')
    m.nodes.find((n) => n.id === stamp)!.parentId = box.id
    startReview(m, base)
    const d = reviewDiff(m)!
    const moved = d.changes.find((c) => c.id === stamp)
    const added = d.changes.find((c) => c.id === box.id)
    expect(moved?.details.join(' ')).toMatch(/Moved into/)
    expect(added?.status).toBe('added')
    // The move is fix 1, the sub-process it moves into is fix 2.
    makeFix(m, [moved!.key])
    makeFix(m, [added!.key])
    const r = reviewReplay(m)!
    const f1 = r.frames[1]
    expect([f1.beat.text].flat().join(' ')).toMatch(/Together with fix 2/)
    expect(f1.model.nodes.some((n) => n.id === box.id)).toBe(true)
    expect(f1.model.nodes.find((n) => n.id === stamp)!.parentId).toBe(box.id)
    // Fix 2 is already there; its frame still lights the box.
    expect(r.frames[2].review!.marks[box.id]).toEqual({ status: 'added', n: 2 })
    expect(shape(r.frames.at(-1)!.model)).toEqual(shape(withoutReview(m)))
  })
})
