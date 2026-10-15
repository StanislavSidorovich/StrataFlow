// Help cards (SPEC §8): enough of them, every link points to a card, every check rule and element has one.
import { describe, expect, it } from 'vitest'
import { RULES } from '../src/core/lint'
import { cardById, cardForElement, HELP_CARDS } from '../src/data/help'
import { parseMini } from '../src/ui/panels/Help'

describe('help cards', () => {
  it('has at least 20 cards with unique ids and every field filled', () => {
    expect(HELP_CARDS.length).toBeGreaterThanOrEqual(20)
    expect(new Set(HELP_CARDS.map((c) => c.id)).size).toBe(HELP_CARDS.length)
    for (const c of HELP_CARDS) {
      expect(c.title && c.oneLiner && c.typicalMistake, c.id).toBeTruthy()
      expect(c.body.length, c.id).toBeGreaterThan(0)
      expect(c.whenToUse.length, c.id).toBeGreaterThan(0)
    }
  })

  it('links only to cards that exist', () => {
    for (const c of HELP_CARDS) for (const s of c.seeAlso) expect(cardById(s), `${c.id} → ${s}`).toBeDefined()
    for (const [rule, r] of Object.entries(RULES)) expect(cardById(r.card), rule).toBeDefined()
  })

  it('has a card for every element, flow kind, pool and lane', () => {
    const els = [
      { type: 'task' },
      { type: 'subProcess' },
      ...['exclusive', 'parallel', 'inclusive', 'eventBased', 'complex'].map((kind) => ({ type: 'gateway', kind })),
      ...['start', 'intermediate', 'end', 'boundary'].flatMap((position) => ['none', 'message', 'timer', 'error', 'terminate'].map((trigger) => ({ type: 'event', position, trigger }))),
      ...['dataObject', 'dataStore', 'annotation', 'pool', 'lane', 'sequence', 'message', 'data', 'association'].map((type) => ({ type })),
    ]
    for (const el of els) expect(cardById(cardForElement(el)), JSON.stringify(el)).toBeDefined()
  })

  it('reads the mini models', () => {
    expect(parseMini('start > task:Pack goods | Send invoice > and')).toEqual([
      [{ kind: 'start', label: '' }],
      [
        { kind: 'task', label: 'Pack goods' },
        { kind: 'task', label: 'Send invoice' },
      ],
      [{ kind: 'and', label: '' }],
    ])
    expect(parseMini('evb > msg:Accepted | timer:5 days')[1].map((p) => p.kind)).toEqual(['msg', 'timer'])
    for (const c of HELP_CARDS) if (c.miniModel) for (const col of parseMini(c.miniModel)) for (const p of col) expect(p.kind, c.id).toMatch(/^[a-zA-Z]+$/)
  })
})
