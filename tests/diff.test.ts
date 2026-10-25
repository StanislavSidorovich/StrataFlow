// Comparing two versions of a process (core/diff.ts): a copy edited in Flow (ids pair the elements), and two
// models drawn apart (paired by names and places), each change found once, numbered in the order the process reads.
import { describe, expect, it } from 'vitest'
import { diffModels } from '../src/core/diff'
import type { FlowModel } from '../src/core/metamodel'
import { addNode, connect, deleteElements, moveElements, rename, setSim, updateNode } from '../src/core/ops'
import { parseModel, serializeModel } from '../src/core/serialize'
import { caseById } from '../src/data/cases'
import expenseAsIs from '../cases/expense-claim-as-is.flow.json?raw'
import expenseToBe from '../cases/expense-claim-to-be.flow.json?raw'

const library = caseById('library-lend')!
const hotel = caseById('hotel-booking')!

const idOf = (m: FlowModel, name: string) => {
  const n = m.nodes.find((x) => x.name === name) ?? m.participants.find((x) => x.name === name) ?? m.lanes.find((x) => x.name === name)
  if (!n) throw new Error(`no ${name}`)
  return n.id
}
const flowBetween = (m: FlowModel, a: string, b: string) => m.flows.find((f) => f.source === a && f.target === b)!.id
const copy = (m: FlowModel): FlowModel => structuredClone(m)
const lines = (d: ReturnType<typeof diffModels>) => d.changes.map((c) => `${c.n} ${c.status} ${c.label}: ${c.details.join('; ')}`)

/** The same model with other ids, as if drawn again or imported from another tool. */
function rekey(m: FlowModel, id: (old: string) => string = (x) => `z${x}`): FlowModel {
  const r = copy(m)
  const k = (x: string | undefined) => (x === undefined ? undefined : id(x))
  for (const p of r.participants) (p.id = id(p.id)), p.processId && (p.processId = id(p.processId))
  for (const l of r.lanes) Object.assign(l, { id: id(l.id), participantId: k(l.participantId), parentLaneId: k(l.parentLaneId) })
  for (const n of r.nodes) {
    Object.assign(n, { id: id(n.id), participantId: k(n.participantId), laneId: k(n.laneId), parentId: k(n.parentId) })
    if (n.type === 'event' && n.attachedTo) n.attachedTo = id(n.attachedTo)
    if (n.type === 'gateway' && n.defaultFlow) n.defaultFlow = id(n.defaultFlow)
  }
  for (const f of r.flows) Object.assign(f, { id: id(f.id), source: id(f.source), target: id(f.target) })
  r.diagram = {
    shapes: Object.fromEntries(Object.entries(r.diagram.shapes).map(([x, b]) => [id(x), b])),
    edges: Object.fromEntries(Object.entries(r.diagram.edges).map(([x, b]) => [id(x), b])),
  }
  for (const o of [...r.nodes, ...r.participants, ...r.lanes, ...r.flows] as unknown as Record<string, unknown>[])
    for (const key of Object.keys(o)) if (o[key] === undefined) delete o[key]
  return r
}

