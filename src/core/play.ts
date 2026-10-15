// Token play-through (stage 6): one case runs through one process, step by step, as BPMN's token game.
// A token sits on the step it is about to run. A decision waits for the user's choice (or takes a branch by
// the probabilities when playing on its own); a parallel split makes a token per branch and a parallel join
// waits until one has come along each incoming flow; a sub-process starts its own start events and is done
// when nothing inside runs any more. Each token carries the time spent so far (the analysis figures), so
// the case's time at the end is that of the path played. Boundary events and other pools are not played.
import type { Flow, FlowModel, FlowNode } from './metamodel'
import { isArtifact } from './metamodel'
import { branchShares, isDecision, isParallelJoin } from './analysis'

export interface Token {
  id: number
  at: string
  time: number
}

export interface PlayState {
  /** The pool played (undefined = steps outside every pool). */
  poolId?: string
  tokens: Token[]
  /** A parallel join → the flows a token has come along, with that token's time. */
  waiting: Record<string, { flow: string; time: number }[]>
  /** The decision the next token waits at, with its branches. */
  choice?: { node: string; flows: string[] }
  /** Flows passed in the last step (the canvas lights them up). */
  passed: string[]
  /** What happened, one line per step. */
  log: string[]
  done: boolean
  /** The case's time so far: the latest token time reached. */
  time: number
  steps: number
  next: number
}

const seqOut = (m: FlowModel, id: string) => m.flows.filter((f) => f.kind === 'sequence' && f.source === id)
const label = (n: FlowNode | undefined) => (n ? n.name || n.type : '?')
const startsIn = (m: FlowModel, poolId: string | undefined, parentId: string | undefined) =>
  m.nodes
    .filter((n) => n.type === 'event' && n.position === 'start' && n.parentId === parentId && (parentId || n.participantId === poolId || (!poolId && !m.participants.some((p) => p.id === n.participantId))))
    .sort((a, b) => (m.diagram.shapes[a.id]?.x ?? 0) - (m.diagram.shapes[b.id]?.x ?? 0))

/** Time one run of a node takes (wait + duration; a sub-process's content is played, so only its wait). */
function ownTime(n: FlowNode): number {
  const s = n.sim ?? {}
  if (n.type === 'task') return (s.wait ?? 0) + (s.duration ?? 0) * (n.loop && n.loop !== 'parallel' ? (s.repeats ?? 1) : 1)
  return s.wait ?? 0
}

/** A token on the first start event of the pool (by position, left first). */
export function startPlay(m: FlowModel, poolId?: string): PlayState {
  const s: PlayState = { poolId, tokens: [], waiting: {}, passed: [], log: [], done: false, time: 0, steps: 0, next: 1 }
  const [first, ...more] = startsIn(m, poolId, undefined)
  if (!first) return { ...s, done: true, log: ['No start event: nothing to play'] }
  s.tokens.push({ id: s.next++, at: first.id, time: 0 })
  s.log.push(`Case starts: ${label(first)}${more.length ? ` (${more.length} other start event${more.length > 1 ? 's' : ''} not played)` : ''}`)
  return s
}

/** The token that runs next and, when it waits at a decision, its branches. */
export function pending(m: FlowModel, s: PlayState): { token: Token; branches?: Flow[] } | undefined {
  const token = s.tokens[0]
  if (!token) return undefined
  const n = m.nodes.find((x) => x.id === token.at)
  const outs = seqOut(m, token.at)
  return { token, branches: isDecision(n, outs.length) ? outs : undefined }
}

/** Picks a branch of a decision by its probability. */
export function pickBranch(branches: Flow[], random = Math.random): string {
  const shares = branchShares(branches)
  let r = random()
  for (const f of branches) {
    r -= shares.get(f.id)!
    if (r < 0) return f.id
  }
  return branches[branches.length - 1].id
}

/**
 * Runs the next token's step. At a decision, `choice` is the branch to take; without it the state comes
 * back unchanged with `choice` set, so the user can pick.
 */
