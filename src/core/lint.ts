// The model check (SPEC §7): rules P01–P17. Each issue names its elements and a help card.
// A warning is a question, not a verdict: the student decides. Conventions follow the NOVA BPM
// course (Dumas et al. 2013, Chapter 3) and the 7PMG from Chapter 4.
import { isArtifact, type FlowModel, type FlowNode } from './metamodel'

export type Severity = 'error' | 'warning' | 'info'
export type RuleId = `P${'01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17'}`

export interface Issue {
  rule: RuleId
  severity: Severity
  message: string
  /** Nodes, pools, lanes or flows to highlight; the first one is selected on click. */
  elements: string[]
  /** Help card id (see data/help). */
  card: string
}

export interface LintOptions {
  /** The case names roles: a pool with steps and no lanes gets a hint (P15). */
  expectLanes?: boolean
}

export const RULES: Record<RuleId, { severity: Severity; title: string; card: string }> = {
  P01: { severity: 'warning', title: 'Start and end event', card: 'start-event' },
  P02: { severity: 'error', title: 'Reachable from the start, leads to an end', card: 'soundness' },
  P03: { severity: 'error', title: 'Sequence flow across a pool border', card: 'sequence-vs-message' },
  P04: { severity: 'error', title: 'Message flow inside one pool', card: 'sequence-vs-message' },
  P05: { severity: 'warning', title: 'Gateway that splits and joins', card: 'split-join' },
  P06: { severity: 'warning', title: 'Decision with unnamed branches', card: 'exclusive-gateway' },
  P07: { severity: 'warning', title: 'Split and join of different kinds', card: 'split-join' },
  P08: { severity: 'info', title: 'Several flows into one activity', card: 'split-join' },
  P09: { severity: 'info', title: 'Activity name: verb + object', card: 'naming' },
  P10: { severity: 'error', title: 'Event-based gateway target', card: 'event-based-gateway' },
  P11: { severity: 'error', title: 'Boundary event leads nowhere', card: 'boundary-event' },
  P12: { severity: 'error', title: 'Flow into a start or out of an end', card: 'end-event' },
  P13: { severity: 'info', title: 'Large diagram', card: 'model-size' },
  P14: { severity: 'warning', title: 'Duplicate names', card: 'naming' },
  P15: { severity: 'info', title: 'Lanes', card: 'lane' },
  P16: { severity: 'info', title: 'Unnamed end states', card: 'end-event' },
  P17: { severity: 'warning', title: 'Loop without an exit', card: 'loop' },
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/** Steps of a process: not data, not annotations. */
const isStep = (n: FlowNode) => !isArtifact(n)
const isActivity = (n: FlowNode) => n.type === 'task' || n.type === 'subProcess'
const isBoundary = (n: FlowNode) => n.type === 'event' && n.position === 'boundary'
const label = (n: FlowNode | undefined) => (n?.name.trim() ? `"${n.name.trim().replace(/\s+/g, ' ')}"` : `an unnamed ${n ? kindName(n) : 'element'}`)

function kindName(n: FlowNode): string {
  switch (n.type) {
    case 'event':
      return `${n.position} event`
    case 'gateway':
      return `${n.kind === 'eventBased' ? 'event-based' : n.kind} gateway`
    case 'subProcess':
      return 'sub-process'
    case 'dataObject':
      return 'data object'
    case 'dataStore':
      return 'data store'
    default:
      return n.type
  }
}

/** The process level a node belongs to: its sub-process, else its pool, else the free canvas. A boundary event sits on its host's level. */
function levelOf(n: FlowNode): string {
  if (n.parentId) return `sub:${n.parentId}`
  return n.participantId ? `pool:${n.participantId}` : 'free'
}

interface Graph {
  out: Map<string, string[]>
  inc: Map<string, string[]>
}

function sequenceGraph(m: FlowModel, steps: FlowNode[]): Graph {
  const out = new Map<string, string[]>()
  const inc = new Map<string, string[]>()
  for (const n of steps) {
    out.set(n.id, [])
    inc.set(n.id, [])
  }
  for (const f of m.flows) {
    if (f.kind !== 'sequence' || !out.has(f.source) || !out.has(f.target)) continue
    out.get(f.source)!.push(f.target)
    inc.get(f.target)!.push(f.source)
  }
  return { out, inc }
}

function reach(from: Iterable<string>, next: (id: string) => string[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...from]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...next(id))
  }
  return seen
}

