// Bizagi's reusable sub-processes, both ways. This is what the course practice and Bizagi's own exports use
// (Chapter 3, exercise 3.4): each collapsed sub-process is a call activity whose `calledElement` is the id of a
// process of its own, drawn in a file of its own. A page is the same pool with only the sub-process's lane and
// its own start and end inside. A party it exchanges messages with comes along as a black-box pool.
// Writing: `splitReusable` / `writeReusable`. Reading a project of several files back into one model: `readProject`.
import { isArtifact, type Bounds, type Flow, type FlowModel, type FlowNode } from '../metamodel'
import { collapseForBizagi, depth, PAGE_PAD } from './pages'
import { readBpmn, type ReadResult } from './read'
import { bizagiSafeId, writeBpmn } from './write'

/** One process of a reusable project: the main sheet first, then a page per collapsed sub-process. */
export interface ReusablePart {
  /** The sub-process the page belongs to (undefined = the main sheet). */
  holder?: string
  model: FlowModel
  /** Id of the process the page draws (what the call activity calls). */
  processId?: string
}

export interface ReusableSplit {
  parts: ReusablePart[]
  /** Collapsed sub-process id → the id of the process its page draws. */
  calls: Record<string, string>
  /** Steps moved into the sub-process's lane on their page (what P20 points at). */
  moved: number
  /** Data associations dropped because they joined two files. */
  dropped: number
}

/** Room round a page's steps inside its pool, the pool header, black-box pools below. */
const POOL = { padX: 60, padY: 50, header: 30, gap: 60, blackBox: 80 }

