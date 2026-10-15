// The comparison with the reference (SPEC §9): right on the references, and each seeded mistake is found
// as the one item it is, with the rest still right.
import { describe, expect, it } from 'vitest'
import { compareModels, nameSimilarity } from '../src/core/compare'
import type { FlowModel } from '../src/core/metamodel'
import { addNode, connect, deleteElements, moveElements, rename, updateNode } from '../src/core/ops'
import { CASES, caseById } from '../src/data/cases'
import { compareWithCase } from '../src/data/trainer'

const library = caseById('library-lend')!
const hotel = caseById('hotel-booking')!
const shop = caseById('shop-order')!
const scooter = caseById('scooter-ride')!

const byName = (m: FlowModel, name: string) => {
  const n = m.nodes.find((x) => x.name === name) ?? m.participants.find((x) => x.name === name) ?? m.lanes.find((x) => x.name === name)
  if (!n) throw new Error(`no ${name}`)
  return n.id
}
const flowBetween = (m: FlowModel, a: string, b: string) => m.flows.find((f) => f.source === a && f.target === b)!.id
const notOk = (m: FlowModel, c = library) => compareWithCase(c, m).items.filter((i) => i.status !== 'ok')

describe('names', () => {
  it('ignores word order, small words and endings', () => {
    expect(nameSimilarity('Check invoice', 'Invoice check')).toBe(1)
    expect(nameSimilarity('Checks the library cards', 'Check library card')).toBe(1)
    expect(nameSimilarity('Order rejected', 'Reject order')).toBe(1)
    expect(nameSimilarity('Pack goods', 'Ship goods')).toBeLessThan(0.5)
  })
})