describe('a copy edited in Flow', () => {
  it('no edits: nothing changed, everything kept', () => {
    const m = library.reference()
    const d = diffModels(m, copy(m))
    expect(d.changes).toEqual([])
    expect(d.sameDrawing).toBe(true)
    expect(d.kept).toBe(m.nodes.length + m.participants.length + m.lanes.length)
  })

  it('a renamed step and a gateway of another kind', () => {
    const base = library.reference()
    const m = copy(base)
    rename(m, idOf(m, 'Fetch book'), 'Bring the book')
    updateNode(m, idOf(m, 'Card valid?'), { kind: 'parallel' })
    expect(lines(diffModels(base, m))).toEqual([
      '1 changed “Card valid?”: Gateway exclusive (X) → parallel (+)',
      '2 changed “Bring the book”: Renamed from “Fetch book”',
    ])
  })

  it('an added step is one change, its flows come with it, the next step does not move', () => {
    const base = library.reference()
    const m = copy(base)
    const rec = idOf(m, 'Record loan')
    const stamp = idOf(m, 'Stamp due date')
    deleteElements(m, [flowBetween(m, rec, stamp)])
    const t = addNode(m, { type: 'task', kind: 'service' }, { x: 700, y: 120 }, 'Email the member')
    connect(m, rec, t.id)
    connect(m, t.id, stamp)
    const d = diffModels(base, m)
    expect(d.changes).toHaveLength(1)
    expect(d.changes[0]).toMatchObject({ status: 'added', kind: 'node', id: t.id, label: '“Email the member”' })
    expect(d.changes[0].details[0]).toMatch(/^Service task in lane “.+”, after “Record loan”$/)
  })

  it('a removed step is one change, at its place in the order', () => {
    const base = library.reference()
    const m = copy(base)
    const stamp = idOf(m, 'Stamp due date')
    const before = m.flows.find((f) => f.target === stamp)!.source
    const after = m.flows.find((f) => f.source === stamp)!.target
    deleteElements(m, [stamp])
    connect(m, before, after)
    const d = diffModels(base, m)
    expect(lines(d)).toEqual([`1 removed “Stamp due date”: Task (was in lane “Front desk”, after “Record loan”)`])
    expect(d.changes[0].baseId).toBe(stamp)
  })

  it('two steps swapped: each says what it now follows', () => {
    const base = library.reference()
    const m = copy(base)
    const fetch = idOf(m, 'Fetch book')
    const rec = idOf(m, 'Record loan')
    const stamp = idOf(m, 'Stamp due date')
    const hand = idOf(m, 'Hand over book')
    deleteElements(m, [flowBetween(m, fetch, rec), flowBetween(m, rec, stamp), flowBetween(m, stamp, hand)])
    connect(m, fetch, stamp)
    connect(m, stamp, rec)
    connect(m, rec, hand)
    expect(lines(diffModels(base, m))).toEqual([
      '1 removed Flow from “Fetch book” to “Record loan”: ',
      '2 changed “Stamp due date”: Now after “Fetch book” (was after “Record loan”)',
      '3 removed Flow from “Record loan” to “Stamp due date”: ',
      '4 removed Flow from “Stamp due date” to “Hand over book”: ',
      '5 changed “Record loan”: Now after “Stamp due date” (was after “Fetch book”)',
      '6 changed “Hand over book”: Now after “Record loan” (was after “Stamp due date”)',
    ])
  })

  it('a removed sequence flow between steps that stay is listed; one with a removed step or an inserted step is not', () => {
    const base = library.reference()
    const m = copy(base)
    const rec = idOf(m, 'Record loan')
    const hand = idOf(m, 'Hand over book')
    const stamp = idOf(m, 'Stamp due date')
    const gone = flowBetween(m, stamp, hand)
    deleteElements(m, [gone])
    connect(m, rec, hand)
    const d = diffModels(base, m)
    const f = d.changes.find((c) => c.kind === 'flow')!
    expect(f).toMatchObject({ status: 'removed', baseId: gone, label: 'Flow from “Stamp due date” to “Hand over book”' })
    expect(f.id).toBeUndefined()
    expect(d.counts.removed).toBe(1)
  })

  it('"was after" names the direct steps before, not those behind a removed step, and never the container', () => {
    const base = library.reference()
    const m = copy(base)
    const rec = idOf(m, 'Record loan')
    const stamp = idOf(m, 'Stamp due date')
    const hand = idOf(m, 'Hand over book')
    // Stamp is removed and Hand over now follows Record loan: it was after Stamp, not after Record loan.
    deleteElements(m, [stamp])
    connect(m, rec, hand)
    const d = diffModels(base, m)
    expect(d.changes.find((c) => c.id === hand)).toBeUndefined()
    expect(lines(d)).toEqual(['1 removed “Stamp due date”: Task (was in lane “Front desk”, after “Record loan”)'])
  })

  it('"was after" says the removed step it directly followed', () => {
    const base = library.reference()
    const m = copy(base)
    const fetch = idOf(m, 'Fetch book')
    const stamp = idOf(m, 'Stamp due date')
    const hand = idOf(m, 'Hand over book')
    deleteElements(m, [stamp])
    connect(m, fetch, hand)
    expect(lines(diffModels(base, m)).find((l) => l.includes('changed “Hand over book”'))).toBe('2 changed “Hand over book”: Now after “Fetch book” (was after “Stamp due date”)')
  })

  it('an unnamed sub-process is told by its lane', () => {
    const base = library.reference()
    const m = copy(base)
    const sub = addNode(m, { type: 'subProcess' }, { x: 900, y: 60 })
    const lane = m.lanes.find((l) => l.name === 'Front desk')!
    sub.laneId = lane.id
    const d = diffModels(base, m)
    expect(d.changes[0].label).toBe('Unnamed sub-process in lane “Front desk”')
  })

  it('a step moved to another lane, a flow label, a task type', () => {
    const base = library.reference()
    const m = copy(base)
    const rec = idOf(m, 'Record loan')
    const s = m.diagram.shapes[rec]
    moveElements(m, { [rec]: { x: s.x, y: s.y + 200 } })
    const no = m.flows.find((f) => f.name === 'No')!
    no.name = 'Not valid'
    updateNode(m, idOf(m, 'Fetch book'), { kind: 'manual' })
    expect(lines(diffModels(base, m))).toEqual([
      '1 changed “Card valid?” → “Loan refused”: Label “No” → “Not valid”',
      '2 changed “Fetch book”: Task → manual task',
      '3 changed “Record loan”: Moved from lane “Front desk” to “Stacks”',
    ])
  })

  it('a message flow the other way round, one removed, one added', () => {
    const base = hotel.reference()
    const m = copy(base)
    const guest = idOf(m, 'Guest')
    const conf = idOf(m, 'Send confirmation')
    const f = m.flows.find((x) => x.kind === 'message' && x.source === conf)!
    ;[f.source, f.target] = [f.target, f.source]
    expect(lines(diffModels(base, m))).toEqual(['1 changed Message pool “Guest” → “Send confirmation”: Now goes the other way'])
    const m2 = copy(base)
    deleteElements(m2, [m2.flows.find((x) => x.kind === 'message' && x.source === conf)!.id])
    connect(m2, idOf(m2, 'Check room availability'), guest)
    expect(diffModels(base, m2).changes.map((c) => `${c.status} ${c.label}`)).toEqual(['added Message “Check room availability” → pool “Guest”', 'removed Message “Send confirmation” → pool “Guest”'])
  })

  it('an element with a note and no change is listed as a comment', () => {
    const base = library.reference()
    const m = copy(base)
    const fetch = idOf(m, 'Fetch book')
    const d = diffModels(base, m, { notes: [`r:${fetch}`, 'general'] })
    expect(lines(d)).toEqual(['1 comment “Fetch book”: '])
  })

  it('a name that only got its capital letter says so', () => {
    const base = library.reference()
    const m = copy(base)
    rename(base, idOf(base, 'Fetch book'), 'fetch book')
    expect(lines(diffModels(base, m))).toEqual(['1 changed “Fetch book”: Capital letters: was “fetch book”'])
  })

  it('figures of the time analysis', () => {
    const base = library.reference()
    const m = copy(base)
    setSim(m, idOf(m, 'Fetch book'), { duration: 0.5 })
    expect(lines(diffModels(base, m))).toEqual(['1 changed “Fetch book”: Work not set → 0.5 h'])
  })
})