export function stepPlay(m: FlowModel, prev: PlayState, choice?: string): PlayState {
  if (prev.done || !prev.tokens.length) return prev
  const s: PlayState = { ...prev, tokens: prev.tokens.slice(1), waiting: { ...prev.waiting }, log: [...prev.log], passed: [], choice: undefined, steps: prev.steps + 1 }
  const token = prev.tokens[0]
  const n = m.nodes.find((x) => x.id === token.at)
  if (!n) return { ...s, done: true }
  const outs = seqOut(m, n.id)
  if (isDecision(n, outs.length) && !outs.some((f) => f.id === choice)) return { ...prev, choice: { node: n.id, flows: outs.map((f) => f.id) } }
  const time = token.time + ownTime(n)
  s.time = Math.max(s.time, time)

  // A sub-process with steps inside: its start events take over.
  const inner = n.type === 'subProcess' ? startsIn(m, undefined, n.id) : []
  if (inner.length) {
    s.log.push(`${label(n)}: inside`)
    for (const st of inner.slice(0, 1)) s.tokens.unshift({ id: s.next++, at: st.id, time })
    return s
  }

  if (n.type === 'event' && n.position === 'end') {
    s.log.push(`${label(n)}: a path ends${n.trigger === 'terminate' ? ', and stops everything else in its process' : ''}`)
    if (n.trigger === 'terminate') {
      s.tokens = s.tokens.filter((t) => !within(m, t.at, n.parentId))
      for (const j of Object.keys(s.waiting)) if (within(m, j, n.parentId)) delete s.waiting[j]
    }
    return leaveIfDone(m, s, n.parentId, time)
  }

  let take: Flow[]
  if (isDecision(n, outs.length)) {
    take = outs.filter((f) => f.id === choice)
    s.log.push(`${label(n)} → ${take[0].name || label(m.nodes.find((x) => x.id === take[0].target))}`)
  } else {
    take = outs
    if (!isArtifact(n) && n.type !== 'gateway' && n.type !== 'event') s.log.push(`${label(n)}${time > token.time ? ` (+${round(time - token.time)})` : ''}`)
    if (outs.length > 1) s.log.push(`${label(n)}: ${outs.length} branches at the same time`)
  }
  if (!take.length) {
    s.log.push(`${label(n)}: no way on, the path stops here`)
    return leaveIfDone(m, s, n.parentId, time)
  }
  for (const f of take) moveAlong(m, s, f, time)
  return s.tokens.length ? s : leaveIfDone(m, s, undefined, time)
}

/** Steps on until the case ends, a decision needs the user, or `limit` steps (a loop) have run. */
export function playOn(m: FlowModel, s: PlayState, opts: { random?: () => number; limit?: number; decide?: boolean } = {}): PlayState {
  let cur = s
  for (let i = 0; i < (opts.limit ?? 500) && !cur.done; i++) {
    const p = pending(m, cur)
    if (!p) break
    const pick = p.branches ? (opts.decide ? pickBranch(p.branches, opts.random) : undefined) : undefined
    if (p.branches && !pick) return { ...cur, choice: { node: p.token.at, flows: p.branches.map((f) => f.id) } }
    cur = stepPlay(m, cur, pick)
  }
  return cur
}

function moveAlong(m: FlowModel, s: PlayState, f: Flow, time: number) {
  s.passed.push(f.id)
  const t = m.nodes.find((x) => x.id === f.target)
  if (t && isParallelJoin(m, t)) {
    const arrived = [...(s.waiting[t.id] ?? []).filter((w) => w.flow !== f.id), { flow: f.id, time }]
    const need = m.flows.filter((g) => g.kind === 'sequence' && g.target === t.id)
    if (need.every((g) => arrived.some((w) => w.flow === g.id))) {
      delete s.waiting[t.id]
      s.tokens.push({ id: s.next++, at: t.id, time: Math.max(...arrived.map((w) => w.time)) })
    } else s.waiting[t.id] = arrived
    return
  }
  s.tokens.push({ id: s.next++, at: f.target, time })
}

/** After a path ends: the sub-process it was in goes on when nothing inside runs; the case ends when nothing runs. */
function leaveIfDone(m: FlowModel, s: PlayState, parentId: string | undefined, time: number): PlayState {
  if (parentId) {
    const busy = s.tokens.some((t) => within(m, t.at, parentId)) || Object.keys(s.waiting).some((j) => within(m, j, parentId))
    if (busy) return s
    const sp = m.nodes.find((x) => x.id === parentId)!
    s.log.push(`${label(sp)}: done`)
    const outs = seqOut(m, sp.id)
    for (const f of outs) moveAlong(m, s, f, time)
    if (!outs.length) return leaveIfDone(m, s, sp.parentId, time)
    return s
  }
  if (!s.tokens.length) {
    s.done = true
    const stuck = Object.keys(s.waiting)
    s.log.push(stuck.length ? `Stuck: ${stuck.map((j) => label(m.nodes.find((x) => x.id === j))).join(', ')} waits for a branch that never comes (a parallel join after a decision?)` : `Case done after ${round(s.time)}`)
  }
  return s
}

/** The node is inside the sub-process (at any depth). */
function within(m: FlowModel, id: string, holder: string | undefined): boolean {
  if (!holder) return true
  for (let n = m.nodes.find((x) => x.id === id); n?.parentId; n = m.nodes.find((x) => x.id === n!.parentId)) if (n.parentId === holder) return true
  return false
}

const round = (x: number) => Math.round(x * 100) / 100
