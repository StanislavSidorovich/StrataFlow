// "My task" (SPEC §9, StrataSQL pattern): the student's own task text, pasted in. No reference and no
// score: the student tags phrases of the text (the same eight tags as level 1), and the trainer lists tagged
// phrases the model does not show yet, model elements no tagged phrase mentions, and cue words not tagged
// yet as questions. Works beside the student's own model (no task model). Can be saved as a case file.
import { nameSimilarity, nameWords } from '../core/compare'
import type { FlowModel } from '../core/metamodel'
import { caseToFile } from './caseFile'
import { TAGS, type Tag, type TagSpan, type TrainerCase } from './cases'
import { findCues } from './textcues'

/** A tagged phrase: paragraph, character range in it, and its words (to find it again after an edit). */
export interface Mark {
  p: number
  start: number
  end: number
  tag: Tag
  text: string
}

export interface MyTask {
  title: string
  text: string
  marks: Mark[]
}

export const EMPTY_TASK: MyTask = { title: '', text: '', marks: [] }

/** A block of the task text: a paragraph, or a heading (a short title line, or a Markdown `#` line). */
export interface Block {
  text: string
  heading: boolean
}

const SENTENCE_END = /[.!?:;]["”')\]]?$/
const HEADING_MAX_WORDS = 7
const HEADING_MAX_CHARS = 60

/** A short line with no closing punctuation, as a title in a pasted document ("The Process", "Claim Validation"). */
function titleLike(line: string): boolean {
  return line.length <= HEADING_MAX_CHARS && line.split(/\s+/).length <= HEADING_MAX_WORDS && !/[.,;:!?]$/.test(line) && /^[A-Z0-9]/.test(line)
}

/**
 * The blocks of the text. Text copied from a PDF breaks lines where the page ended, not where a sentence
 * did, so a line that does not end a sentence is joined to the next one (a word hyphenated at the line
 * end is put back together). A short title line followed by a capital starts a heading and a new
 * paragraph. Markdown headings, bullets and bold lose their marks; blank lines always separate.
 */
export function blocks(text: string): Block[] {
  const out: Block[] = []
  let cur: { text: string; lines: number } | null = null
  const flush = () => {
    if (cur) out.push({ text: cur.text, heading: false })
    cur = null
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) {
      flush()
      continue
    }
    const md = /^\s{0,3}#{1,6}\s+/.test(raw)
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+/.test(raw)
    const line = raw
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/\*\*|__/g, '')
      .trim()
    if (!line) continue
    if (md) {
      flush()
      out.push({ text: line, heading: true })
      continue
    }
    if (cur && !bullet) {
      const open = !SENTENCE_END.test(cur.text)
      const lower = /^[a-z]/.test(line)
      if (cur.lines === 1 && titleLike(cur.text) && !lower) {
        // A title, then the text under it.
        out.push({ text: cur.text, heading: true })
        cur = { text: line, lines: 1 }
        continue
      }
      if (open || lower) {
        cur = { text: /[a-z]-$/.test(cur.text) && lower ? cur.text.slice(0, -1) + line : `${cur.text} ${line}`, lines: cur.lines + 1 }
        continue
      }
    }
    flush()
    cur = { text: line, lines: 1 }
  }
  flush()
  return out
}

/** The paragraphs of the text (headings included). */
export function paragraphs(text: string): string[] {
  return blocks(text).map((b) => b.text)
}

/** Adds a mark; marks it overlaps are replaced. */
export function addMark(marks: Mark[], m: Mark): Mark[] {
  return [...marks.filter((x) => x.p !== m.p || x.end <= m.start || x.start >= m.end), m].sort((a, b) => a.p - b.p || a.start - b.start)
}

/** After the text changed: keep marks whose words are still there (same place, else the first match in any paragraph). */
export function remapMarks(marks: Mark[], text: string): Mark[] {
  const ps = paragraphs(text)
  let out: Mark[] = []
  for (const m of marks) {
    if (ps[m.p]?.slice(m.start, m.end) === m.text) {
      out = addMark(out, m)
      continue
    }
    const p = ps.findIndex((t) => t.includes(m.text))
    if (p >= 0) {
      const start = ps[p].indexOf(m.text)
      out = addMark(out, { ...m, p, start, end: start + m.text.length })
    }
  }
  return out
}