/** Makes up ids that clash with none of the model's. */
function freshIds(m: FlowModel): (base: string) => string {
  const used = new Set<string>([...m.participants.flatMap((p) => [p.id, p.processId ?? '']), ...m.lanes.map((l) => l.id), ...m.nodes.map((n) => n.id), ...m.flows.map((f) => f.id)])
  return (base) => {
    if (/Id_[0-9a-f]{8}-[0-9a-f]{4}-/i.test(base)) {
      const id = bizagiSafeId(base, (x) => used.has(x))
      used.add(id)
      return id
    }
    let id = base
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`
    used.add(id)
    return id
  }
}

/** The model as a main sheet plus one model per page, as the reusable Bizagi export writes them. */
export function splitReusable(model: FlowModel): ReusableSplit {
  const m = collapseForBizagi(model).model
  const fresh = freshIds(m)
  const byId = new Map(m.nodes.map((n) => [n.id, n]))
  // After collapsing, every sub-process is collapsed: a node's page is its parent (a boundary event has its host's).
  const subs = m.nodes
    .filter((n) => n.type === 'subProcess')
    .sort((a, b) => depth(m, a) - depth(m, b) || (m.diagram.shapes[a.id]?.x ?? 0) - (m.diagram.shapes[b.id]?.x ?? 0))
  const calls: Record<string, string> = {}
  for (const s of subs) calls[s.id] = fresh(`${s.id}_process`)
  let moved = 0
  const dropped = m.flows.filter((f) => f.kind === 'data' && byId.get(f.source)?.parentId !== byId.get(f.target)?.parentId).length

  const parts: ReusablePart[] = []
  for (const s of subs) {
    const pool = m.participants.find((p) => p.id === s.participantId)
    const lane = m.lanes.find((l) => l.id === s.laneId)
    const poolId = pool ? fresh(`${s.id}_pool`) : undefined
    const laneId = poolId && lane ? fresh(`${s.id}_lane`) : undefined
    const inside = new Set(m.nodes.filter((n) => n.parentId === s.id).map((n) => n.id))
    const nodes: FlowNode[] = m.nodes
      .filter((n) => inside.has(n.id))
      .map((n) => {
        const c = structuredClone(n)
        if (!isArtifact(c) && !(c.type === 'event' && c.attachedTo) && c.laneId !== s.laneId) moved++
        c.parentId = undefined
        c.participantId = poolId
        c.laneId = laneId
        return c
      })
    const flows: Flow[] = m.flows.filter((f) => f.kind !== 'message' && inside.has(f.source) && inside.has(f.target)).map((f) => structuredClone(f))
    const shapes: Record<string, Bounds> = {}
    const edges: FlowModel['diagram']['edges'] = {}
    for (const n of nodes) if (m.diagram.shapes[n.id]) shapes[n.id] = { ...m.diagram.shapes[n.id] }
    for (const f of flows) if (m.diagram.edges[f.id]) edges[f.id] = m.diagram.edges[f.id].map((p) => ({ ...p }))
    const page: FlowModel = { format: m.format, version: m.version, name: s.name, participants: [], lanes: [], nodes, flows, diagram: { shapes, edges } }

    if (pool && poolId) {
      // The page's pool round its steps, the one lane filling it.
      const boxes = Object.values(shapes)
      const x0 = (boxes.length ? Math.min(...boxes.map((b) => b.x)) : PAGE_PAD) - POOL.padX - POOL.header
      const y0 = (boxes.length ? Math.min(...boxes.map((b) => b.y)) : PAGE_PAD) - POOL.padY
      const width = (boxes.length ? Math.max(...boxes.map((b) => b.x + b.width)) : PAGE_PAD + 200) + POOL.padX - x0
      const height = (boxes.length ? Math.max(...boxes.map((b) => b.y + b.height)) : PAGE_PAD + 100) + POOL.padY - y0
      page.participants.push({ id: poolId, name: pool.name, processId: calls[s.id] })
      shapes[poolId] = { x: x0, y: y0, width, height }
      if (lane && laneId) {
        page.lanes.push({ id: laneId, name: lane.name, participantId: poolId, ...(lane.capacity !== undefined && { capacity: lane.capacity }) })
        shapes[laneId] = { x: x0 + POOL.header, y: y0, width: width - POOL.header, height }
      }
      // Message flows of the drawing with one end on this page (collapseForBizagi moved them to the box on the
      // main sheet): here they reach the step, and the other party is a black-box pool below.
      const copies = new Map<string, string>() // other pool → its black box on the page
      const partyOf = (id: string) => (model.participants.some((p) => p.id === id) ? id : model.nodes.find((n) => n.id === id)?.participantId)
      for (const f of model.flows) {
        if (f.kind !== 'message') continue
        const here = [f.source, f.target].map((id) => byId.get(id)?.parentId === s.id)
        if (here[0] === here[1]) continue
        const party = partyOf(here[0] ? f.target : f.source)
        if (!party || party === pool.id) continue
        if (!copies.has(party)) {
          const id = fresh(`${party}_${s.id}`)
          copies.set(party, id)
          page.participants.push({ id, name: model.participants.find((p) => p.id === party)?.name ?? '' })
          shapes[id] = { x: x0, y: y0 + height + POOL.gap + (copies.size - 1) * (POOL.blackBox + POOL.gap), width, height: POOL.blackBox }
        }
        const box = copies.get(party)!
        flows.push({ id: fresh(`${f.id}_${s.id}`), kind: 'message', name: f.name, source: here[0] ? f.source : box, target: here[1] ? f.target : box })
      }
    }
    parts.push({ holder: s.id, model: page, processId: calls[s.id] })
  }

  // The main sheet: what no page holds.
  const hidden = new Set(m.nodes.filter((n) => n.parentId).map((n) => n.id))
  // A message of a step inside a sub-process is drawn on that step's page (black-box pool): the copy collapseForBizagi
  // moved to the box would be a second line to the same party, so the main sheet keeps none.
  const onPage = new Set(model.flows.filter((f) => f.kind === 'message' && [f.source, f.target].some((id) => byId.get(id)?.parentId)).map((f) => f.id))
  const flows = m.flows.filter((f) => !hidden.has(f.source) && !hidden.has(f.target) && !onPage.has(f.id))
  const kept = new Set(flows.map((f) => f.id))
  const main: FlowModel = {
    ...m,
    nodes: m.nodes.filter((n) => !hidden.has(n.id)),
    flows,
    diagram: {
      shapes: Object.fromEntries(Object.entries(m.diagram.shapes).filter(([id]) => !hidden.has(id))),
      edges: Object.fromEntries(Object.entries(m.diagram.edges).filter(([id]) => kept.has(id))),
    },
  }
  return { parts: [{ model: main }, ...parts], calls, moved, dropped }
}

/** A file name without the characters Windows refuses. */
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

/** The reusable project as BPMN files: "Diagram 1 - <process>.bpmn" for the main sheet, then one per page. */
export async function writeReusable(model: FlowModel): Promise<{ files: { name: string; xml: string }[]; split: ReusableSplit }> {
  const split = splitReusable(model)
  const files: { name: string; xml: string }[] = []
  for (const [i, p] of split.parts.entries()) {
    const title = fileSafe(p.model.name) || (i ? `Sub-process ${i}` : 'Process')
    const xml = await writeBpmn(p.model, { calls: split.calls, processId: p.processId, tag: i ? String(i + 1) : undefined, guidIds: i > 0 })
    files.push({ name: `Diagram ${i + 1} - ${title}.bpmn`, xml })
  }
  return { files, split }
}

// ---------------------------------------------------------------- reading a project of several files

/** Natural order of file names: "Diagram 2" before "Diagram 10". */
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/**
 * Several BPMN files of one project (a Bizagi export with reusable sub-processes) as one model with pages.
 * A call activity is paired with the file that holds the process it calls (`calledElement` = that process's id);
 * the main file is the one nobody calls (of several, the one whose calls find the most pages). On the page the
 * steps take the call activity's pool; a step's lane is the main pool's lane of the same name, else the call
 * activity's lane (said in the warnings). A call whose file is missing stays a task, with a warning.
 */
export async function readProject(files: { name: string; text: string }[]): Promise<ReadResult & { pages: number }> {
  const sorted = [...files].sort((a, b) => natural(a.name, b.name))
  const read = await Promise.all(sorted.map(async (f) => ({ name: f.name, ...(await readBpmn(f.text)) })))
  const owner = new Map<string, number>() // process id → file
  for (const [i, r] of read.entries()) for (const id of Object.keys(r.processes)) if (!owner.has(id)) owner.set(id, i)
  const called = new Set(read.flatMap((r) => Object.values(r.calls)))
  const found = (i: number) => Object.values(read[i].calls).filter((p) => owner.has(p) && owner.get(p) !== i).length
  const roots = read.map((_, i) => i).filter((i) => read[i].model.nodes.length && !Object.keys(read[i].processes).some((p) => called.has(p)))
  const root = (roots.length ? roots : read.map((_, i) => i)).sort((a, b) => found(b) - found(a) || a - b)[0]
  const warnings = read[root].warnings.map((w) => `${read[root].name}: ${w}`)
  const model: FlowModel = structuredClone(read[root].model)
  const used = new Set<string>([...model.participants.map((p) => p.id), ...model.lanes.map((l) => l.id), ...model.nodes.map((n) => n.id), ...model.flows.map((f) => f.id)])
  const opened = new Set<number>([root])
  let pages = 0

  const expand = (callId: string, processId: string, stack: number[]) => {
    const call = model.nodes.find((n) => n.id === callId)!
    const i = owner.get(processId)
    if (i === undefined) return warnings.push(`The page of "${call.name || callId}" is not among the files (it calls ${processId}): kept as a task`)
    if (stack.includes(i)) return warnings.push(`"${call.name || callId}" calls a process that calls it back: kept as a task`)
    const r = read[i]
    opened.add(i)
    pages++
    const page = r.model
    for (const w of r.warnings) warnings.push(`${r.name}: ${w}`)
    const pool = page.participants.find((p) => p.processId === processId)
    const own = (n: FlowNode) => (pool ? n.participantId === pool.id || (isArtifact(n) && !n.participantId) : !n.participantId || !page.participants.find((p) => p.id === n.participantId)?.processId)
    const nodes = page.nodes.filter(own)
    const ids = new Map<string, string>()
    const rename = (id: string) => {
      let to = id
      for (let k = 2; used.has(to); k++) to = `${id}_${k}`
      used.add(to)
      ids.set(id, to)
      return to
    }
    for (const n of nodes) rename(n.id)
    // The call activity becomes a collapsed sub-process: its page is the called process.
    const at = model.nodes.indexOf(call)
    const loop = call.type === 'task' ? call.loop : undefined
    model.nodes[at] = { id: call.id, name: call.name, participantId: call.participantId, laneId: call.laneId, parentId: call.parentId, ...(call.sim && { sim: call.sim }), type: 'subProcess', collapsed: true, ...(loop && { loop }) }
    const merged = new Set<string>()
    const laneName = (id: string | undefined) => page.lanes.find((l) => l.id === id)?.name ?? ''
    for (const n of nodes) {
      const c: FlowNode = { ...structuredClone(n), id: ids.get(n.id)!, parentId: n.parentId && ids.has(n.parentId) ? ids.get(n.parentId) : call.id, participantId: call.participantId }
      if (c.type === 'event' && c.attachedTo) c.attachedTo = ids.get(c.attachedTo) ?? c.attachedTo
      if (c.type === 'gateway' && c.defaultFlow) c.defaultFlow = undefined // set again below with the flow's new id
      const name = laneName(n.laneId)
      const match = !isArtifact(n) && name ? model.lanes.find((l) => l.participantId === call.participantId && same(l.name, name)) : undefined
      c.laneId = match?.id ?? call.laneId
      if (!isArtifact(n) && name && !match && !same(name, model.lanes.find((l) => l.id === call.laneId)?.name)) merged.add(name)
      model.nodes.push(c)
    }
    if (merged.size) warnings.push(`Page "${call.name}": lane${merged.size > 1 ? 's' : ''} ${[...merged].map((l) => `"${l}"`).join(', ')} not in the main pool, ${merged.size > 1 ? 'their' : 'its'} steps put in the sub-process's lane`)
    const flowIds = new Map<string, string>()
    const party = (id: string) => {
      const p = page.participants.find((x) => x.id === id)
      return p ? model.participants.find((q) => same(q.name, p.name) && q.id !== call.participantId)?.id : undefined
    }
    for (const f of page.flows) {
      const s = ids.get(f.source)
      const t = ids.get(f.target)
      if (s && t) {
        const id = rename(f.id)
        flowIds.set(f.id, id)
        model.flows.push({ ...structuredClone(f), id, source: s, target: t })
        if (page.diagram.edges[f.id]) model.diagram.edges[id] = page.diagram.edges[f.id].map((p) => ({ ...p }))
      } else if (f.kind === 'message' && (s || t)) {
        // A message between a step on the page and a party: the party is the main sheet's pool of that name.
        const other = party(s ? f.target : f.source)
        if (!other) {
          warnings.push(`Page "${call.name}": message flow ${f.name ? `"${f.name}" ` : ''}to a pool that is not on the main sheet, skipped`)
          continue
        }
        const source = s ?? other
        const target = t ?? other
        // The main sheet draws the same message to the call activity: the page's one says where it really goes.
        const twin = model.flows.findIndex((x) => x.kind === 'message' && ((s && x.source === call.id && x.target === other) || (t && x.target === call.id && x.source === other)))
        if (twin >= 0) {
          delete model.diagram.edges[model.flows[twin].id]
          model.flows.splice(twin, 1)
        }
        model.flows.push({ id: rename(f.id), kind: 'message', name: f.name, source, target })
      }
    }
    for (const n of nodes) {
      const g = page.nodes.find((x) => x.id === n.id)
      const c = model.nodes.find((x) => x.id === ids.get(n.id))
      if (g?.type === 'gateway' && g.defaultFlow && c?.type === 'gateway') c.defaultFlow = flowIds.get(g.defaultFlow)
    }
    // The page's drawing, its steps at the top left (as Flow keeps a page).
    const boxes = nodes.map((n) => page.diagram.shapes[n.id]).filter((b): b is Bounds => !!b)
    const dx = boxes.length ? PAGE_PAD - Math.min(...boxes.map((b) => b.x)) : 0
    const dy = boxes.length ? PAGE_PAD - Math.min(...boxes.map((b) => b.y)) : 0
    for (const n of nodes) {
      const b = page.diagram.shapes[n.id]
      if (b) model.diagram.shapes[ids.get(n.id)!] = { ...b, x: b.x + dx, y: b.y + dy }
    }
    for (const to of flowIds.values()) if (model.diagram.edges[to]) model.diagram.edges[to] = model.diagram.edges[to].map((p) => ({ x: p.x + dx, y: p.y + dy }))
    for (const [nodeId, called] of Object.entries(r.calls)) if (ids.has(nodeId)) expand(ids.get(nodeId)!, called, [...stack, i])
  }
  for (const [nodeId, called] of Object.entries(read[root].calls)) expand(nodeId, called, [root])
  for (const [i, r] of read.entries()) if (!opened.has(i)) warnings.push(`${r.name} is not called from ${read[root].name}: not opened`)
  if (!model.name) model.name = read[root].name.replace(/\.(bpmn|xml)$/i, '')
  return { model, warnings, calls: {}, processes: read[root].processes, pages }
}
