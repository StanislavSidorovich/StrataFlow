// "Do it for me": following it item by item turns any start (empty canvas, level 2, a wrong model) into the reference.
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { doItForMe } from '../src/core/assist'
import { compareModels } from '../src/core/compare'
import type { FlowModel } from '../src/core/metamodel'
import { CASES } from '../src/data/cases'
import { checkGoals, compareWithCase, DONE_AT, levelStartModel, redesignScore, viewCase } from '../src/data/trainer'

function solve(c: (typeof CASES)[number], start: FlowModel, limit = 250, figures = false) {
  const ref = c.reference()
  const opts = { synonyms: c.synonyms, groups: c.groups, figures }
  let m = start
  const said: string[] = []
  for (let i = 0; i < limit; i++) {
    const r = compareModels(ref, m, opts)
    if (r.items.every((x) => x.status === 'ok')) return { m, said, score: r.score }
    m = produce(m, (d) => {
      said.push(doItForMe(ref, d, opts))
    })
  }
  return { m, said, score: compareModels(ref, m, opts).score }
}

describe('do it for me', () => {
  for (const c of CASES)
    describe(c.id, () => {
      it('builds the reference from an empty canvas', () => {
        const { score, said } = solve(c, levelStartModel(c, 3))
        expect(score, said.join('\n')).toBe(100)
      })
      it('completes level 2', () => {
        const { score, said } = solve(c, levelStartModel(c, 2))
        expect(score, said.join('\n')).toBe(100)
      })
    })

  it('repairs a wrong model: gateway kind, lane, task type, a reversed message, extras', () => {
    const c = CASES.find((x) => x.id === 'hotel-booking')!
    const wrong = produce(c.reference(), (m) => {
      const gw = m.nodes.find((n) => n.type === 'gateway')!
      if (gw.type === 'gateway') gw.kind = 'parallel'
      const check = m.nodes.find((n) => n.name === 'Check guest ID')!
      const res = m.lanes.find((l) => l.name === 'Reservations')!
      const ls = m.diagram.shapes[res.id]
      m.diagram.shapes[check.id].y = ls.y + 20
      check.laneId = res.id
      const send = m.nodes.find((n) => n.name === 'Send confirmation')!
      if (send.type === 'task') send.kind = 'task'
      const msg = m.flows.find((f) => f.kind === 'message')!
      ;[msg.source, msg.target] = [msg.target, msg.source]
      m.nodes.push({ id: 'Task_99', name: 'Call the manager', type: 'task', kind: 'task', participantId: check.participantId, laneId: res.id })
      m.diagram.shapes.Task_99 = { x: 900, y: ls.y + 30, width: 100, height: 80 }
    })
    expect(compareModels(c.reference(), wrong, { synonyms: c.synonyms }).score).toBeLessThan(100)
    const { score, said } = solve(c, wrong)
    expect(score, said.join('\n')).toBe(100)
    expect(said.join('\n')).toMatch(/Removed “Call the manager”/)
  })

  it('says when there is nothing to do', () => {
    const c = CASES[0]
    expect(() => produce(c.reference(), (d) => void doItForMe(c.reference(), d, { synonyms: c.synonyms }))).toThrow(/Nothing left/)
  })
})

describe('redesign level (case 7)', () => {
  const c = CASES.find((x) => x.id === 'expense-claim')!
  const v = viewCase(c, 4)

  it('starts from the AS-IS, which misses both goals', () => {
    const m = levelStartModel(c, 4)
    expect(m.nodes.map((n) => n.name)).toEqual(c.reference().nodes.map((n) => n.name))
    const g = checkGoals(c, m)!
    expect(g.cycleTime).toBeCloseTo(113.1, 0)
    expect(g.cost).toBeCloseTo(45.83, 1)
    expect(g.timeOk || g.costOk).toBe(false)
    const r = compareWithCase(c, m, 4)
    expect(r.items.some((i) => i.kind === 'figure' && i.status === 'different')).toBe(true)
    expect(redesignScore(r, g)).toBeLessThan(DONE_AT)
  })

  it('the TO-BE reaches both goals and scores 100', () => {
    const m = v.reference()
    const g = checkGoals(c, m)!
    expect(g).toMatchObject({ timeOk: true, costOk: true })
    expect(redesignScore(compareWithCase(c, m, 4), g)).toBe(100)
  })

  it('a wrong figure is named, with the value the text gives', () => {
    const m = produce(v.reference(), (d) => {
      const pay = d.nodes.find((n) => n.name === 'Pay claim')!
      pay.sim = { ...pay.sim, wait: 80 }
    })
    const item = compareWithCase(c, m, 4).items.find((i) => i.key === 'figure:Pay claim')!
    expect(item.status).toBe('different')
    expect(item.text).toMatch(/waiting time should be 20 h \(yours 80 h\)/)
    expect(checkGoals(c, m)!.timeOk).toBe(false)
  })

  it('do it for me turns the AS-IS into the TO-BE, figures and shares included', () => {
    const { m, score, said } = solve(v, levelStartModel(c, 4), 250, true)
    expect(score, said.join('\n')).toBe(100)
    expect(checkGoals(c, m)).toMatchObject({ timeOk: true, costOk: true })
    expect(said.join('\n')).toMatch(/Typed the figures/)
  })
})