/** Strongly connected components (Tarjan), iterative enough for student-sized models. */
function components(ids: string[], next: (id: string) => string[]): string[][] {
  let index = 0
  const idx = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const out: string[][] = []
  const visit = (v: string) => {
    idx.set(v, index)
    low.set(v, index++)
    stack.push(v)
    onStack.add(v)
    for (const w of next(v)) {
      if (!idx.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!))
    }
    if (low.get(v) === idx.get(v)) {
      const c: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        c.push(w)
      } while (w !== v)
      out.push(c)
    }
  }
  for (const v of ids) if (!idx.has(v)) visit(v)
  return out
}

/** Where a message flow end sits: the pool of a node, or the pool itself. */
function poolOfEnd(m: FlowModel, id: string): string | undefined {
  const n = m.nodes.find((x) => x.id === id)
  if (n) return n.participantId
  return m.participants.some((p) => p.id === id) ? id : undefined
}

const NOUN_ENDINGS = /(tion|sion|ment|ance|ence|ity|ness|ure|al)$/i
const GENERIC_VERBS = new Set(['do', 'handle', 'process', 'manage', 'perform', 'execute', 'deal'])

/** Why an activity name is not "verb + object", or null when it reads like one. */
function nameProblem(name: string): string | null {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'has no name'
  const first = words[0].replace(/[^\p{L}-]/gu, '')
  if (words.length === 1) return `"${name.trim()}" is one word: say what is done to what (verb + object, e.g. "Check invoice")`
  if (NOUN_ENDINGS.test(first) && first.length > 4) return `"${name.trim()}" starts with "${first}", which reads as a noun or an adjective: start with a verb (e.g. "Approve order", not "Approval of order")`
  if (/ing$/i.test(first) && first.length > 5) return `"${name.trim()}" starts with "${first}": use the imperative (e.g. "Check invoice", not "Checking invoice")`
  if (GENERIC_VERBS.has(first.toLowerCase())) return `"${name.trim()}" uses the generic verb "${first}": name the actual work`
  if (words.length > 5) return `"${name.trim()}" has ${words.length} words: keep it to 5 or fewer, put details in an annotation`
  if (first[0] && first[0] !== first[0].toUpperCase()) return `"${name.trim()}" starts with a small letter: capitalise the first word`
  return null
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export function lintModel(m: FlowModel, opts: LintOptions = {}): Issue[] {
  const issues: Issue[] = []
  const add = (rule: RuleId, message: string, elements: string[]) => issues.push({ rule, severity: RULES[rule].severity, message, elements, card: RULES[rule].card })
  const byId = new Map(m.nodes.map((n) => [n.id, n]))
  const steps = m.nodes.filter(isStep)
  const g = sequenceGraph(m, steps)
  const seqFlows = m.flows.filter((f) => f.kind === 'sequence')
  const flowsOut = (id: string) => seqFlows.filter((f) => f.source === id)

  // Group steps by process level; a boundary event belongs to its host's level.
  const levels = new Map<string, FlowNode[]>()
  for (const n of steps) {
    const host = n.type === 'event' && n.attachedTo ? byId.get(n.attachedTo) : undefined
    const key = levelOf(host ?? n)
    levels.set(key, [...(levels.get(key) ?? []), n])
  }
  const boundaryOf = (id: string) => steps.filter((b) => b.type === 'event' && b.attachedTo === id).map((b) => b.id)
  // Reachability goes on through a boundary event once its host is reached.
  const forward = (id: string) => [...g.out.get(id)!, ...boundaryOf(id)]
  const backward = (id: string) => {
    const n = byId.get(id)!
    return [...g.inc.get(id)!, ...(n.type === 'event' && n.attachedTo && g.out.has(n.attachedTo) ? [n.attachedTo] : [])]
  }

  for (const [key, nodes] of levels) {
    const ids = nodes.map((n) => n.id)
    const starts = nodes.filter((n) => n.type === 'event' && n.position === 'start')
    const ends = nodes.filter((n) => n.type === 'event' && n.position === 'end')
    const topOfPool = key.startsWith('pool:') || key === 'free'
    const pool = key.startsWith('pool:') ? m.participants.find((p) => `pool:${p.id}` === key) : undefined
    const where = pool?.name.trim() ? ` in "${pool.name.trim()}"` : ''

    // P01: the top level of a pool needs an explicit start and end (course: always an explicit end event).
    if (topOfPool && nodes.length) {
      if (!starts.length) add('P01', `The process${where} has no start event: where does it begin?`, ids.slice(0, 1))
      if (!ends.length) add('P01', `The process${where} has no end event: show how it ends (the course always draws one).`, ids.slice(-1))
    }

    // P13 (7PMG G7): decompose above 30 flow objects.
    const counted = nodes.filter((n) => !isBoundary(n))
    if (counted.length > 30) add('P13', `${counted.length} steps on one level${where}: above ~30 a diagram is hard to read. Group parts into sub-processes (Ctrl+G).`, [])

    // P16: several end events = several end states; each should say which.
    if (ends.length > 1) {
      const unnamed = ends.filter((e) => !e.name.trim())
      if (unnamed.length) add('P16', `${ends.length} end events${where}, ${unnamed.length} without a name: name each end state (e.g. "Order shipped", "Order rejected").`, unnamed.map((e) => e.id))
    }

    // P17: a cycle no flow leaves (and holding no end event) runs forever.
    const sccs = components(ids, (id) => g.out.get(id) ?? [])
    const trapped = new Set<string>()
    for (const c of sccs) {
      const inC = new Set(c)
      const cyclic = c.length > 1 || (g.out.get(c[0]) ?? []).includes(c[0])
      if (!cyclic) continue
      const exits = c.some((id) => forward(id).some((t) => !inC.has(t)) || (byId.get(id)?.type === 'event' && (byId.get(id) as { position: string }).position === 'end'))
      if (exits) continue
      c.forEach((id) => trapped.add(id))
      const names = c.map((id) => byId.get(id)).filter((n) => n && isActivity(n)).map(label)
      add('P17', `A loop with no way out${names.length ? ` (${names.slice(0, 3).join(', ')})` : ''}: add a decision (exclusive gateway) or an event that leaves it.`, c)
    }

    // P02: every step reachable from a start event, and every step leading to an end event.
    // Without a start event a step that nothing leads to counts as a start (P01 already says it).
    const roots = starts.length ? starts.map((s) => s.id) : nodes.filter((n) => !isBoundary(n) && !g.inc.get(n.id)!.length).map((n) => n.id)
    const reached = reach(roots, forward)
    const sinks = ends.length ? ends.map((e) => e.id) : nodes.filter((n) => !g.out.get(n.id)!.length && !isBoundary(n)).map((n) => n.id)
    const toEnd = reach(sinks, backward)
    const toTrap = reach(trapped, backward)
    // Only the cause is reported: a step is left out when one before it (or after it) already has the
    // same problem and is not on a loop with it.
    const upstream = (id: string, bad: (x: string) => boolean) => backward(id).some((p) => bad(p) && !reach([id], forward).has(p))
    const downstream = (id: string, bad: (x: string) => boolean) => forward(id).some((s) => bad(s) && !reach([s], forward).has(id))
    const unreached = (id: string) => !reached.has(id)
    const noEnd = (id: string) => reached.has(id) && !toEnd.has(id) && !toTrap.has(id)
    for (const n of nodes) {
      if (unreached(n.id) ? upstream(n.id, unreached) : noEnd(n.id) && downstream(n.id, noEnd)) continue
      if (!reached.has(n.id)) {
        const why = g.inc.get(n.id)!.length || isBoundary(n) ? 'cannot be reached from a start event' : 'has no incoming flow, so it never runs'
        if (!(n.type === 'event' && n.position === 'start')) add('P02', `${cap(label(n))} ${why}.`, [n.id])
      } else if (!toEnd.has(n.id) && !toTrap.has(n.id) && !(isBoundary(n) && !g.out.get(n.id)!.length)) {
        const why = g.out.get(n.id)!.length ? 'has no path to an end event' : 'has no outgoing flow: the process stops here without an end event'
        add('P02', `${cap(label(n))} ${why}.`, [n.id])
      }
    }
  }

  for (const f of m.flows) {
    const s = byId.get(f.source)
    const t = byId.get(f.target)
    // P03: a sequence flow stays in one pool.
    if (f.kind === 'sequence' && s && t && s.participantId !== t.participantId)
      add('P03', `The flow from ${label(s)} to ${label(t)} crosses a pool border: between pools only message flows (dashed) are allowed.`, [f.id, s.id, t.id])
    // P04: a message flow joins two pools.
    if (f.kind === 'message') {
      const a = poolOfEnd(m, f.source)
      const b = poolOfEnd(m, f.target)
      if (a === b) add('P04', `The message flow ${s || t ? `from ${label(s)} to ${label(t)} ` : ''}stays inside one pool: inside a pool use a sequence flow; a message goes to another party.`, [f.id])
    }
  }

  for (const n of steps) {
    const ins = g.inc.get(n.id)!
    const outs = g.out.get(n.id)!
    const of = flowsOut(n.id)

    if (n.type === 'gateway') {
      // P05: one gateway, one job.
      if (ins.length > 1 && outs.length > 1) add('P05', `${cap(label(n))} both joins (${ins.length} in) and splits (${outs.length} out): use two gateways, one joins, the next splits.`, [n.id])
      // P06: the branches of a decision say when they are taken.
      if ((n.kind === 'exclusive' || n.kind === 'inclusive') && of.length > 1) {
        const bare = of.filter((f) => !f.name.trim() && !f.condition?.trim() && f.id !== n.defaultFlow)
        if (bare.length) add('P06', `${cap(label(n))} splits into ${of.length} branches, ${bare.length} without a name or condition: label each (e.g. Yes / No) or mark one as default.`, [n.id, ...bare.map((f) => f.id)])
      }
      // P10: after an event-based gateway, only things that wait.
      if (n.kind === 'eventBased')
        for (const t of outs.map((id) => byId.get(id)!)) {
          const ok = (t.type === 'event' && t.position === 'intermediate' && !t.throwing && ['message', 'timer', 'signal', 'conditional'].includes(t.trigger)) || (t.type === 'task' && t.kind === 'receive')
          if (!ok) add('P10', `${cap(label(n))} leads to ${label(t)}: after an event-based gateway come only catching events (message, timer…) or receive tasks.`, [n.id, t.id])
        }
    }

    if (n.type === 'event') {
      // P11
      if (n.position === 'boundary' && !outs.length) add('P11', `The boundary event ${label(n)} has no outgoing flow: draw what happens when it occurs.`, [n.id])
      // P12
      if (n.position === 'start' && ins.length) add('P12', `The start event ${label(n)} has an incoming flow: a start event only begins the process. Use an intermediate event or a gateway.`, [n.id])
      if (n.position === 'end' && outs.length) add('P12', `The end event ${label(n)} has an outgoing flow: an end event ends its path. Use an intermediate event instead.`, [n.id])
    }

    if (isActivity(n)) {
      // P08: an implicit merge works (course allows an XOR join straight into a task), but an explicit gateway reads clearer.
      if (ins.length > 1) add('P08', `${cap(label(n))} has ${ins.length} incoming flows without a join gateway: the course allows it (an implicit XOR merge), an explicit exclusive gateway shows it better.`, [n.id])
      // P09
      const why = nameProblem(n.name)
      if (why) add('P09', `${n.type === 'subProcess' ? 'A sub-process' : 'A task'} ${why}.`, [n.id])
    }
  }

  // P07: a join of another kind than its split.
  for (const j of steps) {
    if (j.type !== 'gateway' || g.inc.get(j.id)!.length < 2) continue
    const split = matchingSplit(j.id, g, byId)
    // A loop back into a parallel join waits forever for the token that is still in the loop.
    if (j.kind === 'parallel' && reach(g.out.get(j.id)!, (id) => g.out.get(id)!).has(j.id)) {
      add('P07', `${cap(label(j))} is a parallel (AND) join on a loop: it waits for every branch, and the one going back never comes. A rework loop needs an exclusive (XOR) join.`, [j.id])
      continue
    }
    if (!split) continue
    const sk = splitKind(byId.get(split)!)
    const jk = j.kind
    if (sk === jk || jk === 'complex' || sk === 'complex' || !sk) continue
    const s = byId.get(split)!
    const effect =
      sk === 'parallel' && jk === 'exclusive'
        ? 'every branch passes the XOR join, so what follows runs more than once'
        : (sk === 'exclusive' || sk === 'eventBased') && jk === 'parallel'
          ? 'only one branch arrives, so the AND join waits forever (deadlock)'
          : sk === 'inclusive' || jk === 'inclusive'
            ? 'an OR join belongs after an OR split'
            : 'the join does not match the split'
    add('P07', `${cap(label(s))} is closed by ${label(j)}: ${effect}. Close a split with a gateway of the same kind.`, [s.id, j.id])
  }

  // P14: two tasks (or two end events) with one name in a pool are confusing.
  const groups = new Map<string, FlowNode[]>()
  for (const n of steps) {
    const kind = isActivity(n) ? 'activity' : n.type === 'event' && n.position === 'end' ? 'end' : null
    if (!kind || !n.name.trim()) continue
    const k = `${n.participantId ?? ''}|${kind}|${norm(n.name)}`
    groups.set(k, [...(groups.get(k) ?? []), n])
  }
  for (const same of groups.values())
    if (same.length > 1) add('P14', `${same.length} ${isActivity(same[0]) ? 'activities' : 'end events'} are called ${label(same[0])}: if they are the same step, draw it once; if not, make the names say the difference.`, same.map((n) => n.id))

  // P15: an empty lane, or a pool without lanes when the case names roles.
  for (const l of m.lanes) {
    const inside = (id?: string): boolean => !!id && (id === l.id || inside(m.lanes.find((x) => x.id === id)?.parentLaneId))
    const hasChildren = m.lanes.some((x) => x.parentLaneId === l.id)
    if (!hasChildren && !steps.some((n) => inside(n.laneId))) add('P15', `The lane ${l.name.trim() ? `"${l.name.trim()}"` : '(unnamed)'} is empty: put this role's steps in it, or delete it.`, [l.id])
  }
  if (opts.expectLanes)
    for (const p of m.participants)
      if (p.processId && !m.lanes.some((l) => l.participantId === p.id) && steps.some((n) => n.participantId === p.id))
        add('P15', `The pool ${p.name.trim() ? `"${p.name.trim()}"` : ''} has no lanes, but the case names several roles: add a lane per role.`, [p.id])

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rule.localeCompare(b.rule))
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A node with more than one way out: a gateway, or an activity / event (an implicit AND split). */
function splitKind(n: FlowNode): string | undefined {
  if (n.type === 'gateway') return n.kind
  return 'parallel'
}

/**
 * The split a join closes: the nearest node with several ways out that every incoming branch comes
 * from (walking back, not past the join itself). Undefined when the branches share none (a loop back).
 */
function matchingSplit(joinId: string, g: Graph, byId: Map<string, FlowNode>): string | undefined {
  const dist: Map<string, number>[] = g.inc.get(joinId)!.map((first) => {
    const d = new Map<string, number>()
    const queue: [string, number][] = [[first, 1]]
    while (queue.length) {
      const [id, k] = queue.shift()!
      if (id === joinId || d.has(id)) continue
      d.set(id, k)
      for (const p of g.inc.get(id) ?? []) queue.push([p, k + 1])
    }
    return d
  })
  let best: string | undefined
  let bestDist = Infinity
  for (const [id] of dist[0]) {
    if ((g.out.get(id)?.length ?? 0) < 2 || !dist.every((d) => d.has(id))) continue
    const n = byId.get(id)
    if (!n || (n.type !== 'gateway' && !isActivity(n) && n.type !== 'event')) continue
    const far = Math.max(...dist.map((d) => d.get(id)!))
    if (far < bestDist) {
      best = id
      bestDist = far
    }
  }
  return best
}

/** Counts per severity, for the status bar. */
export function summarize(issues: Issue[]): Record<Severity, number> {
  const out = { error: 0, warning: 0, info: 0 }
  for (const i of issues) out[i.severity]++
  return out
}

