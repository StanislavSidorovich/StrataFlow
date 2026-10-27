// Review replay (SPEC §10.1): a model with a `review` told as a story. Frame 0 is the base, then one frame per fix
// in review order (each applies only that fix's changes to the frame before), then the changes in no fix in the
// order the Changes panel numbers them; the last of these is the corrected model, and an overview closes the story.
// A frame is built by composing the base and the corrected model element by element: an element whose change is
// applied has its corrected form, one whose change is not has its base form (an added one is not there yet, a
// removed one still is). A change that cannot stand without another (a step moved into a sub-process that is
// added by a later fix) pulls that other change in, and the comment says so ("Together with fix N").
import { reviewDiff, withoutReview, type Change, type ModelDiff } from './diff'
import type { Bounds, Flow, FlowModel, FlowNode, Lane, Participant, Point } from './metamodel'
import { pageOf } from './ops'
import type { Beat, Story, StoryFrame } from './story'
import { STORY_FORMAT, STORY_VERSION } from './story'

/** What a review frame draws besides the model: the marks of its changes and the ghosts of what was removed. */
export interface ReviewLayer {
  /** Changed elements (by id in the frame's model), as the Changes panel colours and numbers them. */
  marks: Record<string, { status: Change['status']; n: number }>
  /** Removed steps, where they stood (the base's shape). */
  removedNodes: { id: string; el: FlowNode; box: Bounds; n: number; page: string | null }[]
  /** Removed sequence flows, between steps that stay. */
  removedFlows: { id: string; source: string; target: string; name: string; points?: Point[]; n: number; page: string | null }[]
}

export interface Replay {
  story: Story
  frames: StoryFrame[]
}

interface Ctx {
  base: FlowModel
  rev: FlowModel
  diff: ModelDiff
  byKey: Map<string, Change>
  /** base id → revised id */
  map: Record<string, string>
  /** revised id → base id */
  back: Map<string, string>
}

const tr = (c: Ctx, id: string | undefined): string | undefined => (id === undefined ? undefined : (c.map[id] ?? id))

function baseNode(c: Ctx, b: FlowNode, id: string): FlowNode {
  const n = { ...structuredClone(b), id } as FlowNode & Record<string, unknown>
  for (const k of ['participantId', 'laneId', 'parentId', 'attachedTo']) if (n[k] !== undefined) n[k] = tr(c, n[k] as string)
  if (n.type === 'gateway' && n.defaultFlow) n.defaultFlow = c.map[n.defaultFlow] ?? n.defaultFlow
  return n as FlowNode
}

const baseFlow = (c: Ctx, b: Flow, id: string): Flow => ({ ...structuredClone(b), id, source: tr(c, b.source)!, target: tr(c, b.target)! })

const sameBox = (a: Bounds | undefined, b: Bounds | undefined) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

interface Composed {
  model: FlowModel
  /** Nodes, lanes and pools drawn in their base form. */
  usedBase: Set<string>
}

