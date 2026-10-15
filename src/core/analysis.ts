// Time, cost and resource analysis of a process (stage 6). The method is flow analysis as taught with
// Dumas et al., Fundamentals of Business Process Management (quantitative process analysis):
// - in a sequence, times and costs add up;
// - after a decision, the branches count with their probabilities;
// - after a parallel split, the longest branch sets the time (costs and work still add up);
// - a rework loop follows from the same rules: T / (1 − r) when the case goes back with probability r;
// - cycle time efficiency = theoretical cycle time (processing only) / cycle time;
// - resource utilisation = arrival rate × work per case / capacity (one lane = one resource pool).
// One process level is solved at a time (a pool's top level, a sub-process's content) by iterating the
// expected value of every step until it settles, which handles loops of any shape. Boundary events and
// messages from other pools are not part of the figures (the notes say so when the model has them).
import type { Flow, FlowModel, FlowNode, TimeUnit } from './metamodel'
import { isArtifact } from './metamodel'

export const UNIT_NAMES: Record<TimeUnit, string> = { min: 'min', h: 'h', d: 'days' }

/** One activity (or waiting event) with what it costs per run and how often it runs per case. */
export interface StepFigures {
  id: string
  name: string
  laneId?: string
  /** Expected runs per case (0.8 = in 80 % of the cases; 1.25 = once plus a 25 % rework). */
  runs: number
  duration: number
  wait: number
  cost: number
  /** An activity without a duration (counted as 0). */
  missing: boolean
  /** A catching intermediate event: it only waits. */
  event: boolean
}

export interface ResourceFigures {
  laneId: string
  name: string
  capacity: number
  /** Processing time per case spent in this lane. */
  work: number
  /** Share of the lane's time in use, when the arrival rate is known (above 1 = overloaded). */
  utilisation?: number
}

export interface Analysis {
  /** The pool analysed (undefined = steps outside every pool). */
  poolId?: string
  name: string
  /** Undefined when a loop never lets the case go. */
  cycleTime?: number
  /** Theoretical cycle time: processing only, no waiting. */
  processingTime?: number
  waitingTime?: number
  efficiency?: number
  cost?: number
  steps: StepFigures[]
  resources: ResourceFigures[]
  notes: string[]
}

interface Totals {
  time: number
  proc: number
  cost: number
}
const ZERO: Totals = { time: 0, proc: 0, cost: 0 }
const plus = (a: Totals, b: Totals): Totals => ({ time: a.time + b.time, proc: a.proc + b.proc, cost: a.cost + b.cost })
const scale = (a: Totals, k: number): Totals => ({ time: a.time * k, proc: a.proc * k, cost: a.cost * k })
/** Branches running at the same time: the longest sets the time, the costs add up. */
const together = (xs: Totals[]): Totals => ({ time: Math.max(0, ...xs.map((x) => x.time)), proc: Math.max(0, ...xs.map((x) => x.proc)), cost: xs.reduce((s, x) => s + x.cost, 0) })

const DECIDES = ['exclusive', 'inclusive', 'complex', 'eventBased']
const name = (n: FlowNode) => n.name || n.id

export const isDecision = (n: FlowNode | undefined, outs: number) => n?.type === 'gateway' && DECIDES.includes(n.kind) && outs > 1
export const isParallelSplit = (n: FlowNode | undefined, outs: number) => outs > 1 && !!n && !(n.type === 'gateway' && DECIDES.includes(n.kind))
export const isParallelJoin = (m: FlowModel, n: FlowNode | undefined) =>
  n?.type === 'gateway' && n.kind === 'parallel' && m.flows.filter((f) => f.kind === 'sequence' && f.target === n.id).length > 1

/**
 * The share of cases taking each branch of a decision. Branches without a probability share what the
 * others leave; when the given ones do not add up to 100 %, they are scaled (and the note says so).
 */
