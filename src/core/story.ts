// Story files (`*.flow-story.json`, SPEC §10.1): a process told beat by beat. Beats name elements, never ids
// (an element without a name is written `#id`). Pure TypeScript: `parseStory` reads and checks a file (a refused
// file names the bad beat and element), `storyFrames` turns a story into one frame per beat: the model reduced
// to what is shown so far, what is new, which flows are drawn (from the older end), the token path, the ghosts.
import type { FlowModel } from './metamodel'
import { groupIntoSubprocess, pageOf, setCollapsed } from './ops'
import { snapshot } from './reduce'
import { parseModel } from './serialize'
import type { ReviewLayer } from './reviewReplay'

export const STORY_FORMAT = 'flow-story'
export const STORY_VERSION = 1
export const STORY_EXTENSION = '.flow-story.json'

/** A question asked before the beat (predict-first), as the walkthrough's. */
export interface StoryQuestion {
  prompt: string
  options: string[]
  right: number
  /** Shown after the answer. */
  why: string
}

/** Something the task asks for that the model does not hold: a dashed box, never part of the model. */
export interface StoryGhost {
  name: string
  /** A word under the name: "timer", "message"… */
  kind?: string
  /** Names of the elements it hangs on. */
  links?: string[]
}

export interface Beat {
  title: string
  /** Elements that appear in this beat: pools, lanes, steps, data (by name). */
  show?: string[]
  /** Flows held back until this beat: a flow's name, or `A -> B`. Other flows are drawn as soon as both ends are shown. */
  flows?: string[]
  /** The element the comment points at (default: the first new one). */
  focus?: string
  /** The words of the task text this beat comes from (one or several). */
  quote?: string | string[]
  /** The comment: a paragraph or several (`**bold**`, `*italic*`, `` `code` ``). */
  text?: string | string[]
  ghosts?: StoryGhost[]
  /** A token walks along these steps, in order. */
  token?: string[]
  /** Everything shown so far lit, the camera on the whole. */
  overview?: boolean
  question?: StoryQuestion
  /** The named steps are grouped into a sub-process and collapsed (the editor's own operations, on a copy). */
  group?: { name: string; steps: string[] }
  /** The beat is on the page of this collapsed sub-process (by name): its steps as the frame has them. */
  page?: string
}

export interface Story {
  format: typeof STORY_FORMAT
  version: typeof STORY_VERSION
  title: string
  /** The model the story is told over; without it, the open model. */
  model?: FlowModel
  /** The task text, paragraphs: it stays under the canvas and each beat's quote is highlighted in it. */
  text?: string[]
  beats: Beat[]
}

export class StoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StoryError'
  }
}

export interface PlacedGhost {
  id: string
  name: string
  kind?: string
  x: number
  y: number
  /** Element ids it hangs on. */
  links: string[]
}

export interface StoryFrame {
  index: number
  beat: Beat
  /** The model reduced to what is shown so far (a group beat: after the grouping). */
  model: FlowModel
  /** Ids shown for the first time in this beat. */
  current: string[]
  /** Sequence, message and data flows drawn in this beat, with the end they are drawn from. */
  drawn: { id: string; from: 'source' | 'target' }[]
  /** The element the comment points at. */
  focus: string | null
  /** What the camera frames. */
  fit: string[]
  /**
   * Pools reached by a message flow new in this beat: the camera frames only the part of the pool above or
   * below `near` (the flow's other end). A whole pool is as wide as the model and would zoom the beat out.
   */
  fitNear: { pool: string; near: string }[]
  /** The collapsed sub-process whose page this beat is on (null = the main process). */
  page: string | null
  /** The token's way: element ids in order, and the flows between them. */
  token: string[]
  tokenFlows: string[]
  ghosts: PlacedGhost[]
  overview: boolean
  question: StoryQuestion | null
  /** The sub-process a group beat made. */
  grouped: string | null
  /** A review replay's frame: the marks of its changes and the ghosts of what was removed. */
  review?: ReviewLayer
}

/** True when the text is a story file (not a model or a case file). */
export function isStoryFile(text: string): boolean {
  try {
    return (JSON.parse(text) as { format?: unknown }).format === STORY_FORMAT
  } catch {
    return false
  }
}

const BEAT_KEYS = ['title', 'show', 'flows', 'focus', 'quote', 'text', 'ghosts', 'token', 'overview', 'question', 'group', 'page']