/** A phrase mentions an element when most words of the element's name are in it ("checks the member's card" ~ Check card). */
export function mentions(phrase: string, name: string): boolean {
  const n = nameWords(name)
  if (!n.length) return false
  const p = new Set(nameWords(phrase))
  return n.filter((w) => p.has(w)).length / n.length >= 0.6 || nameSimilarity(phrase, name) >= 0.5
}

export interface Coverage {
  /** Tagged phrases with nothing of that kind in the model. */
  missing: { mark: Mark; why: string }[]
  /** Named model elements no tagged phrase mentions. */
  unmentioned: { id: string; name: string; what: string }[]
  /** Cue words not inside a tagged phrase. */
  questions: PCue[]
}

/** A cue word placed in the task text: paragraph, character range and what it suggests. */
export interface PCue {
  p: number
  start: number
  end: number
  text: string
  tag: Tag
  why: string
}

const overlaps = (m: { p: number; start: number; end: number }, c: PCue) => m.p === c.p && m.start < c.end && m.end > c.start

/** The cue words of every paragraph. */
export function textCues(ps: string[]): PCue[] {
  return ps.flatMap((text, p) => findCues(text).map((c) => ({ p, start: c.start, end: c.end, text: text.slice(c.start, c.end), tag: c.tag, why: c.why })))
}

/** The cues to mark as dotted hints: only where the student has not tagged anything. */
export function untaggedCues(cues: PCue[], marks: Mark[]): PCue[] {
  return cues.filter((c) => !marks.some((m) => overlaps(m, c)))
}

/** Tags that answer a cue as well as its own (a lane or a pool for a role word; a message for a "sends" task). */
const COMPATIBLE: Record<Tag, Tag[]> = {
  participant: ['participant', 'role'],
  role: ['role', 'participant'],
  activity: ['activity', 'message'],
  event: ['event', 'message'],
  decision: ['decision'],
  parallel: ['parallel'],
  message: ['message', 'event', 'activity'],
  data: ['data', 'message'],
}

export interface TagQuestion {
  kind: 'untagged' | 'other-tag'
  cue: PCue
  /** The student's tag that overlaps the cue (other-tag). */
  mark?: Mark
  text: string
}