describe('two models drawn apart', () => {
  it('other ids, same drawing: nothing changed', () => {
    const base = library.reference()
    const d = diffModels(base, rekey(base))
    expect(d.sameDrawing).toBe(false)
    expect(d.changes).toEqual([])
  })

  it('the same ids for other elements (Task_3 in both) are not trusted', () => {
    const base = library.reference()
    const ids = base.nodes.map((n) => n.id)
    const rot = new Map(ids.map((id, i) => [id, ids[(i + 1) % ids.length]]))
    const m = rekey(base, (x) => rot.get(x) ?? `z${x}`)
    const d = diffModels(base, m)
    expect(d.sameDrawing).toBe(false)
    expect(d.changes).toEqual([])
  })

  it('a step in other words is paired by its place, marked as uncertain', () => {
    const base = library.reference()
    const m = rekey(base)
    rename(m, idOf(m, 'Fetch book'), 'Walk to the shelves')
    const d = diffModels(base, m)
    expect(lines(d)).toEqual(['1 changed “Walk to the shelves”: Renamed from “Fetch book”'])
    expect(d.changes[0].uncertain).toBe(true)
  })

  it('Not the same: an uncertain pair splits into removed and added', () => {
    const base = library.reference()
    const m = rekey(base)
    const walk = idOf(m, 'Fetch book')
    rename(m, walk, 'Walk to the shelves')
    const d = diffModels(base, m, { unpair: [walk] })
    expect(d.changes.map((c) => `${c.status} ${c.label}`)).toEqual(['removed “Fetch book”', 'added “Walk to the shelves”'])
  })

  it('a gateway of another kind, paired by its neighbours', () => {
    const base = library.reference()
    const m = rekey(base)
    const gw = idOf(m, 'Card valid?')
    rename(m, gw, '')
    updateNode(m, gw, { kind: 'parallel' })
    expect(lines(diffModels(base, m))).toEqual(['1 changed Parallel (+) gateway: Name “Card valid?” removed; Gateway exclusive (X) → parallel (+)'])
  })
})