const fail = (msg: string): never => {
  throw new StoryError(msg)
}
const where = (i: number, beat?: { title?: unknown }) => `Beat ${i + 1}${typeof beat?.title === 'string' && beat.title ? ` “${beat.title}”` : ''}`

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '')
const list = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : [])

/**
 * Reads a story file. `model` is the model to tell it over when the file carries none; a file with its own
 * model needs no other. Throws StoryError naming the beat and what is wrong; the frames are built too, so a
 * name that is nowhere in the model or a beat that cannot play is refused when the file opens.
 */
export function parseStory(text: string, open?: FlowModel): Story {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return fail(`Not a story file: ${(e as Error).message}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Not a story file: a JSON object is expected')
  const o = raw as Record<string, unknown>
  if (o.format !== STORY_FORMAT) fail(`Not a story file: "format" must be "${STORY_FORMAT}"`)
  if (o.version !== STORY_VERSION) fail(`Unsupported story version ${String(o.version)} (this app reads version ${STORY_VERSION})`)
  if (typeof o.title !== 'string' || !o.title.trim()) fail('The story needs a "title"')
  if (!Array.isArray(o.beats) || !o.beats.length) fail('The story needs a list of "beats"')
  let model: FlowModel | undefined
  if (o.model !== undefined) {
    try {
      model = parseModel(JSON.stringify(o.model))
    } catch (e) {
      return fail(`The story's "model" cannot be read: ${(e as Error).message}`)
    }
  }
  if (o.text !== undefined && !isStrings(o.text)) fail('"text" must be a list of paragraphs')
  const beats = (o.beats as unknown[]).map((b, i) => checkBeat(b, i))
  const story: Story = { format: STORY_FORMAT, version: STORY_VERSION, title: o.title as string, ...(model ? { model } : {}), ...(o.text ? { text: o.text as string[] } : {}), beats }
  const base = model ?? open
  if (!base) fail('The story has no model of its own and no process is open to tell it over')
  storyFrames(story, base as FlowModel)
  return story
}

function checkBeat(b: unknown, i: number): Beat {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return fail(`${where(i)} must be an object`)
  const o = b as Record<string, unknown>
  const at = where(i, o)
  for (const k of Object.keys(o)) if (!BEAT_KEYS.includes(k)) fail(`${at}: unknown field “${k}” (allowed: ${BEAT_KEYS.join(', ')})`)
  if (typeof o.title !== 'string' || !o.title.trim()) fail(`${where(i)} needs a “title”`)
  for (const k of ['show', 'flows', 'token'] as const) if (o[k] !== undefined && !isStrings(o[k])) fail(`${at}: “${k}” must be a list of names`)
  if (o.focus !== undefined && (typeof o.focus !== 'string' || !o.focus)) fail(`${at}: “focus” must be a name`)
  if (o.page !== undefined && (typeof o.page !== 'string' || !o.page)) fail(`${at}: “page” must be the name of a sub-process`)
  for (const k of ['quote', 'text'] as const) if (o[k] !== undefined && !(typeof o[k] === 'string' || isStrings(o[k]))) fail(`${at}: “${k}” must be a string or a list of strings`)
  if (o.overview !== undefined && typeof o.overview !== 'boolean') fail(`${at}: “overview” must be true or false`)
  if (o.ghosts !== undefined) {
    if (!Array.isArray(o.ghosts)) fail(`${at}: “ghosts” must be a list`)
    for (const g of o.ghosts as Record<string, unknown>[]) {
      if (!g || typeof g.name !== 'string' || !g.name) fail(`${at}: every ghost needs a “name”`)
      if (g.kind !== undefined && typeof g.kind !== 'string') fail(`${at}: ghost “${String(g.name)}”: “kind” must be a word`)
      if (g.links !== undefined && !isStrings(g.links)) fail(`${at}: ghost “${String(g.name)}”: “links” must be a list of names`)
    }
  }
  if (o.question !== undefined) {
    const q = o.question as Record<string, unknown>
    if (!q || typeof q.prompt !== 'string' || !isStrings(q.options) || q.options.length < 2 || typeof q.why !== 'string') fail(`${at}: a “question” needs a prompt, two or more options and a why`)
    if (!Number.isInteger(q.right) || (q.right as number) < 0 || (q.right as number) >= (q.options as string[]).length) fail(`${at}: the question’s “right” must be the number of an option (0 is the first)`)
  }
  if (o.group !== undefined) {
    const g = o.group as Record<string, unknown>
    if (!g || typeof g.name !== 'string' || !g.name || !isStrings(g.steps) || !g.steps.length) fail(`${at}: a “group” needs a name and the names of its steps`)
  }
  return o as unknown as Beat
}