/** The model with exactly these changes applied (keys of `diff.changes`). */
function compose(c: Ctx, applied: Set<string>): Composed {
  const { base, rev } = c
  const on = (k: string) => applied.has(k)
  const status = (k: string) => c.byKey.get(k)?.status
  const usedBase = new Set<string>()
  const shapes: Record<string, Bounds> = {}

  /** Corrected elements in their form for this state, then the removed ones still standing. */
  function pick<T extends { id: string }>(revList: T[], baseList: T[], make: (b: T, id: string) => T): T[] {
    const out: T[] = []
    for (const r of revList) {
      const key = `r:${r.id}`
      const st = status(key)
      if (st === 'added' && !on(key)) continue
      const b = c.back.get(r.id)
      const old = st === 'changed' && !on(key) && b ? baseList.find((x) => x.id === b) : undefined
      if (old) {
        out.push(make(old, r.id))
        usedBase.add(r.id)
        const s = base.diagram.shapes[old.id]
        if (s) shapes[r.id] = s
      } else {
        out.push(r)
        const s = rev.diagram.shapes[r.id]
        if (s) shapes[r.id] = s
      }
    }
    for (const b of baseList) {
      if (c.map[b.id] || on(`b:${b.id}`)) continue
      out.push(make(b, b.id))
      usedBase.add(b.id)
      const s = base.diagram.shapes[b.id]
      if (s) shapes[b.id] = s
    }
    return out
  }

  const participants = pick<Participant>(rev.participants, base.participants, (b, id) => ({ ...structuredClone(b), id }))
  const lanes = pick<Lane>(rev.lanes, base.lanes, (b, id) => ({ ...structuredClone(b), id, participantId: tr(c, b.participantId) as string, ...(b.parentLaneId ? { parentLaneId: tr(c, b.parentLaneId) } : {}) }))
  const nodes = pick<FlowNode>(rev.nodes, base.nodes, (b, id) => baseNode(c, b, id))
  const here = new Set([...participants, ...nodes].map((x) => x.id))
  const addedNode = (id: string) => status(`r:${id}`) === 'added'

  // ---- flows
  const flows: Flow[] = []
  const edges: Record<string, Point[]> = {}
  const flowIn = new Set<string>()
  const take = (f: Flow, points: Point[] | undefined, fromBase: boolean) => {
    if (!here.has(f.source) || !here.has(f.target) || flowIn.has(f.id)) return
    flowIn.add(f.id)
    flows.push(f)
    // Waypoints only where both ends stand where the form they belong to had them.
    const own = fromBase ? base : rev
    const ends = [f.source, f.target].map((id) => ({ drawn: shapes[id], own: own.diagram.shapes[fromBase ? (backOf(c, id) ?? id) : id] }))
    if (points && ends.every((e) => sameBox(e.drawn, e.own))) edges[f.id] = points
  }
  const paired = new Set<string>()
  for (const f of rev.flows) {
    const b = c.back.get(f.id)
    const bf = b ? base.flows.find((x) => x.id === b) : undefined
    if (!bf) continue
    paired.add(f.id)
    const key = `r:${f.id}`
    if (status(key) === 'changed' && !on(key)) take(baseFlow(c, bf, f.id), base.diagram.edges[bf.id], true)
    else take(f, rev.diagram.edges[f.id], false)
  }
  // New flows: with their added end, else with the change of an end; none says: only in the corrected model.
  const govern = (f: Flow): string | null => {
    for (const k of [`r:${f.id}`, `r:${f.target}`, `r:${f.source}`]) {
      const st = status(k)
      if (st && st !== 'added' && st !== 'comment') return k
    }
    return null
  }
  const allKeys = [...c.byKey.keys()].filter((k) => status(k) !== 'comment')
  const everything = allKeys.every(on)
  for (const f of rev.flows) {
    if (paired.has(f.id)) continue
    if (addedNode(f.source) || addedNode(f.target)) take(f, rev.diagram.edges[f.id], false)
    else {
      const k = govern(f)
      if (k ? on(k) : everything) take(f, rev.diagram.edges[f.id], false)
    }
  }
  // Flows of the base that are gone: with their removal, or with the removed end, else once a detour or the new order stands.
  const out = new Map<string, Flow[]>()
  for (const f of flows) if (f.kind === 'sequence') (out.get(f.source) ?? out.set(f.source, []).get(f.source)!).push(f)
  const detoured = (from: string, to: string) => {
    const seen = new Set<string>()
    const stack = [from]
    while (stack.length) {
      for (const f of out.get(stack.pop()!) ?? []) {
        if (f.target === to) return true
        if (addedNode(f.target) && !seen.has(f.target)) (seen.add(f.target), stack.push(f.target))
      }
    }
    return false
  }
  for (const bf of base.flows) {
    if (c.map[bf.id]) continue
    const f = baseFlow(c, bf, bf.id)
    const own = status(`b:${bf.id}`)
    if (own === 'removed') {
      if (!on(`b:${bf.id}`)) take(f, base.diagram.edges[bf.id], true)
      continue
    }
    if (!here.has(f.source) || !here.has(f.target)) continue
    // The step or the order it ran by changed, or steps now stand between its ends: it is gone with that.
    const k = [`r:${f.target}`, `r:${f.source}`].find((x) => status(x) && status(x) !== 'added' && status(x) !== 'comment')
    const gone = (k ? on(k) : false) || (f.kind === 'sequence' && detoured(f.source, f.target)) || everything
    if (!gone) take(f, base.diagram.edges[bf.id], true)
  }
  for (const n of nodes) if (n.type === 'gateway' && n.defaultFlow && !flowIn.has(n.defaultFlow)) delete (n as { defaultFlow?: string }).defaultFlow

  const model: FlowModel = { ...withoutReview(rev), participants, lanes, nodes, flows, diagram: { shapes, edges } }
  return { model, usedBase }
}