const TAG_WORD: Record<Tag, string> = {
  participant: 'a pool',
  role: 'a lane',
  activity: 'a task',
  event: 'an event',
  decision: 'an exclusive gateway',
  parallel: 'a parallel gateway',
  message: 'a message',
  data: 'a data object',
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Where the student's tags and the cue words differ, as questions. Without tags there are none. */
export function compareTagging(marks: Mark[], cues: PCue[]): TagQuestion[] {
  if (marks.length === 0) return []
  const out: TagQuestion[] = []
  for (const c of cues) {
    const here = marks.filter((m) => overlaps(m, c))
    if (here.length === 0) {
      // A role or a document named once is enough; later mentions are the same lane or data object.
      if ((c.tag === 'role' || c.tag === 'data') && marks.some((m) => COMPATIBLE[c.tag].includes(m.tag) && m.text.toLowerCase().includes(c.text.toLowerCase()))) continue
      out.push({ kind: 'untagged', cue: c, text: `${c.why}. ${capital(TAG_WORD[c.tag])}?` })
    } else if (!here.some((m) => COMPATIBLE[c.tag].includes(m.tag))) {
      const m = here[0]
      out.push({ kind: 'other-tag', cue: c, mark: m, text: `You tagged it ${TAGS.find((t) => t.id === m.tag)!.label}; ${c.why}. ${capital(TAG_WORD[c.tag])} or ${TAG_WORD[m.tag]}?` })
    }
  }
  return out
}

export function coverage(task: MyTask, model: FlowModel): Coverage {
  const ps = paragraphs(task.text)
  const tasks = model.nodes.filter((n) => n.type === 'task' || n.type === 'subProcess')
  const events = model.nodes.filter((n) => n.type === 'event')
  const data = model.nodes.filter((n) => n.type === 'dataObject' || n.type === 'dataStore')
  const gateways = model.nodes.filter((n) => n.type === 'gateway')
  const named = (list: { name: string }[], t: string) => list.some((x) => mentions(t, x.name))
  const missing: Coverage['missing'] = []
  for (const m of task.marks) {
    const t = m.text
    const why = (() => {
      switch (m.tag) {
        case 'participant':
          return named(model.participants, t) ? null : 'no pool named like it yet'
        case 'role':
          return named(model.lanes, t) || named(model.participants, t) ? null : 'no lane named like it yet'
        case 'activity':
          return named(tasks, t) ? null : 'no task named like it yet (drawn under another name?)'
        case 'event':
          return named(events, t) || named(tasks, t) ? null : 'no event named like it yet (drawn under another name?)'
        case 'decision':
          return gateways.some((g) => g.type === 'gateway' && g.kind !== 'parallel') ? null : 'no exclusive (or inclusive, event-based) gateway yet'
        case 'parallel':
          return gateways.some((g) => g.type === 'gateway' && g.kind === 'parallel') ? null : 'no parallel gateway yet'
        case 'message':
          return model.flows.some((f) => f.kind === 'message') || named(events, t) || named(tasks, t) ? null : 'no message flow yet'
        case 'data':
          return named(data, t) ? null : 'no data object or store named like it yet'
      }
    })()
    if (why) missing.push({ mark: m, why })
  }
  const what = (type: string) => (type === 'subProcess' ? 'sub-process' : type === 'dataObject' ? 'data object' : type === 'dataStore' ? 'data store' : type)
  const unmentioned: Coverage['unmentioned'] = task.marks.length
    ? [
        ...model.participants.map((p) => ({ id: p.id, name: p.name, what: 'pool' })),
        ...model.lanes.map((l) => ({ id: l.id, name: l.name, what: 'lane' })),
        ...[...tasks, ...events, ...data].map((n) => ({ id: n.id, name: n.name, what: what(n.type) })),
      ].filter((x) => x.name && !task.marks.some((m) => mentions(m.text, x.name)))
    : []
  const questions = untaggedCues(textCues(ps), task.marks)
  return { missing, unmentioned, questions }
}

/** Questions for any process model of any text (7PMG and the course's rules), checked by the student. */
export const MY_TASK_CHECKLIST = [
  'Does every pool stand for an organisation or an outside party, and every lane for a role in the text?',
  'Does each task name start with a verb (Check card), and each event say what happened (Card checked)?',
  'Does every path end in an end event named after its outcome?',
  'Does every exclusive split ask a question, with named branches (Yes / No)?',
  'Do parallel branches meet in a parallel join, alternative branches in an exclusive join?',
  'Do messages (dashed) go between pools, and sequence flows stay inside one pool?',
  'Run Check in the top bar: what does the model check ask?',
]

/** The task as a case file: the tagged phrases that name an element of the model become the phrases, the model the reference. */
export function myTaskToCaseFile(task: MyTask, model: FlowModel): { text: string; left: number } {
  const ps = paragraphs(task.text)
  const elements = [...model.participants, ...model.lanes, ...model.nodes].filter((x) => x.name)
  const spans: TagSpan[] = []
  for (const m of task.marks) {
    const hit = elements.filter((x) => mentions(m.text, x.name)).sort((a, b) => nameSimilarity(m.text, b.name) - nameSimilarity(m.text, a.name))[0]
    if (hit) spans.push({ p: m.p, phrase: m.text, tag: m.tag, target: [hit.name], why: `${TAGS.find((t) => t.id === m.tag)!.label}: ${hit.name}.` })
  }
  const id =
    (task.title || model.name || 'my-task')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'my-task'
  const c: TrainerCase = { id, title: task.title || model.name || 'My task', difficulty: 2, concepts: [], text: ps, spans, decisions: [], synonyms: {}, reference: () => model }
  return { text: caseToFile(c), left: task.marks.length - spans.length }
}