// ---------------------------------------------------------------- names

type Named = { id: string; name: string; what: string }

/** Every pool, lane and node of the model that can be named in a beat. */
function named(m: FlowModel): Named[] {
  return [
    ...m.participants.map((p) => ({ id: p.id, name: p.name, what: 'pool' })),
    ...m.lanes.map((l) => ({ id: l.id, name: l.name, what: 'lane' })),
    ...m.nodes.map((n) => ({ id: n.id, name: n.name, what: n.type })),
  ]
}

const lev = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** The id of the element a beat names; `#id` names an element that has no name. Throws with a suggestion. */
export function resolveName(m: FlowModel, name: string, at: string): string {
  const all = named(m)
  if (name.startsWith('#')) {
    const hit = all.find((x) => x.id === name.slice(1))
    return hit ? hit.id : fail(`${at}: there is no element with the id “${name.slice(1)}”`)
  }
  const want = name.trim()
  let hits = all.filter((x) => x.name === want)
  if (!hits.length) hits = all.filter((x) => x.name.toLowerCase() === want.toLowerCase())
  if (hits.length === 1) return hits[0].id
  if (hits.length > 1) return fail(`${at}: “${name}” names ${hits.length} elements (${hits.map((h) => `${h.what} #${h.id}`).join(', ')}): write one as #id`)
  const near = all
    .filter((x) => x.name)
    .map((x) => ({ x, d: lev(x.name.toLowerCase(), want.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)[0]
  return fail(`${at}: no element named “${name}”${near && near.d <= Math.max(2, want.length / 3) ? ` (did you mean “${near.x.name}”?)` : ''}`)
}

/** A flow named by its own name, or as `A -> B` (the names of its ends). */
function flowMatches(m: FlowModel, f: FlowModel['flows'][number], ref: string): boolean {
  const arrow = ref.split(/\s*(?:->|→)\s*/)
  if (arrow.length === 2) {
    const nm = (id: string) => named(m).find((x) => x.id === id)?.name ?? ''
    const end = (n: string, id: string) => (n.startsWith('#') ? n.slice(1) === id : nm(id) === n.trim())
    return end(arrow[0], f.source) && end(arrow[1], f.target)
  }
  return f.name === ref.trim()
}

// ---------------------------------------------------------------- frames

/** The text of the quotes, in the order of the beat. */
export const quotesOf = (b: Beat): string[] => list(b.quote)
/** The comment paragraphs of a beat. */
export const textsOf = (b: Beat): string[] => list(b.text)

/** One frame per beat. Throws StoryError (beat and element named) when a beat cannot play. */
export function storyFrames(story: Story, open: FlowModel): StoryFrame[] {
  let ref = structuredClone(story.model ?? open)
  const shown = new Set<string>()
  const drawn = new Set<string>()
  const frames: StoryFrame[] = []

  story.beats.forEach((beat, i) => {
    const at = where(i, beat)
    const before = new Set(shown)
    let grouped: string | null = null
    const current: string[] = []

    if (beat.group) {
      const steps = beat.group.steps.map((s) => resolveName(ref, s, `${at}, group`))
      for (const id of steps) if (!shown.has(id)) fail(`${at}: “${nameOf(ref, id)}” is grouped before it is shown`)
      const next = structuredClone(ref)
      const known = new Set([...next.participants, ...next.lanes, ...next.nodes, ...next.flows].map((x) => x.id))
      try {
        const sp = groupIntoSubprocess(next, steps, { gateways: true, name: beat.group.name })
        setCollapsed(next, sp.id, true)
        grouped = sp.id
      } catch (e) {
        return fail(`${at}: cannot group ${beat.group.steps.map((s) => `“${s}”`).join(', ')}: ${(e as Error).message}`)
      }
      // The new elements (the box, its start and end events, the flows made) belong to this beat; flows that
      // were drawn and are gone were rewired: what replaces them is drawn again, from the older end.
      const alive = new Set([...next.participants, ...next.lanes, ...next.nodes, ...next.flows].map((x) => x.id))
      for (const id of [...shown]) if (!alive.has(id)) shown.delete(id)
      for (const id of [...drawn]) if (!alive.has(id)) drawn.delete(id)
      for (const x of [...next.nodes, ...next.flows]) if (!known.has(x.id)) (shown.add(x.id), current.push(x.id))
      ref = next
    }

    for (const name of beat.show ?? []) {
      const id = resolveName(ref, name, `${at}, “show”`)
      if (!shown.has(id)) (shown.add(id), current.push(id))
    }
    // A boundary event needs its host on the canvas.
    for (const id of current) {
      const n = ref.nodes.find((x) => x.id === id)
      if (n?.type === 'event' && n.attachedTo && !shown.has(n.attachedTo)) fail(`${at}: “${n.name || id}” is a boundary event: show “${nameOf(ref, n.attachedTo)}” first or in the same beat`)
    }

    // Flows listed here must have both ends on the canvas; flows listed in a later beat wait for it.
    const mine = (beat.flows ?? []).map((r) => {
      const hit = ref.flows.filter((f) => flowMatches(ref, f, r))
      if (!hit.length) fail(`${at}, “flows”: no flow “${r}”`)
      for (const f of hit) if (!shown.has(f.source) || !shown.has(f.target)) fail(`${at}, “flows”: “${r}” runs between ${nameOf(ref, f.source)} and ${nameOf(ref, f.target)}, which are not both shown yet`)
      return hit
    })
    const later = story.beats.slice(i + 1).flatMap((b) => b.flows ?? [])
    const newFlows: StoryFrame['drawn'] = []
    for (const f of ref.flows) {
      if (drawn.has(f.id) || !shown.has(f.source) || !shown.has(f.target)) continue
      if (!mine.some((h) => h.includes(f)) && later.some((r) => flowMatches(ref, f, r))) continue
      drawn.add(f.id)
      const sourceOld = before.has(f.source)
      const targetOld = before.has(f.target)
      newFlows.push({ id: f.id, from: !sourceOld && targetOld ? 'target' : 'source' })
    }

    const focus = beat.focus ? resolveName(ref, beat.focus, `${at}, “focus”`) : (current.find((id) => !ref.participants.some((p) => p.id === id) && !ref.lanes.some((l) => l.id === id) && ref.nodes.some((n) => n.id === id)) ?? current[0] ?? null)
    if (focus && !shown.has(focus)) fail(`${at}, “focus”: “${nameOf(ref, focus)}” is not shown yet`)

    // The token's way.
    const token = (beat.token ?? []).map((n) => resolveName(ref, n, `${at}, “token”`))
    const tokenFlows: string[] = []
    for (let k = 1; k < token.length; k++) {
      if (!shown.has(token[k]) || !shown.has(token[k - 1])) fail(`${at}, “token”: “${nameOf(ref, shown.has(token[k]) ? token[k - 1] : token[k])}” is not shown yet`)
      const f = ref.flows.find((x) => x.kind === 'sequence' && x.source === token[k - 1] && x.target === token[k])
      // A boundary event is reached from its host, and its own flow leaves it: the host-to-event hop has no flow.
      const hop = ref.nodes.some((n) => n.id === token[k] && n.type === 'event' && n.attachedTo === token[k - 1])
      if (!f && !hop) fail(`${at}, “token”: no sequence flow from “${nameOf(ref, token[k - 1])}” to “${nameOf(ref, token[k])}”`)
      if (f) tokenFlows.push(f.id)
    }

    // Ghosts hang on elements already shown and sit to the right of them.
    const ghosts: PlacedGhost[] = (beat.ghosts ?? []).map((g, k) => {
      const links = (g.links ?? []).map((n) => resolveName(ref, n, `${at}, ghost “${g.name}”`))
      for (const id of links) if (!shown.has(id)) fail(`${at}, ghost “${g.name}”: “${nameOf(ref, id)}” is not shown yet`)
      const boxes = links.map((id) => ref.diagram.shapes[id]).filter(Boolean)
      const x = boxes.length ? Math.max(...boxes.map((b) => b.x + b.width)) + 60 : 80
      const y = (boxes.length ? Math.min(...boxes.map((b) => b.y)) : 80) + k * 70
      return { id: `ghost:${i}:${k}`, name: g.name, ...(g.kind ? { kind: g.kind } : {}), x, y, links }
    })

    // A beat that opens a sub-process's page: the box must be collapsed (a page exists only for those).
    let pageBeat: string | null = null
    if (beat.page) {
      pageBeat = resolveName(ref, beat.page, `${at}, “page”`)
      const sp = ref.nodes.find((n) => n.id === pageBeat)
      if (sp?.type !== 'subProcess' || !sp.collapsed) fail(`${at}, “page”: “${beat.page}” is not a collapsed sub-process`)
      if (!shown.has(pageBeat)) fail(`${at}, “page”: “${beat.page}” is not shown yet`)
    }
    const onPageIds = pageBeat ? [...shown].filter((id) => ref.nodes.some((n) => n.id === id) && pageOf(ref, id) === pageBeat) : []

    const overview = !!beat.overview
    // The ends of the new flows join the frame; a pool at the end of a message flow joins only near the other end.
    const isPool = (id: string) => ref.participants.some((p) => p.id === id)
    const fitNear: StoryFrame['fitNear'] = []
    const flowEnds = newFlows.flatMap((d) => {
      const f = ref.flows.find((x) => x.id === d.id)
      if (!f) return []
      if (f.kind === 'message' && isPool(f.source) !== isPool(f.target)) {
        const [pool, near] = isPool(f.source) ? [f.source, f.target] : [f.target, f.source]
        if (!current.includes(pool)) return (fitNear.push({ pool, near }), [near])
      }
      return [f.source, f.target]
    })
    const fit = pageBeat && !current.length && !token.length ? onPageIds : overview || (!current.length && !token.length) ? [...shown] : [...new Set([...current, ...token, ...(focus ? [focus] : []), ...flowEnds])]
    // On a sub-process's page when what the beat shows lives there.
    const focusNode = focus ? ref.nodes.find((n) => n.id === focus) : undefined
    const hostOf = focusNode?.type === 'event' && focusNode.attachedTo ? focusNode.attachedTo : focus
    const onPage = pageBeat ?? (focusNode && hostOf && !overview ? (pageOf(ref, hostOf) ?? null) : null)

    frames.push({
      index: i,
      beat,
      model: snapshot(ref, shown, drawn),
      current,
      drawn: newFlows,
      focus,
      fit,
      fitNear: fit === onPageIds || overview ? [] : fitNear,
      page: onPage,
      token,
      tokenFlows,
      ghosts,
      overview,
      question: beat.question ?? null,
      grouped,
    })
  })
  return frames
}

const nameOf = (m: FlowModel, id: string): string => named(m).find((x) => x.id === id)?.name || `#${id}`

/** Names of the elements no beat ever shows (a story that leaves them out may be meant to). */
export function untold(frames: StoryFrame[], ref: FlowModel): string[] {
  const last = frames.at(-1)
  if (!last) return []
  const seen = new Set([...last.model.participants, ...last.model.lanes, ...last.model.nodes].map((x) => x.id))
  return named(ref)
    .filter((x) => !seen.has(x.id))
    .map((x) => x.name || `#${x.id}`)
}

// ---------------------------------------------------------------- the quotes in the task text

export interface QuoteSpan {
  /** Paragraph index in the story's text. */
  p: number
  from: number
  to: number
}

/**
 * Where each beat's quotes sit in the task text (`null` = not found). A quote is searched after the one
 * before it, so the same words used twice go to the right place; if that fails, from the start.
 */
export function locateQuotes(story: Story): (QuoteSpan | null)[][] {
  const text = story.text ?? []
  let last = { p: 0, to: 0 }
  return story.beats.map((b) =>
    quotesOf(b).map((q) => {
      const find = (p0: number, from0: number): QuoteSpan | null => {
        for (let p = p0; p < text.length; p++) {
          const k = text[p].indexOf(q, p === p0 ? from0 : 0)
          if (k >= 0) return { p, from: k, to: k + q.length }
        }
        return null
      }
      const hit = find(last.p, last.to) ?? find(0, 0)
      if (hit) last = { p: hit.p, to: hit.to }
      return hit
    }),
  )
}

/** Quotes of the beats that are not in the text, as “Beat n: …” (a story with a text must find them all). */
export function missingQuotes(story: Story): string[] {
  if (!story.text) return []
  const where_ = locateQuotes(story)
  return story.beats.flatMap((b, i) => quotesOf(b).filter((_, k) => !where_[i][k]).map((q) => `${where(i, b)}: the quote “${q}” is not in the text`))
}
