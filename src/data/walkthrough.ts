// Walkthrough ("watch it built", StrataSQL pattern): a case's reference model built step by step. Every
// step shows a *subset* of the reference (same ids, same order), so the last step is the reference itself
// and the steps cannot drift from it. First the pools with their lanes, then the steps along the flow
// (a sub-process's content right after it, data with the first step it is linked to). The words come from
// the case's phrases (phrase → why) plus a sentence generated from the model. Some steps ask a
// prediction first (which gateway, which trigger): the canvas keeps the previous step until it is answered.
import { isArtifact, type FlowModel, type FlowNode, type GatewayKind } from '../core/metamodel'
import { pageOf } from '../core/ops'
import { snapshot, walkOrder } from '../core/reduce'
import type { TrainerCase } from './cases'
import { cardForElement } from './help'

export interface WalkQuestion {
  prompt: string
  options: string[]
  right: number
  /** Shown after the answer. */
  why: string
}

export interface WalkStep {
  /** `pool:<id>`, `node:<id>`, `done`. */
  key: string
  title: string
  /** Paragraphs, `**bold**` allowed. */
  text: string[]
  /** Indices into `c.spans`: the phrases this step turns into the model. */
  spans: number[]
  /** Elements added by this step (selected on the canvas). */
  focus: string[]
  /** The collapsed sub-process whose page shows the step (null = the main canvas). */
  page: string | null
  /** Help card of the concept. */
  help?: string
  question?: WalkQuestion
  model: FlowModel
}

const GATEWAYS: { kind: GatewayKind; label: string; meaning: string }[] = [
  { kind: 'exclusive', label: 'Exclusive gateway (XOR)', meaning: 'exactly one way is taken' },
  { kind: 'parallel', label: 'Parallel gateway (AND)', meaning: 'all ways run at the same time' },
  { kind: 'inclusive', label: 'Inclusive gateway (OR)', meaning: 'one or more ways are taken' },
  { kind: 'eventBased', label: 'Event-based gateway', meaning: 'the first event to happen decides' },
]
const TRIGGER_QUESTION = ['none', 'message', 'timer', 'error'] as const
const TRIGGER_LABEL: Record<(typeof TRIGGER_QUESTION)[number], string> = { none: 'A plain (none) event', message: 'A message event', timer: 'A timer event', error: 'An error event' }

export { snapshot, walkOrder }

const q = (s: string) => `“${s}”`
const an = (w: string) => (/^(?:[aeio]|u(?!s|ni))/i.test(w) ? `an ${w}` : `a ${w}`)

/** What a node is, in words: "a message start event", "a user task", "an exclusive gateway". */
export function nodeKind(n: FlowNode): string {
  switch (n.type) {
    case 'task':
      return an(`${n.kind === 'task' ? '' : `${n.kind === 'businessRule' ? 'business rule' : n.kind} `}task`)
    case 'subProcess':
      return `${n.collapsed ? 'a collapsed' : 'an expanded'} sub-process`
    case 'event': {
      const how = n.position === 'boundary' ? `${n.interrupting === false ? 'non-interrupting ' : ''}boundary` : n.position
      const io = n.position === 'intermediate' ? `${n.throwing ? 'throwing' : 'catching'} ` : ''
      return an(`${io}${n.trigger === 'none' ? '' : `${n.trigger} `}${how} event`)
    }
    case 'gateway':
      return an(`${GATEWAYS.find((g) => g.kind === n.kind)?.label.split(' (')[0].toLowerCase() ?? n.kind}`)
    case 'dataObject':
      return 'a data object'
    case 'dataStore':
      return 'a data store'
    default:
      return 'a text annotation'
  }
}

const built = new WeakMap<TrainerCase, WalkStep[]>()
/** The walkthrough of a case, built once per case object. */
export function walkthroughOf(c: TrainerCase): WalkStep[] {
  let steps = built.get(c)
  if (!steps) built.set(c, (steps = walkthroughSteps(c)))
  return steps
}