export function branchShares(flows: Flow[], note?: (text: string) => void, gatewayName = 'a decision'): Map<string, number> {
  const out = new Map<string, number>()
  const given = flows.filter((f) => f.probability !== undefined)
  const sum = given.reduce((s, f) => s + f.probability!, 0)
  const rest = flows.length - given.length
  if (!given.length) note?.(`${gatewayName}: no probabilities yet, the branches count as equally likely`)
  if (rest && sum <= 1 + 1e-9) {
    for (const f of given) out.set(f.id, f.probability!)
    for (const f of flows) if (f.probability === undefined) out.set(f.id, (1 - sum) / rest)
  } else {
    if (Math.abs(sum - 1) > 1e-6) note?.(`${gatewayName}: the probabilities add up to ${Math.round(sum * 100)} %, scaled to 100 %`)
    for (const f of flows) out.set(f.id, sum > 0 ? (f.probability ?? 0) / sum : 1 / flows.length)
  }
  return out
}

/** The join where the branches of a parallel split meet again: the nearest node every branch reaches. */
export function matchingJoin(m: FlowModel, splitId: string, level: Set<string>): string | undefined {
  const outs = m.flows.filter((f) => f.kind === 'sequence' && f.source === splitId && level.has(f.target))
  const dists = outs.map((f) => {
    const d = new Map<string, number>([[f.target, 0]])
    const queue = [f.target]
    while (queue.length) {
      const at = queue.shift()!
      for (const g of m.flows)
        if (g.kind === 'sequence' && g.source === at && level.has(g.target) && g.target !== splitId && !d.has(g.target)) {
          d.set(g.target, d.get(at)! + 1)
          queue.push(g.target)
        }
    }
    return d
  })
  let best: string | undefined
  let bestScore = Infinity
  for (const [id] of dists[0] ?? []) {
    if (!dists.every((d) => d.has(id))) continue
    const n = m.nodes.find((x) => x.id === id)
    const score = Math.max(...dists.map((d) => d.get(id)!)) * 2 + (n?.type === 'gateway' && n.kind === 'parallel' ? 0 : 1)
    if (score < bestScore) (best = id), (bestScore = score)
  }
  return best
}

/** The analysis of every process in the model: each white-box pool, and the steps outside pools. */
export function analyseModel(m: FlowModel): Analysis[] {
  const out: Analysis[] = []
  for (const p of m.participants) {
    if (!p.processId) continue
    const top = m.nodes.filter((n) => n.participantId === p.id && !n.parentId)
    if (top.some((n) => !isArtifact(n))) out.push(analyse(m, top, p.id, p.name || 'Pool'))
  }
  const free = m.nodes.filter((n) => (!n.participantId || !m.participants.some((p) => p.id === n.participantId)) && !n.parentId)
  if (free.some((n) => !isArtifact(n))) out.push(analyse(m, free, undefined, m.name || 'Process'))
  return out
}