const backOf = (c: Ctx, id: string): string | undefined => {
  for (const [b, r] of Object.entries(c.map)) if (r === id) return b
  return undefined
}

/** Changes the state needs besides its own: a step in a container the state does not have yet pulls the container in. */
function needs(c: Ctx, applied: Set<string>, comp: Composed): string[] {
  const { model, usedBase } = comp
  const have = new Set([...model.participants, ...model.lanes, ...model.nodes].map((x) => x.id))
  const add = new Set<string>()
  const check = (id: string, refs: (string | undefined)[]) => {
    for (const ref of refs) {
      if (!ref || have.has(ref)) continue
      if (usedBase.has(id)) {
        const k = `r:${id}`
        if (c.byKey.has(k) && !applied.has(k)) add.add(k)
      } else {
        const k = `r:${ref}`
        if (c.byKey.get(k)?.status === 'added' && !applied.has(k)) add.add(k)
      }
    }
  }
  for (const l of model.lanes) check(l.id, [l.participantId, l.parentLaneId])
  for (const n of model.nodes) check(n.id, [n.participantId, n.laneId, n.parentId, n.type === 'event' ? n.attachedTo : undefined])
  return [...add]
}

/** The state with these changes applied, and the changes it had to add (a dependency). */
function settle(c: Ctx, keys: Iterable<string>, before: Set<string>): { applied: Set<string>; model: FlowModel; pulled: string[] } {
  const applied = new Set([...before, ...keys])
  const asked = new Set(applied)
  let comp = compose(c, applied)
  for (let i = 0; i < 20; i++) {
    const more = needs(c, applied, comp)
    if (!more.length) break
    for (const k of more) applied.add(k)
    comp = compose(c, applied)
  }
  return { applied, model: comp.model, pulled: [...applied].filter((k) => !asked.has(k)) }
}

// ---------------------------------------------------------------- frames

const ownerWord = (ch: Change) => (ch.fix ? `fix ${ch.n}` : `change ${ch.n}`)

/** `**added** “Check stock”: details`, a few lines at most. */
function lines(changes: Change[]): string[] {
  const out = changes.slice(0, 5).map((c) => `**${c.status === 'comment' ? 'comment' : c.status}** ${c.label}${c.details.length ? `: ${c.details.join('; ')}` : ''}`)
  if (changes.length > 5) out.push(`…and ${changes.length - 5} more.`)
  return out
}

function titled(n: number, changes: Change[], tag: string): string {
  const first = changes[0]
  return first ? `${tag} ${n}: ${first.label}${changes.length > 1 ? ` +${changes.length - 1}` : ''}` : `${tag} ${n}`
}