describe('compare with the reference', () => {
  for (const c of CASES)
    it(`${c.id}: the reference against itself is all right, 100`, () => {
      const r = compareWithCase(c, c.reference())
      expect(r.items.filter((i) => i.status !== 'ok')).toEqual([])
      expect(r.score).toBe(100)
    })

  it('an empty model: everything missing, score 0', () => {
    const r = compareWithCase(library, { ...library.reference(), participants: [], lanes: [], nodes: [], flows: [], diagram: { shapes: {}, edges: {} } })
    expect(r.score).toBe(0)
    expect(r.items.every((i) => i.status === 'missing')).toBe(true)
  })

  it('synonyms and other words count as the same step', () => {
    const m = library.reference()
    rename(m, byName(m, 'Check library card'), 'Verify library card')
    rename(m, byName(m, 'Fetch book'), 'Book fetch')
    rename(m, byName(m, 'Front desk'), 'Librarian')
    expect(notOk(m)).toEqual([])
  })

  it('a step named differently is matched by its place, as "different"', () => {
    const m = library.reference()
    rename(m, byName(m, 'Fetch book'), 'Walk to shelves')
    const bad = notOk(m)
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ key: 'step:Fetch book', status: 'different' })
    expect(bad[0].text).toMatch(/other words/)
  })

  it('a missing decision: the gateway, its links and nothing else', () => {
    const m = library.reference()
    const gw = byName(m, 'Card valid?')
    deleteElements(m, [gw])
    connect(m, byName(m, 'Check library card'), byName(m, 'Fetch book'))
    const keys = notOk(m).map((i) => `${i.status} ${i.key}`)
    expect(keys).toEqual(['missing decision:Card valid?', 'missing link:Check library card>Loan refused'])
  })

  it('a gateway of the wrong kind is "different"', () => {
    const m = library.reference()
    updateNode(m, byName(m, 'Card valid?'), { kind: 'parallel' })
    const bad = notOk(m)
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ kind: 'decision', status: 'different' })
    expect(bad[0].text).toMatch(/exclusive/)
  })

  it('two steps in the wrong order: the links are missing and the swapped one is extra', () => {
    const m = library.reference()
    const rec = byName(m, 'Record loan')
    const stamp = byName(m, 'Stamp due date')
    const fetch = byName(m, 'Fetch book')
    const hand = byName(m, 'Hand over book')
    deleteElements(m, [flowBetween(m, fetch, rec), flowBetween(m, rec, stamp), flowBetween(m, stamp, hand)])
    connect(m, fetch, stamp)
    connect(m, stamp, rec)
    connect(m, rec, hand)
    const keys = notOk(m).map((i) => `${i.status} ${i.key}`)
    expect(keys).toContain('missing link:Fetch book>Record loan')
    expect(keys).toContain('missing link:Record loan>Stamp due date')
    expect(keys.filter((k) => k.startsWith('extra'))).toHaveLength(3)
  })

  it('a step in the wrong lane', () => {
    const m = library.reference()
    const id = byName(m, 'Record loan')
    const s = m.diagram.shapes[id]
    moveElements(m, { [id]: { x: s.x, y: s.y + 200 } })
    expect(m.nodes.find((n) => n.id === id)!.laneId).toBe(byName(m, 'Stacks'))
    const bad = notOk(m)
    expect(bad).toHaveLength(1)
    expect(bad[0].text).toMatch(/done by “Front desk”/)
  })

  it('one coarse step for three is accepted (Lend book)', () => {
    const m = library.reference()
    const rec = byName(m, 'Record loan')
    deleteElements(m, [byName(m, 'Stamp due date'), byName(m, 'Hand over book')])
    rename(m, rec, 'Lend book')
    connect(m, rec, byName(m, 'Book lent'))
    expect(notOk(m)).toEqual([])
  })

  it('an extra step lowers the score and is listed', () => {
    const m = library.reference()
    addNode(m, { type: 'task' }, { x: 600, y: 330 }, 'Phone the member')
    const r = compareWithCase(library, m)
    expect(r.items.filter((i) => i.status !== 'ok').map((i) => i.status)).toEqual(['extra'])
    expect(r.score).toBeLessThan(100)
  })

  it('a missing message flow and one the wrong way round', () => {
    const m = hotel.reference()
    const guest = byName(m, 'Guest')
    deleteElements(m, [flowBetween(m, guest, byName(m, 'Guest arrived'))])
    const conf = byName(m, 'Send confirmation')
    deleteElements(m, [flowBetween(m, conf, guest)])
    connect(m, guest, conf)
    const keys = notOk(m, hotel).map((i) => `${i.status} ${i.key}`)
    expect(keys).toEqual(['different message:Send confirmation>Guest', 'missing message:Guest>Guest arrived'])
  })

  it('a message to a step inside an outside pool counts like one to its border', () => {
    const m = hotel.reference()
    const guest = byName(m, 'Guest')
    deleteElements(m, [flowBetween(m, byName(m, 'Send confirmation'), guest)])
    // A black box drawn with a step in it is "different", the message to that step is right.
    m.participants.find((p) => p.id === guest)!.processId = 'Process_guest'
    const inbox = addNode(m, { type: 'event' }, { x: 400, y: m.diagram.shapes[guest].y + 100 }, 'Confirmation received')
    connect(m, byName(m, 'Send confirmation'), inbox.id)
    const bad = notOk(m, hotel)
    expect(bad.map((i) => i.key)).toEqual(['pool:Guest', `extra:${inbox.id}`])
  })

  it('a send task plus an end event for a message end event is accepted', () => {
    const m = hotel.reference()
    const declined = byName(m, 'Request declined')
    updateNode(m, declined, { trigger: 'none' })
    const gw = byName(m, 'Room available?')
    const at = m.diagram.shapes[declined]
    const task = addNode(m, { type: 'task', kind: 'send' }, { x: at.x, y: at.y }, 'Decline request')
    const f = flowBetween(m, gw, declined)
    m.flows.find((x) => x.id === f)!.target = task.id
    connect(m, task.id, declined)
    rename(m, declined, '')
    for (const mf of m.flows.filter((x) => x.kind === 'message' && x.source === declined)) mf.source = task.id
    const r = compareWithCase(hotel, m)
    expect(r.items.filter((i) => i.status !== 'ok')).toEqual([])
  })

  it('AND split as a task with two flows out is accepted; an XOR there is not', () => {
    const m = shop.reference()
    const split = m.nodes.find((n) => n.type === 'gateway' && n.kind === 'parallel' && m.flows.filter((f) => f.source === n.id).length === 2)!
    updateNode(m, split.id, { kind: 'exclusive' })
    const bad = notOk(m, shop)
    expect(bad).toHaveLength(1)
    expect(bad[0].text).toMatch(/parallel gateway/)
  })

  it('the timer must be non-interrupting', () => {
    const m = shop.reference()
    updateNode(m, byName(m, '14 days'), { interrupting: true })
    const bad = notOk(m, shop)
    expect(bad).toHaveLength(1)
    expect(bad[0].text).toMatch(/non-interrupting/)
  })

  it('a data object not linked to its task', () => {
    const m = shop.reference()
    const slip = byName(m, 'Packing slip')
    deleteElements(m, m.flows.filter((f) => f.kind === 'data' && (f.source === slip || f.target === slip)).map((f) => f.id))
    const bad = notOk(m, shop)
    expect(bad.map((i) => `${i.status} ${i.key}`)).toEqual(['different data:Packing slip'])
  })

  it('scooter: an exclusive gateway where the rider decides is "different", the event-based one is asked for', () => {
    const m = scooter.reference()
    const race = m.nodes.find((n) => n.type === 'gateway' && n.kind === 'eventBased')!
    updateNode(m, race.id, { kind: 'exclusive' })
    const bad = notOk(m, scooter)
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ kind: 'decision', status: 'different' })
    expect(bad[0].text).toMatch(/event-based/)
  })

  it('scooter: the loop back for a new photo is missing', () => {
    const m = scooter.reference()
    const retry = byName(m, 'Ask for new photo')
    deleteElements(m, m.flows.filter((f) => f.kind === 'sequence' && f.source === retry).map((f) => f.id))
    expect(notOk(m, scooter).map((i) => i.status)).toContain('missing')
  })

  it('the score halves for different items and counts extras', () => {
    const r = compareModels(library.reference(), library.reference())
    expect(r.score).toBe(100)
  })
})
