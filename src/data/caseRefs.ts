// Help cards' `caseRefs` (SPEC §8): the cases whose reference model uses a card's idea, found from the
// models themselves (so they cannot go stale), plus the ones a card names by hand (`HelpCard.caseRefs`).
// Each points at the walkthrough step where the idea first appears.
import type { FlowModel, FlowNode } from '../core/metamodel'
import { CASES, FILE_CASES, type TrainerCase } from './cases'
import { cardById, cardForElement } from './help'
import { walkthroughOf } from './walkthrough'

export interface CaseRef {
  caseId: string
  title: string
  /** The walkthrough step to open. */
  step: number
}

/** The cards an element stands for (its own card and the ideas it shows). */
function cardsOfNode(m: FlowModel, n: FlowNode): string[] {
  const cards = [cardForElement(n)]
  if (n.type === 'task' && n.kind !== 'task') cards.push('task-types')
  if ((n.type === 'task' || n.type === 'subProcess') && n.loop) cards.push('loop')
  if (n.type === 'gateway') {
    cards.push('split-join')
    if (n.defaultFlow) cards.push('default-flow')
  }
  if (n.type === 'event' && n.trigger === 'message') cards.push('sequence-vs-message')
  if (n.type === 'event' && n.position === 'boundary') cards.push('boundary-event')
  if (n.type === 'subProcess' && m.flows.some((f) => f.kind === 'sequence' && f.target === n.id && m.nodes.find((x) => x.id === f.source)?.type === 'gateway')) cards.push('sub-process')
  return cards
}

function refsOf(c: TrainerCase): Map<string, number> {
  const first = new Map<string, number>()
  const steps = walkthroughOf(c)
  steps.forEach((s, i) => {
    const m = s.model
    const add = (card: string) => first.has(card) || first.set(card, i)
    for (const id of s.focus) {
      const n = m.nodes.find((x) => x.id === id)
      if (n) cardsOfNode(m, n).forEach(add)
      const p = m.participants.find((x) => x.id === id)
      if (p) add(p.processId && m.nodes.some((x) => x.participantId === p.id) ? 'pool' : 'black-box-pool')
      if (m.lanes.some((l) => l.id === id)) add('lane')
    }
    const before = new Set(i ? steps[i - 1].model.flows.map((f) => f.id) : [])
    for (const f of m.flows.filter((x) => !before.has(x.id))) add(f.kind === 'message' ? 'sequence-vs-message' : f.kind === 'sequence' ? 'sequence-flow' : cardForElement({ type: f.kind }))
  })
  return first
}

const cache = new WeakMap<TrainerCase, Map<string, number>>()

export function caseRefs(cardId: string): CaseRef[] {
  const named = cardById(cardId)?.caseRefs ?? []
  const out: CaseRef[] = []
  for (const c of [...CASES, ...FILE_CASES]) {
    let refs = cache.get(c)
    if (!refs) cache.set(c, (refs = refsOf(c)))
    const step = refs.get(cardId) ?? (named.includes(c.id) ? 0 : undefined)
    if (step !== undefined) out.push({ caseId: c.id, title: c.title, step })
  }
  return out
}