export function replayError(m: FlowModel): string | null {
  if (!m.review) return 'This model is not compared with an earlier version: use File → Review this model first.'
  const d = reviewDiff(m)
  if (!d) return 'Nothing to play.'
  if (!d.sameDrawing) return 'Play review needs a copy made by Review this model (or a model that keeps the ids of the earlier one): two models drawn apart cannot be told fix by fix.'
  if (!d.changes.length) return 'There are no changes to play yet.'
  return null
}

/**
 * The review of a model as a story. `text` is the task text (paragraphs) when the student has one: each fix's quote
 * is lit in it. Null when the model has no review the frames can be built for (see `replayError`).
 */
export function reviewReplay(m: FlowModel, text?: string[]): Replay | null {
  if (replayError(m)) return null
  const diff = reviewDiff(m)!
  const base = structuredClone(m.review!.base)
  const rev = structuredClone(withoutReview(m))
  const c: Ctx = { base, rev, diff, byKey: new Map(diff.changes.map((x) => [x.key, x])), map: diff.map, back: new Map(Object.entries(diff.map).map(([b, r]) => [r, b])) }
  const name = rev.name || 'process'
  const frames: StoryFrame[] = []
  const beats: Beat[] = []

  const layer = (changes: Change[], model: FlowModel): ReviewLayer => {
    const marks: ReviewLayer['marks'] = {}
    const removedNodes: ReviewLayer['removedNodes'] = []
    const removedFlows: ReviewLayer['removedFlows'] = []
    const pageOfBase = (id: string): string | null => {
      const n = base.nodes.find((x) => x.id === id)
      const at = n?.type === 'event' && n.attachedTo ? n.attachedTo : id
      const bp = pageOf(base, at)
      return bp ? (c.map[bp] ?? bp) : null
    }
    for (const ch of changes) {
      if (ch.id) marks[ch.id] = { status: ch.status, n: ch.n }
      else if (ch.status === 'removed' && ch.kind === 'node' && ch.baseId) {
        const el = base.nodes.find((x) => x.id === ch.baseId)
        const box = base.diagram.shapes[ch.baseId]
        if (el && box) removedNodes.push({ id: el.id, el, box, n: ch.n, page: pageOfBase(el.id) })
      } else if (ch.status === 'removed' && ch.kind === 'flow' && ch.baseId) {
        const bf = base.flows.find((x) => x.id === ch.baseId)
        const source = bf && tr(c, bf.source)
        const target = bf && tr(c, bf.target)
        if (!bf || !source || !target) continue
        const stays = sameBox(base.diagram.shapes[bf.source], model.diagram.shapes[source]) && sameBox(base.diagram.shapes[bf.target], model.diagram.shapes[target])
        removedFlows.push({ id: bf.id, source, target, name: bf.name, ...(stays && base.diagram.edges[bf.id] ? { points: base.diagram.edges[bf.id] } : {}), n: ch.n, page: pageOfBase(bf.source) })
      }
    }
    return { marks, removedNodes, removedFlows }
  }

  /** Where the frame's changes live: one page when they all do, else the main process. */
  const pageFor = (changes: Change[], model: FlowModel, lay: ReviewLayer): string | null => {
    const pages = new Set<string | null>()
    for (const ch of changes) {
      if (ch.id) {
        const f = model.flows.find((x) => x.id === ch.id)
        const at = f ? f.source : ch.id
        const n = model.nodes.find((x) => x.id === at)
        pages.add((n?.type === 'event' && n.attachedTo ? pageOf(model, n.attachedTo) : pageOf(model, at)) ?? null)
      }
    }
    for (const r of lay.removedNodes) pages.add(r.page)
    for (const r of lay.removedFlows) pages.add(r.page)
    return pages.size === 1 ? [...pages][0] : null
  }

  /** The ids the camera frames: the changed elements, lifted to the page, and the ghosts. */
  const fitFor = (changes: Change[], model: FlowModel, page: string | null, lay: ReviewLayer): string[] => {
    const ids = new Set<string>()
    const lift = (id: string) => {
      let at: string | undefined = id
      if (!model.nodes.some((n) => n.id === id)) return void ids.add(id)
      while (at && (pageOf(model, at) ?? null) !== page) at = pageOf(model, at)
      if (at) ids.add(at)
    }
    for (const ch of changes) {
      if (!ch.id) continue
      const f = model.flows.find((x) => x.id === ch.id)
      if (f) (lift(f.source), lift(f.target))
      else lift(ch.id)
    }
    for (const r of lay.removedNodes) if (r.page === page) ids.add(`ghost:${r.id}`)
    for (const r of lay.removedFlows) if (r.page === page) (lift(r.source), lift(r.target))
    return [...ids]
  }

  const push = (beat: Beat, model: FlowModel, changes: Change[], opts: { overview?: boolean; all?: boolean } = {}) => {
    const lay = layer(changes, model)
    const page = opts.overview ? null : pageFor(changes, model, lay)
    const fit = opts.overview ? [] : fitFor(changes, model, page, lay)
    beats.push(beat)
    frames.push({
      index: frames.length,
      beat,
      model,
      current: opts.overview ? [] : fit,
      drawn: [],
      focus: null,
      fit,
      fitNear: [],
      page,
      token: [],
      tokenFlows: [],
      ghosts: [],
      overview: !!opts.overview,
      question: null,
      grouped: null,
      review: lay,
    })
  }

  // Frame 0: the draft as it was.
  push({ title: 'The draft', text: [`The model as it was before the review: “${base.name || name}”.`, 'Next, the fixes one by one: what changes, why, and what the task says.'] }, base, [], { overview: true })

  // One frame per fix, then each change in no fix.
  let applied = new Set<string>()
  const steps: { changes: Change[]; beat: Beat }[] = []
  diff.fixes.forEach((f) => {
    const fix = m.review!.fixes!.find((x) => x.id === f.id)!
    steps.push({ changes: f.changes, beat: { title: titled(f.n, f.changes, 'Fix'), ...(fix.quote?.trim() ? { quote: fix.quote.trim() } : {}), text: [...(fix.text?.trim() ? [fix.text.trim()] : [])] } })
  })
  for (const ch of diff.changes.filter((x) => !x.fix && x.status !== 'comment')) steps.push({ changes: [ch], beat: { title: titled(ch.n, [ch], 'Change'), text: [] } })

  steps.forEach(({ changes, beat }, i) => {
    const last = i === steps.length - 1
    const keys = changes.map((x) => x.key)
    const s = settle(c, keys, applied)
    // The last change of the review leaves the corrected model itself (anything the changes do not tell comes with it).
    const model = last ? rev : s.model
    const pulled = s.pulled.map((k) => c.byKey.get(k)).filter((x): x is Change => !!x)
    const together = [...new Set(pulled.map(ownerWord))]
    const text = [...(beat.text as string[]), ...lines(changes), ...(together.length ? [`Together with ${together.join(' and ')}: this change cannot stand without ${together.length > 1 ? 'them' : 'it'}.`] : [])]
    applied = s.applied
    push({ ...beat, text }, model, [...changes, ...pulled])
  })

  // The overview: the corrected model with every change marked.
  const general = m.review!.notes.general?.text?.trim()
  push({ title: 'The whole review', text: [...(general ? [general] : []), `${diff.counts.added} added, ${diff.counts.changed} changed, ${diff.counts.removed} removed${diff.fixes.length ? `, in ${diff.fixes.length} fix${diff.fixes.length === 1 ? '' : 'es'}` : ''}.`] }, rev, diff.changes, { overview: true })

  const story: Story = { format: STORY_FORMAT, version: STORY_VERSION, title: `Review: ${name.replace(/\s*\(review\)\s*$/i, '')}`, ...(text?.length ? { text } : {}), beats }
  return { story, frames }
}
