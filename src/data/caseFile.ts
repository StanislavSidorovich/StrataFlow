// Case files (`*.flow-case.json`, SPEC §10): a trainer case kept outside the app: its text, the phrases
// that map to the model, synonyms, key decisions and the reference model (and for an AS-IS → TO-BE case
// the redesign part) in one JSON file. File → Open of such a file adds the case to the trainer and starts
// its walkthrough. For teachers who write their own cases, cases Claude writes on request, and tasks that
// must not ship with the public app (a group's project, shared only inside the group).
import type { FlowModel } from '../core/metamodel'
import { ModelFormatError, parseModel } from '../core/serialize'
import { spanRanges, TAGS, type Redesign, type TagSpan, type TrainerCase } from './cases'
import { walkthroughSteps } from './walkthrough'

export const CASE_FORMAT = 'flow-case'
export const CASE_VERSION = 1
export const CASE_EXTENSION = '.flow-case.json'
/** File cases get this id prefix, so they never replace a built-in case. */
export const FILE_CASE_PREFIX = 'file:'

/** True when the text is a case file (not a model file). */
export function isCaseFile(text: string): boolean {
  try {
    return (JSON.parse(text) as { format?: unknown }).format === CASE_FORMAT
  } catch {
    return false
  }
}

const fail = (msg: string): never => {
  throw new ModelFormatError(msg)
}
const strings = (v: unknown, where: string): string[] => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : fail(`${where} must be a list of strings`))
const synonyms = (v: unknown, where: string): Record<string, string[]> => {
  if (v === undefined) return {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(`${where} must be an object: name → other names`)
  for (const [k, x] of Object.entries(v)) strings(x, `${where}["${k}"]`)
  return v as Record<string, string[]>
}

function spans(v: unknown, text: string[], ref: FlowModel, where: string): TagSpan[] {
  const list = (Array.isArray(v) ? v : fail(`${where} must be a list`)) as TagSpan[]
  const tags = TAGS.map((t) => t.id as string)
  const names = new Set([...ref.nodes, ...ref.participants, ...ref.lanes].map((x) => x.name))
  list.forEach((s, i) => {
    if (typeof s.p !== 'number' || typeof s.phrase !== 'string' || typeof s.why !== 'string') fail(`${where}[${i}] needs p, phrase and why`)
    if (s.p < 0 || s.p >= text.length) fail(`${where}[${i}]: “${s.phrase}” points at paragraph ${s.p}, the text has ${text.length}`)
    if (!tags.includes(s.tag)) fail(`${where}[${i}]: unknown tag “${String(s.tag)}” (one of ${tags.join(', ')})`)
    if (s.accept) strings(s.accept, `${where}[${i}].accept`).forEach((t) => tags.includes(t) || fail(`${where}[${i}]: unknown tag “${t}”`))
    for (const t of strings(s.target, `${where}[${i}].target`)) if (!names.has(t)) fail(`${where}[${i}]: “${s.phrase}” names “${t}”, which is not in the reference model`)
  })
  return list
}

/** Reads and checks a case file: every phrase is found in its paragraph, names real elements, and the walkthrough builds. */
export function parseCaseFile(text: string): TrainerCase {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text) as Record<string, unknown>
  } catch (e) {
    return fail(`Not valid JSON: ${(e as Error).message}`)
  }
  if (raw.format !== CASE_FORMAT) fail(`Not a StrataFlow case (format must be "${CASE_FORMAT}")`)
  if (raw.version !== CASE_VERSION) fail(`Unsupported case version ${String(raw.version)}`)
  const model = parseModel(JSON.stringify({ format: 'strata-flow', version: 1, ...(raw.model as object) }))
  const o = (raw.case ?? fail('"case" is missing')) as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) fail('case.id is missing')
  if (typeof o.title !== 'string' || !o.title) fail('case.title is missing')
  const paragraphs = strings(o.text, 'case.text')
  let redesign: Redesign | undefined
  if (raw.redesign) {
    const r = raw.redesign as Record<string, unknown>
    const toBe = parseModel(JSON.stringify({ format: 'strata-flow', version: 1, ...(r.model as object) }))
    const g = (r.goals ?? fail('redesign.goals is missing')) as Record<string, unknown>
    if (typeof g.cycleTime !== 'number' || typeof g.cost !== 'number') fail('redesign.goals needs cycleTime and cost (numbers)')
    redesign = {
      reference: () => structuredClone(toBe),
      spans: spans(r.spans ?? [], paragraphs, toBe, 'redesign.spans'),
      synonyms: synonyms(r.synonyms, 'redesign.synonyms'),
      decisions: r.decisions === undefined ? [] : strings(r.decisions, 'redesign.decisions'),
      goals: { cycleTime: g.cycleTime as number, cost: g.cost as number, text: typeof g.text === 'string' ? g.text : `Cycle time at most ${g.cycleTime}, cost at most ${g.cost}.` },
    }
  }
  const c: TrainerCase = {
    id: FILE_CASE_PREFIX + o.id,
    title: o.title as string,
    difficulty: o.difficulty === 1 || o.difficulty === 2 || o.difficulty === 3 ? o.difficulty : 2,
    concepts: o.concepts === undefined ? [] : strings(o.concepts, 'case.concepts'),
    text: paragraphs,
    spans: spans(o.spans, paragraphs, model, 'case.spans'),
    decisions: o.decisions === undefined ? [] : strings(o.decisions, 'case.decisions'),
    synonyms: synonyms(o.synonyms, 'case.synonyms'),
    groups: o.groups === undefined ? undefined : synonyms(o.groups, 'case.groups'),
    reference: () => structuredClone(model),
    redesign,
  }
  // The checks the built-in cases pass in their tests, as readable errors.
  for (const v of [c, ...(redesign ? [{ ...c, spans: redesign.spans }] : [])])
    spanRanges(v).forEach((r, i) => r.start < 0 && fail(`The phrase “${v.spans[i].phrase}” is not in paragraph ${v.spans[i].p} (after the phrase before it)`))
  try {
    walkthroughSteps(c, model)
  } catch (e) {
    fail(`The walkthrough cannot be built: ${(e as Error).message}`)
  }
  return c
}

/** A case as a case file (the built-in ones too: a teacher can start from one). */
export function caseToFile(c: TrainerCase): string {
  const r = c.redesign
  const strip = (m: FlowModel) => (({ format: _f, version: _v, ...rest }) => rest)(m)
  return (
    JSON.stringify(
      {
        format: CASE_FORMAT,
        version: CASE_VERSION,
        case: {
          id: c.id.startsWith(FILE_CASE_PREFIX) ? c.id.slice(FILE_CASE_PREFIX.length) : c.id,
          title: c.title,
          difficulty: c.difficulty,
          concepts: c.concepts,
          text: c.text,
          spans: c.spans,
          decisions: c.decisions,
          synonyms: c.synonyms,
          ...(c.groups ? { groups: c.groups } : {}),
        },
        model: strip(c.reference()),
        ...(r ? { redesign: { model: strip(r.reference()), spans: r.spans, synonyms: r.synonyms, decisions: r.decisions, goals: r.goals } } : {}),
      },
      null,
      2,
    ) + '\n'
  )
}