function analyse(m: FlowModel, top: FlowNode[], poolId: string | undefined, title: string): Analysis {
  const notes = new Set<string>()
  const note = (t: string) => notes.add(t)
  const steps: StepFigures[] = []
  const byId = new Map(m.nodes.map((n) => [n.id, n]))
  const seq = m.flows.filter((f) => f.kind === 'sequence')

  /** Expected time, processing and cost of a level, and how often each of its steps runs per case. */
  const level = (nodes: FlowNode[], weight: number): Totals | undefined => {
    const steps0 = nodes.filter((n) => !isArtifact(n) && !(n.type === 'event' && n.position === 'boundary'))
    const ids = new Set(steps0.map((n) => n.id))
    if (nodes.some((n) => n.type === 'event' && n.position === 'boundary' && seq.some((f) => f.source === n.id)))
      note('Paths after boundary events are not counted (they are exceptions: give them a probability by modelling the case as a decision if they matter)')
    const outMap = new Map(steps0.map((n) => [n.id, seq.filter((f) => f.source === n.id && ids.has(f.target))]))
    const inMap = new Map(steps0.map((n) => [n.id, seq.filter((f) => f.target === n.id && ids.has(f.source))]))
    const outs = (id: string) => outMap.get(id)!
    const ins = (id: string) => inMap.get(id)!
    const joins = new Map<string, string | undefined>()
    const joinOf = (id: string) => {
      if (!joins.has(id)) joins.set(id, matchingJoin(m, id, ids))
      return joins.get(id)
    }
    const shares = new Map<string, Map<string, number>>()
    for (const n of steps0) {
      const o = outs(n.id)
      if (isDecision(n, o.length)) {
        if (n.type === 'gateway' && n.kind === 'inclusive') note(`${name(n)}: an inclusive (OR) split counts here as one branch per case`)
        shares.set(n.id, branchShares(o, note, name(n)))
      }
    }

    const own = new Map<string, Totals>()
    for (const n of steps0) own.set(n.id, ownOf(n, weight))

    // Expected totals from each node to the end of the level (or to `stop`), iterated until they settle.
    const memo = new Map<string, Map<string, Totals> | null>()
    let diverged = false
    const solve = (stop: string | undefined): Map<string, Totals> => {
      const key = stop ?? ''
      const known = memo.get(key)
      if (known) return known
      const val = new Map<string, Totals>(steps0.map((n) => [n.id, ZERO]))
      if (known === null) return val // a split inside its own branch: should not happen in a sound model
      memo.set(key, null)
      for (let iter = 0; iter < 20000; iter++) {
        let delta = 0
        for (const n of steps0) {
          if (n.id === stop) continue
          const o = outs(n.id)
          let next = ZERO
          if (isDecision(n, o.length)) {
            const sh = shares.get(n.id)!
            for (const f of o) next = plus(next, scale(val.get(f.target)!, sh.get(f.id)!))
          } else if (isParallelSplit(n, o.length)) {
            const join = joinOf(n.id)
            if (join) {
              const sub = solve(join)
              next = plus(together(o.map((f) => (f.target === join ? ZERO : sub.get(f.target)!))), val.get(join)!)
            } else next = together(o.map((f) => val.get(f.target)!))
          } else if (o.length) next = val.get(o[0].target)!
          const v = plus(own.get(n.id)!, next)
          const old = val.get(n.id)!
          delta = Math.max(delta, Math.abs(v.time - old.time) + Math.abs(v.cost - old.cost) + Math.abs(v.proc - old.proc))
          val.set(n.id, v)
        }
        if (delta < 1e-9) {
          memo.set(key, val)
          return val
        }
      }
      diverged = true
      memo.set(key, val)
      return val
    }

    const starts = steps0.filter((n) => n.type === 'event' && n.position === 'start')
    const first = starts.length ? starts : steps0.filter((n) => !ins(n.id).length)
    if (!first.length) {
      note(`${title}: no start event, nothing to count`)
      return ZERO
    }
    if (first.length > 1) note(`${first.length} start events in one process: each counts for an equal share of the cases`)
    const val = solve(undefined)
    if (diverged) {
      note('A loop never lets the case go (no branch leaves it, or it is taken back with 100 %): give the way out a probability')
      return undefined
    }
    const total = first.reduce((s, n) => plus(s, scale(val.get(n.id)!, 1 / first.length)), ZERO)

    // Runs per case: what flows into a step, with the shares of decisions; a parallel join runs once per case.
    const runs = new Map<string, number>(steps0.map((n) => [n.id, 0]))
    for (let iter = 0; iter < 20000; iter++) {
      let delta = 0
      for (const n of steps0) {
        const into = ins(n.id).map((f) => {
          const src = byId.get(f.source)!
          const share = shares.get(src.id)?.get(f.id) ?? 1
          return runs.get(src.id)! * share
        })
        const base = first.includes(n) ? 1 / first.length : 0
        const v = base + (isParallelJoin(m, n) ? Math.max(0, ...into) : into.reduce((s, x) => s + x, 0))
        delta = Math.max(delta, Math.abs(v - runs.get(n.id)!))
        runs.set(n.id, v)
      }
      if (delta < 1e-12) break
    }
    for (const n of steps0) {
      const r = runs.get(n.id)! * weight
      const row = steps.find((s) => s.id === n.id)
      if (row) row.runs = r
      // The content of a sub-process runs as often as the sub-process (times its repeats).
      if (n.type === 'subProcess') {
        const inner = m.nodes.filter((x) => x.parentId === n.id)
        const reps = n.loop ? (n.sim?.repeats ?? 1) : 1
        for (const s of steps) if (inner.some((x) => x.id === s.id) || isInside(m, s.id, n.id)) s.runs *= runs.get(n.id)! * reps
      }
    }
    return total
  }

  /** What one run of a step adds: its waiting time and its work (a sub-process: its content), with repeats. */
  function ownOf(n: FlowNode, weight: number): Totals {
    const sim = n.sim ?? {}
    const wait = sim.wait ?? 0
    if (n.type === 'event') {
      if (n.position === 'intermediate' && !n.throwing) steps.push({ id: n.id, name: name(n), laneId: n.laneId, runs: 0, duration: 0, wait, cost: 0, missing: false, event: true })
      return { time: wait, proc: 0, cost: 0 }
    }
    if (n.type !== 'task' && n.type !== 'subProcess') return ZERO
    const content = n.type === 'subProcess' ? m.nodes.filter((x) => x.parentId === n.id) : []
    const reps = n.loop ? (sim.repeats ?? 1) : 1
    if (n.loop && sim.repeats === undefined) note(`${name(n)} repeats: give it the number of runs per visit (now 1)`)
    let work: Totals
    if (content.some((x) => !isArtifact(x))) {
      const inner = level(content, weight)
      if (!inner) return ZERO
      work = inner
      if (sim.duration !== undefined) note(`${name(n)}: its steps are counted, not its own duration`)
    } else {
      const d = sim.duration ?? 0
      steps.push({ id: n.id, name: name(n), laneId: n.laneId, runs: 0, duration: d, wait, cost: sim.cost ?? 0, missing: sim.duration === undefined, event: false })
      work = { time: d, proc: d, cost: sim.cost ?? 0 }
    }
    // Parallel instances run at the same time: the time of one, the cost of all.
    const repeated = n.loop === 'parallel' ? { ...work, cost: work.cost * reps } : scale(work, reps)
    return plus(repeated, { time: wait, proc: 0, cost: content.length ? (sim.cost ?? 0) : 0 })
  }

  const total = level(top, 1)
  const missing = steps.filter((s) => s.missing && s.runs > 0)
  if (missing.length) note(`${missing.length} of ${steps.filter((s) => !s.event).length} activities have no duration yet (counted as 0)`)
  if (m.flows.some((f) => f.kind === 'message' && [f.source, f.target].some((id) => top.some((n) => n.id === id) || id === poolId)))
    note('Waiting for another pool is not counted by itself: give the catching event or receive task a waiting time')

  // Resources: the work per case in each lane, and how busy the lane is at the given arrival rate.
  const resources: ResourceFigures[] = []
  const arrivals = m.sim?.arrivals
  for (const l of m.lanes) {
    if (poolId && l.participantId !== poolId) continue
    const mine = steps.filter((s) => !s.event && s.laneId === l.id)
    if (!mine.length) continue
    const work = mine.reduce((s, x) => {
      const n = byId.get(x.id)!
      const reps = (n.type === 'task' || n.type === 'subProcess') && n.loop ? (n.sim?.repeats ?? 1) : 1
      return s + x.runs * x.duration * reps
    }, 0)
    const capacity = l.capacity ?? 1
    resources.push({ laneId: l.id, name: l.name || 'Lane', capacity, work, utilisation: arrivals ? (arrivals * work) / capacity : undefined })
  }
  for (const r of resources) if (r.utilisation !== undefined && r.utilisation > 1) note(`${r.name} is overloaded (${Math.round(r.utilisation * 100)} %): the queue grows without end; add capacity or cut the work`)

  const a: Analysis = { poolId, name: title, steps, resources, notes: [...notes] }
  if (total) {
    a.cycleTime = total.time
    a.processingTime = total.proc
    a.waitingTime = total.time - total.proc
    a.efficiency = total.time > 0 ? total.proc / total.time : undefined
    a.cost = total.cost
  }
  return a
}

function isInside(m: FlowModel, id: string, holder: string): boolean {
  for (let n = m.nodes.find((x) => x.id === id); n?.parentId; n = m.nodes.find((x) => x.id === n!.parentId)) if (n.parentId === holder) return true
  return false
}