export function walkthroughSteps(c: TrainerCase, ref: FlowModel = c.reference()): WalkStep[] {
  const byId = new Map(ref.nodes.map((n) => [n.id, n]))
  const nameOf = (id: string) => byId.get(id)?.name || ref.participants.find((p) => p.id === id)?.name || ''
  const used = new Set<number>()
  /** Phrases naming any of these elements (each phrase is explained once). */
  const spansFor = (names: string[]) => {
    const hits: number[] = []
    c.spans.forEach((s, i) => {
      if (!used.has(i) && s.target.some((t) => t && names.includes(t))) (hits.push(i), used.add(i))
    })
    return hits
  }
  const shown = new Set<string>()
  const steps: WalkStep[] = []
  const push = (s: Omit<WalkStep, 'model'>) => steps.push({ ...s, model: snapshot(ref, shown) })

  // --- pools and their lanes
  for (const p of ref.participants) {
    const lanes = ref.lanes.filter((l) => l.participantId === p.id)
    shown.add(p.id)
    for (const l of lanes) shown.add(l.id)
    const white = !!p.processId && ref.nodes.some((n) => n.participantId === p.id && !isArtifact(n))
    const text = white
      ? [`**${p.name}** is a participant whose process we model: a pool.${lanes.length ? ` Its roles are lanes: ${lanes.map((l) => q(l.name)).join(', ')}.` : ''}`]
      : [`**${p.name}** takes part, but we do not see its steps: an empty pool (a black box). Messages end at its border.`]
    push({ key: `pool:${p.id}`, title: white ? `Pool ${q(p.name)}${lanes.length ? ' and its lanes' : ''}` : `${q(p.name)}, a black box`, text, spans: spansFor([p.name, ...lanes.map((l) => l.name)]), focus: [p.id, ...lanes.map((l) => l.id)], page: null, help: white ? (lanes.length ? 'lane' : 'pool') : 'black-box-pool' })
  }

  // --- the steps along the flow, data with the first step that uses it
  const order = walkOrder(ref)
  const linked = (id: string) => ref.flows.filter((f) => (f.kind === 'data' || f.kind === 'association') && (f.source === id || f.target === id)).map((f) => (f.source === id ? f.target : f.source))
  const artifacts = ref.nodes.filter(isArtifact)
  const pending = new Set(artifacts.map((a) => a.id))
  for (const id of order) {
    const n = byId.get(id)!
    shown.add(id)
    const extra = artifacts.filter((a) => pending.has(a.id) && linked(a.id).includes(id))
    for (const a of extra) (shown.add(a.id), pending.delete(a.id))
    const ins = ref.flows.filter((f) => f.kind === 'sequence' && f.target === id && shown.has(f.source))
    const outs = ref.flows.filter((f) => f.kind === 'sequence' && f.source === id)
    const lane = n.laneId && n.type !== 'gateway' ? ref.lanes.find((l) => l.id === n.laneId)?.name : undefined
    const host = n.type === 'event' && n.attachedTo ? nameOf(n.attachedTo) : ''
    let line = `${cap(nodeKind(n))}${n.name ? ` ${q(n.name)}` : ''}`
    if (host) line += ` on the border of ${q(host)}`
    else if (lane) line += ` in lane ${q(lane)}`
    if (ins.length === 1 && nameOf(ins[0].source)) line += `, after ${q(nameOf(ins[0].source))}`
    else if (ins.length > 1) line += `: ${ins.length} flows come together here`
    line += '.'
    if (n.type === 'gateway' && outs.length > 1) line += ` Ways out: ${outs.map((f) => `${f.name ? `${f.name} → ` : ''}${nameOf(f.target) ? q(nameOf(f.target)) : 'a gateway'}`).join('; ')}.`
    const msgs = ref.flows.filter((f) => f.kind === 'message' && (f.source === id || f.target === id) && shown.has(f.source) && shown.has(f.target))
    if (msgs.length) line += ` Message flow${msgs.length > 1 ? 's' : ''} ${msgs.map((f) => (f.source === id ? `to ${q(nameOf(f.target))}` : `from ${q(nameOf(f.source))}`)).join(', ')}.`
    if (extra.length) line += ` It uses ${extra.map((a) => `${nodeKind(a)} ${q(a.name)}`).join(', ')}.`
    const spans = spansFor([n.name, ...extra.map((a) => a.name)].filter(Boolean))
    // A merge gateway has no phrase of its own: it says why it is there.
    const text = [line]
    if (n.type === 'gateway' && ins.length > 1 && outs.length <= 1) text.push(n.kind === 'parallel' ? 'A parallel join waits for every branch before the process goes on.' : 'A join brings the branches together again, so the next step has one way in.')
    push({ key: `node:${id}`, title: n.name || cap(nodeKind(n).replace(/^an? /, '')), text, spans, focus: [id, ...extra.map((a) => a.id)], page: pageOf(ref, id) ?? null, help: cardForElement(n), question: question(n, outs.length, spans.length ? c.spans[spans[0]].why : undefined, ins.map((f) => nameOf(f.source)).filter(Boolean)) })
  }
  for (const a of artifacts) if (pending.has(a.id)) shown.add(a.id)

  push({ key: 'done', title: 'The whole process', text: ['Every phrase of the text is in the model now. The key decisions:', ...c.decisions], spans: [], focus: [], page: null })
  return steps
}

function question(n: FlowNode, outs: number, why: string | undefined, before: string[]): WalkQuestion | undefined {
  if (n.type === 'gateway' && outs > 1) {
    const right = GATEWAYS.findIndex((g) => g.kind === n.kind)
    if (right < 0) return undefined
    return {
      prompt: `The flow splits${before.length ? ` after ${q(before[0])}` : ''}. Which gateway?`,
      options: GATEWAYS.map((g) => g.label),
      right,
      why: why ?? `${GATEWAYS[right].label}: ${GATEWAYS[right].meaning}.`,
    }
  }
  if (n.type === 'event' && n.name && (n.position === 'start' || n.position === 'intermediate' || n.position === 'boundary')) {
    const right = TRIGGER_QUESTION.indexOf(n.trigger as (typeof TRIGGER_QUESTION)[number])
    // Only the events with a trigger worth asking (a plain start event is no question).
    if (right <= 0) return undefined
    return { prompt: `${q(n.name)}: what kind of event?`, options: TRIGGER_QUESTION.map((t) => TRIGGER_LABEL[t]), right, why: why ?? `${cap(nodeKind(n))}.` }
  }
  return undefined
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