describe('AS-IS and TO-BE', () => {
  it('case 7: what the redesign added, removed and changed, in reading order', () => {
    const d = diffModels(parseModel(expenseAsIs), parseModel(expenseToBe))
    expect(d.counts.added).toBeGreaterThan(0)
    expect(d.counts.removed).toBeGreaterThan(0)
    expect(d.changes.map((c) => c.n)).toEqual(d.changes.map((_, i) => i + 1))
    // Every change names its element on the side it lives on.
    for (const c of d.changes) expect(c.status === 'removed' ? c.baseId : c.id).toBeTruthy()
  })
})

describe('the review in the file', () => {
  it('round-trips through .flow.json and drops a nested review of the base', () => {
    const base = library.reference()
    const m = copy(base)
    m.review = { base: { ...copy(base), review: { base: copy(base), notes: {} } }, notes: { general: { text: 'Lanes are good' }, 'r:x': { text: '', quote: '"as the text says"' }, 'r:y': { text: '' } }, unpair: ['a'] }
    const back = parseModel(serializeModel(m))
    expect(back.review!.base.review).toBeUndefined()
    expect(back.review!.notes).toEqual({ general: { text: 'Lanes are good' }, 'r:x': { quote: '"as the text says"' } })
    expect(back.review!.unpair).toEqual(['a'])
    expect(back.review!.base.nodes).toEqual(base.nodes)
  })

  it('a broken earlier version is refused with a reason', () => {
    const m = { ...library.reference(), review: { base: { format: 'nope' }, notes: {} } }
    expect(() => parseModel(JSON.stringify(m))).toThrow(/earlier version/)
  })
})

describe('the review as edits', () => {
  it('a review copy: the base is the draft, notes follow the changes, Not the same toggles', async () => {
    const { reviewCopy, reviewDiff, setReviewNote, toggleUnpair, endReview } = await import('../src/core/diff')
    const draft = library.reference()
    const m = reviewCopy(draft)
    expect(m.name).toMatch(/\(review\)$/)
    expect(m.review!.base.review).toBeUndefined()
    expect(reviewDiff(m)!.changes.map((c) => c.status)).toEqual([])
    const fetch = idOf(m, 'Fetch book')
    rename(m, fetch, 'Bring the book')
    setReviewNote(m, `r:${fetch}`, { text: 'The text says "brings"', quote: '“brings the book”' })
    expect(reviewDiff(m)!.changes[0]).toMatchObject({ status: 'changed', key: `r:${fetch}` })
    setReviewNote(m, `r:${fetch}`, { text: '', quote: '' })
    expect(m.review!.notes).toEqual({})
    toggleUnpair(m, fetch)
    expect(m.review!.unpair).toEqual([fetch])
    toggleUnpair(m, fetch)
    expect(m.review!.unpair).toBeUndefined()
    endReview(m)
    expect(reviewDiff(m)).toBeNull()
  })
})

describe('BPMN export', () => {
  it('leaves the review out: Bizagi gets the process only', async () => {
    const { writeBpmn } = await import('../src/core/bpmn/write')
    const { reviewCopy, setReviewNote } = await import('../src/core/diff')
    const m = reviewCopy(library.reference())
    setReviewNote(m, 'general', { text: 'Lanes are already good' })
    expect(await writeBpmn(m)).not.toContain('Lanes are already good')
  })
})
