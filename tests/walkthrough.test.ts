// Walkthrough: every case is built step by step, each step a subset of the next, the last one the reference.
import { describe, expect, it } from 'vitest'
import { CASES } from '../src/data/cases'
import { walkOrder, walkthroughSteps } from '../src/data/walkthrough'

const ids = (m: { participants: { id: string }[]; lanes: { id: string }[]; nodes: { id: string }[]; flows: { id: string }[] }) =>
  new Set([...m.participants, ...m.lanes, ...m.nodes, ...m.flows].map((x) => x.id))

describe('walkthrough', () => {
  for (const c of CASES)
    describe(c.id, () => {
      const ref = c.reference()
      const steps = walkthroughSteps(c, ref)

      it('ends with the reference model and only adds on the way', () => {
        expect(steps.at(-1)!.model).toEqual(ref)
        for (let i = 1; i < steps.length; i++) {
          const before = ids(steps[i - 1].model)
          const after = ids(steps[i].model)
          for (const id of before) expect(after.has(id), `${steps[i].key} keeps ${id}`).toBe(true)
        }
      })

      it('shows every node once, pools first, a start event first in each pool', () => {
        const order = walkOrder(ref)
        const steps2 = ref.nodes.filter((n) => n.type !== 'dataObject' && n.type !== 'dataStore' && n.type !== 'annotation')
        expect(new Set(order)).toEqual(new Set(steps2.map((n) => n.id)))
        expect(order).toHaveLength(steps2.length)
        const focus = steps.flatMap((s) => s.focus)
        for (const n of ref.nodes) expect(focus, n.name || n.id).toContain(n.id)
        expect(steps.slice(0, ref.participants.length).every((s) => s.key.startsWith('pool:'))).toBe(true)
        const first = ref.nodes.find((n) => n.id === order[0])!
        expect(first.type === 'event' && first.position).toBe('start')
      })

      it('explains every phrase of the text on some step', () => {
        const spans = new Set(steps.flatMap((s) => s.spans))
        const lost = c.spans.filter((_, i) => !spans.has(i)).map((s) => s.phrase)
        expect(lost).toEqual([])
      })

      it('asks before each split gateway and the right answer is its kind', () => {
        for (const s of steps) {
          const n = ref.nodes.find((x) => `node:${x.id}` === s.key)
          const outs = n ? ref.flows.filter((f) => f.kind === 'sequence' && f.source === n.id).length : 0
          if (n?.type === 'gateway' && outs > 1 && n.kind !== 'complex') expect(s.question, s.title).toBeDefined()
          if (s.question) expect(s.question.right).toBeGreaterThanOrEqual(0)
        }
      })

      it('a step inside a collapsed sub-process is shown on its page', () => {
        for (const s of steps) if (s.page) expect(ref.nodes.find((n) => n.id === s.page)).toMatchObject({ type: 'subProcess', collapsed: true })
      })
    })
})

describe('help cards point at the cases that use them', () => {
  it('finds the cases from the reference models, at the step where the idea appears', async () => {
    const { caseRefs } = await import('../src/data/caseRefs')
    const ids = (card: string) => caseRefs(card).map((r) => r.caseId)
    expect(ids('exclusive-gateway')).toContain('library-lend')
    expect(ids('event-based-gateway')).toEqual(['scooter-ride'])
    expect(ids('inclusive-gateway')).toEqual(['hospital-admission'])
    expect(ids('black-box-pool')).toContain('hotel-booking')
    expect(ids('as-is-to-be')).toEqual(['expense-claim'])
    expect(ids('error-event')).toContain('football-match')
    for (const r of caseRefs('exclusive-gateway')) {
      const c = CASES.find((x) => x.id === r.caseId)!
      const step = walkthroughSteps(c)[r.step]
      expect(step.focus.some((id) => step.model.nodes.find((n) => n.id === id)?.type === 'gateway'), `${c.id} step ${r.step}`).toBe(true)
    }
    const { HELP_CARDS } = await import('../src/data/help')
    const without = HELP_CARDS.filter((c) => !caseRefs(c.id).length).map((c) => c.id)
    expect(without.length).toBeLessThan(HELP_CARDS.length / 2)
  })
})
