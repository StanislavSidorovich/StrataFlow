// What-if scenarios of the Run tab (stage 6b phase 4; design §5.4, chapter 6 note §1.3).
// A scenario is a short named list of changes ("Packer 1 → 2", "arrivals × 1.5", "skip Z"), not a copy of the model.
// `resolveChanges` turns it into the engine's overrides (and says what it ignored or rebalanced); `applyChanges`
// writes the same changes into the model as normal edits. Metrics, targets, deltas and the pinned columns live here
// too, so they can be tested without the page.
import { branchShares, isDecision, UNIT_NAMES } from './analysis'
import type { FlowModel, TimeUnit } from './metamodel'
import { parseNum } from './number'
import { ModelError, flowOf, laneOf, nodeOf, setCapacity, setFires, setShape, setProbability, setSim, setSimSettings } from './ops'
import { foldRepeats, labelOf, plainLabel } from './simLabels'
import type { SimOverrides, SimResult } from './simulate'

export type Change =
  | { kind: 'arrivals'; factor: number }
  | { kind: 'capacity'; id: string; value: number }
  | { kind: 'duration' | 'wait' | 'cost'; id: string; value: number; /** Typed wait only: replace the shape with a triangular one (value is its mean). */ tri?: { min: number; mode: number; max: number } }
  | { kind: 'branch'; id: string; value: number }
  | { kind: 'fires'; id: string; value: number }
  | { kind: 'skip'; id: string }

export type ChangeKind = Change['kind']

export interface Scenario {
  name: string
  changes: Change[]
  /** What the variant costs to introduce, typed by hand (the model has no figure for it). */
  cost?: number
}

/** The thing a change is about: one change per kind and element, a later one replaces the earlier. */
export const changeKey = (c: Change) => (c.kind === 'arrivals' ? 'arrivals' : `${c.kind}:${c.id}`)

/** Adds a change, replacing an earlier change of the same kind on the same element. */
export function withChange(list: Change[], c: Change): Change[] {
  return [...list.filter((x) => changeKey(x) !== changeKey(c)), c]
}

// ---------------------------------------------------------------- what can be picked

export interface Choice {
  id: string
  label: string
}

const nmFull = (m: FlowModel, id: string) => (nodeOf(m, id) ? labelOf(m, id) : id)
const nm = nmFull

const isActivity = (m: FlowModel, id: string) => {
  const n = nodeOf(m, id)
  return n?.type === 'task' || n?.type === 'subProcess'
}
const isCatch = (m: FlowModel, id: string) => {
  const n = nodeOf(m, id)
  return n?.type === 'event' && n.position === 'intermediate' && !n.throwing
}
const isBoundary = (m: FlowModel, id: string) => {
  const n = nodeOf(m, id)
  return n?.type === 'event' && n.position === 'boundary'
}
/** A branch of a decision gateway: the only flows with a probability. */
function isBranch(m: FlowModel, id: string): boolean {
  const f = flowOf(m, id)
  if (!f || f.kind !== 'sequence') return false
  const g = nodeOf(m, f.source)
  return isDecision(g, m.flows.filter((x) => x.kind === 'sequence' && x.source === f.source).length)
}

/** Whether `id` can be the target of a change of this kind (also used to follow a click on the canvas). */
export function validTarget(m: FlowModel, kind: ChangeKind, id: string): boolean {
  switch (kind) {
    case 'arrivals':
      return false
    case 'capacity':
      return !!laneOf(m, id)
    case 'duration':
    case 'cost':
    case 'skip':
      return isActivity(m, id)
    case 'wait':
      return isActivity(m, id) || isCatch(m, id)
    case 'fires':
      return isBoundary(m, id)
    case 'branch':
      return isBranch(m, id)
  }
}

export function flowLabel(m: FlowModel, id: string): string {
  const f = flowOf(m, id)
  if (!f) return id
  return `${nm(m, f.source)} → ${f.name || nm(m, f.target)}`
}

/** The model's own elements a change of this kind can be about, for the pickers. */
export function picksFor(m: FlowModel, kind: ChangeKind): Choice[] {
  switch (kind) {
    case 'arrivals':
      return []
    case 'capacity':
      return m.lanes.map((l) => ({ id: l.id, label: l.name || l.id }))
    case 'branch':
      return m.flows.filter((f) => isBranch(m, f.id)).map((f) => ({ id: f.id, label: flowLabel(m, f.id) }))
    default:
      return m.nodes.filter((n) => validTarget(m, kind, n.id)).map((n) => ({ id: n.id, label: nm(m, n.id) }))
  }
}

// ---------------------------------------------------------------- numbers with units

const UNIT_WORDS: [RegExp, TimeUnit][] = [
  [/^(min|mins|minute|minutes|m)$/i, 'min'],
  [/^(h|hr|hrs|hour|hours)$/i, 'h'],
  [/^(d|day|days)$/i, 'd'],
]
const HOURS: Record<TimeUnit, number> = { min: 1 / 60, h: 1, d: 24 }

export interface ParsedTime {
  /** In the model's unit. */
  value?: number
  error?: string
  /** Said when the text carried another unit than the model's ("90 min" in a model in hours). */
  converted?: string
}

/** `1.5`, `1,5`, `90 min`, `2 h`, `1 d`: a bare number is in the model's unit, a suffix is converted to it. */
export function parseTime(text: string, unit: TimeUnit): ParsedTime {
  const t = text.trim()
  if (t === '') return {}
  const m = /^([+-]?[\d.,\s  ]*\d|[+-]?[.,]\d+)\s*([a-zA-Z]+)?$/.exec(t)
  if (!m) return { error: parseNum(t).error ?? 'Not a number' }
  const p = parseNum(m[1])
  if (p.error || p.value === undefined) return { error: p.error ?? 'Not a number' }
  if (!m[2]) return { value: p.value }
  const u = UNIT_WORDS.find(([re]) => re.test(m[2]))?.[1]
  if (!u) return { error: `Unknown unit "${m[2]}": use min, h or d` }
  if (u === unit) return { value: p.value }
  const v = Math.round(((p.value * HOURS[u]) / HOURS[unit]) * 1e9) / 1e9
  return { value: v, converted: `${t} = ${v} ${UNIT_NAMES[unit]}` }
}

// ---------------------------------------------------------------- scenario → overrides

export interface Resolved {
  overrides: SimOverrides
  /** Changes whose element is gone from the model: shown marked, left out of the run. */
  dead: Change[]
  /** For the person: what was ignored, clamped, rebalanced. */
  notes: string[]
  /** Final probability of every branch of the gateways touched (the rebalanced ones too). */
  probabilities: Record<string, number>
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export function resolveChanges(m: FlowModel, changes: Change[]): Resolved {
  const overrides: SimOverrides = {}
  const dead: Change[] = []
  const notes: string[] = []
  const el = (id: string) => {
    const all = (overrides.elements ??= {})
    return (all[id] ??= {})
  }
  const branches: Extract<Change, { kind: 'branch' }>[] = []
  for (const c of changes) {
    if (c.kind === 'arrivals') {
      if (!(Number.isFinite(c.factor) && c.factor > 0)) notes.push('Arrivals × k: k must be above 0 (ignored)')
      else overrides.arrivalsFactor = (overrides.arrivalsFactor ?? 1) * c.factor
      continue
    }
    if (!validTarget(m, c.kind, c.id)) {
      dead.push(c)
      notes.push(`${describeChange(m, c)}: no longer in the model (ignored)`)
      continue
    }
    if (c.kind === 'capacity') {
      const v = c.value < 1 ? 1 : c.value
      if (v !== c.value) notes.push(`${nm2(m, c)}: at least 1 person (counts as 1)`)
      ;(overrides.capacity ??= {})[c.id] = v
    } else if (c.kind === 'branch') branches.push(c)
    else if (c.kind === 'skip') {
      el(c.id).skip = true
      const hosts = m.nodes.filter((n) => n.type === 'event' && n.position === 'boundary' && n.attachedTo === c.id)
      if (hosts.length) notes.push(`${nm(m, c.id)} is skipped, so its boundary event${hosts.length > 1 ? 's' : ''} (${hosts.map((h) => h.name || 'event').join(', ')}) never happen${hosts.length > 1 ? '' : 's'}`)
    } else if (c.kind === 'fires') el(c.id).fires = clamp01(c.value)
    else if (c.kind === 'wait' && c.tri) {
      const e = el(c.id)
      e.waitShape = { kind: 'triangular', ...c.tri }
      e.wait = (c.tri.min + c.tri.mode + c.tri.max) / 3
    } else el(c.id)[c.kind] = Math.max(0, c.value)
  }

  // Branches: a changed branch takes its share, the others of that gateway share what is left in proportion to
  // what they had (an inclusive split decides each branch on its own: nothing to rebalance).
  const probabilities: Record<string, number> = {}
  const gateways = new Map<string, Extract<Change, { kind: 'branch' }>[]>()
  for (const c of branches) {
    const g = flowOf(m, c.id)!.source
    gateways.set(g, [...(gateways.get(g) ?? []), c])
  }
  for (const [gid, cs] of gateways) {
    const g = nodeOf(m, gid)!
    const outs = m.flows.filter((f) => f.kind === 'sequence' && f.source === gid)
    const old = branchShares(outs)
    const set = new Map(cs.map((c) => [c.id, clamp01(c.value)]))
    if (g.type === 'gateway' && g.kind === 'inclusive') {
      for (const [id, p] of set) probabilities[id] = p
      continue
    }
    let taken = [...set.values()].reduce((s, p) => s + p, 0)
    if (taken > 1 + 1e-9) {
      for (const [id, p] of set) set.set(id, p / taken)
      notes.push(`${nm(m, gid)}: the branch shares you set add up to ${Math.round(taken * 100)} %, scaled to 100 %`)
      taken = 1
    }
    const others = outs.filter((f) => !set.has(f.id))
    const oldSum = others.reduce((s, f) => s + (old.get(f.id) ?? 0), 0)
    for (const [id, p] of set) probabilities[id] = p
    const left = Math.max(0, 1 - taken)
    let moved = false
    for (const f of others) {
      const share = oldSum > 1e-12 ? ((old.get(f.id) ?? 0) / oldSum) * left : left / others.length
      probabilities[f.id] = share
      if (Math.abs(share - (old.get(f.id) ?? 0)) > 1e-6) moved = true
    }
    if (others.length && moved) notes.push(`${nm(m, gid)}: the other branches were scaled to share the remaining ${Math.round(left * 1000) / 10} % in proportion`)
  }
  if (Object.keys(probabilities).length) overrides.probabilities = probabilities
  return { overrides, dead, notes, probabilities }
}

const nm2 = (m: FlowModel, c: Change) => (c.kind === 'arrivals' ? 'Arrivals' : c.kind === 'branch' ? flowLabel(m, c.id) : c.kind === 'capacity' ? (laneOf(m, c.id)?.name ?? c.id) : nm(m, c.id))

const r = (x: number) => String(Math.round(x * 1e4) / 1e4)
const pc = (x: number | undefined) => (x === undefined ? '?' : `${Math.round(x * 1000) / 10} %`)

/** "Packer 1 → 2", "arrivals × 1.5", "Pack goods time 1 → 0.5 h", "skip Check stock". */
export function describeChange(m: FlowModel, c: Change, plain = false): string {
  /** `plain`: the name without its lane, so that the same change on three equal names can be folded. */
  const nm = (mm: FlowModel, id: string) => (plain && nodeOf(mm, id) ? plainLabel(mm, id) : nmFull(mm, id))
  const unit = UNIT_NAMES[m.sim?.unit ?? 'min']
  switch (c.kind) {
    case 'arrivals':
      return `arrivals × ${r(c.factor)}`
    case 'capacity':
      return `${laneOf(m, c.id)?.name || c.id} ${laneOf(m, c.id)?.capacity ?? 1} → ${r(c.value)}`
    case 'duration':
    case 'wait': {
      const n = nodeOf(m, c.id)
      const was = n?.sim?.[c.kind]
      if (c.kind === 'wait' && c.tri) return `${n ? nm(m, c.id) : c.id} wait ${was === undefined ? '0' : r(was)} → triangular ${r(c.tri.min)} / ${r(c.tri.mode)} / ${r(c.tri.max)} ${unit}`
      return `${n ? nm(m, c.id) : c.id} ${c.kind === 'wait' ? 'wait' : 'time'} ${was === undefined ? '0' : r(was)} → ${r(c.value)} ${unit}`
    }
    case 'cost': {
      const n = nodeOf(m, c.id)
      return `${n ? nm(m, c.id) : c.id} cost ${n?.sim?.cost === undefined ? '0' : r(n.sim.cost)} → ${r(c.value)}`
    }
    case 'branch': {
      const f = flowOf(m, c.id)
      if (!f) return `branch ${c.id}`
      const shares = branchShares(m.flows.filter((x) => x.kind === 'sequence' && x.source === f.source))
      return `${flowLabel(m, c.id)} ${pc(shares.get(c.id))} → ${pc(c.value)}`
    }
    case 'fires': {
      const n = nodeOf(m, c.id)
      return `${n ? nm(m, c.id) : c.id} chance ${pc(n?.sim?.fires ?? 0)} → ${pc(c.value)}`
    }
    case 'skip':
      return `skip ${nodeOf(m, c.id) ? nm(m, c.id) : c.id}`
  }
}

/** The changes of a scenario as short lines: the same change on equal names reads "Check stock wait 2 → 1 h ×3". */
export function describeChanges(m: FlowModel, cs: Change[]): string[] {
  return foldRepeats(cs.map((c) => describeChange(m, c, true)))
}

/** Why a change cannot be added yet, or nothing. */
export function checkChange(m: FlowModel, c: Change): string | undefined {
  if (c.kind === 'arrivals') return c.factor > 0 && Number.isFinite(c.factor) ? undefined : 'The factor must be above 0'
  if (!validTarget(m, c.kind, c.id)) return c.id ? 'Pick an element of the model that fits' : 'Pick what to change'
  if (c.kind === 'skip') return undefined
  if (!Number.isFinite(c.value)) return 'Type a number'
  if (c.kind === 'capacity' && c.value < 1) return 'At least 1 person'
  if ((c.kind === 'branch' || c.kind === 'fires') && (c.value < 0 || c.value > 1)) return 'A share is from 0 to 100 %'
  if (c.value < 0) return 'Not below 0'
  if (c.kind === 'wait' && c.tri) {
    const { min, mode, max } = c.tri
    if (![min, mode, max].every(Number.isFinite) || min < 0) return 'min, likely and max: numbers from 0 up'
    if (!(min <= mode && mode <= max) || min === max) return 'Needs min ≤ likely ≤ max, and min below max'
  }
  return undefined
}

/** What a new typed wait does to the element's distribution shape, in words (shown under the Typed wait form). */
export function waitShapeNote(m: FlowModel, id: string): string {
  const unit = UNIT_NAMES[m.sim?.unit ?? 'min']
  const sh = nodeOf(m, id)?.sim?.waitShape
  const r = (x: number) => String(Math.round(x * 100) / 100)
  const tail = ' To replace the shape, fill min / likely / max (a triangular wait).'
  if (!sh) return `This wait is one fixed number now: the new average replaces it.${tail}`
  if (sh.kind === 'exp') return `This wait is random (exponential): it follows the new average.${tail}`
  if (sh.kind === 'normal') return `This wait is normal: it follows the new average and keeps its σ of ${r(sh.sd)} ${unit}.${tail}`
  const was = sh.kind === 'uniform' ? `uniform ${r(sh.min)} to ${r(sh.max)}` : `triangular ${r(sh.min)} / ${r(sh.mode)} / ${r(sh.max)}`
  return `This wait is ${was} ${unit} now. A new average rescales it: min${sh.kind === 'triangular' ? ', likely' : ''} and max are all multiplied by the same factor, so the shape stays. To replace it, fill min / likely / max (a triangular wait).`
}

// ---------------------------------------------------------------- apply to the model

/** Writes the scenario's changes into the model (call inside `apply`, so it is one undo step). Returns notes for the person. */
export function applyChanges(m: FlowModel, changes: Change[]): string[] {
  const res = resolveChanges(m, changes)
  const notes = [...res.notes.filter((n) => /scaled|rebalanced|no longer/.test(n))]
  for (const c of changes) {
    if (res.dead.includes(c)) continue
    switch (c.kind) {
      case 'arrivals': {
        const rate = m.sim?.arrivals
        if (!rate) throw new ModelError('Type the new cases per time unit first: the factor needs a rate to multiply')
        setSimSettings(m, { arrivals: Math.round(rate * c.factor * 1e9) / 1e9 })
        break
      }
      case 'capacity':
        setCapacity(m, c.id, Math.max(1, c.value))
        break
      case 'duration':
      case 'wait':
      case 'cost':
        if (c.kind === 'wait' && c.tri) setShape(m, c.id, 'wait', { kind: 'triangular', ...c.tri })
        else setSim(m, c.id, { [c.kind]: c.value })
        break
      case 'fires':
        setFires(m, c.id, clamp01(c.value))
        break
      case 'skip':
        setSim(m, c.id, { duration: 0, wait: 0, cost: 0 })
        notes.push(`${nm(m, c.id)} stays on the diagram with no time and no cost: delete it if you want it gone`)
        break
      case 'branch':
        break
    }
  }
  for (const [id, p] of Object.entries(res.probabilities)) setProbability(m, id, Math.round(p * 1e6) / 1e6)
  return notes
}

// ---------------------------------------------------------------- metrics, targets, deltas

export type MetricKind = 'time' | 'pct' | 'cost' | 'count'

export interface MetricValue {
  key: string
  label: string
  kind: MetricKind
  /** Which way is better; `none` = only a fact (how busy a lane is). */
  better: 'lower' | 'higher' | 'none'
  value: number | undefined
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

/** The figures a scenario is compared on, read from one result (lane figures only for the lanes that have any). */
export function metricsOf(r: SimResult): MetricValue[] {
  const k = r.kpis
  const out: MetricValue[] = [{ key: 'cycle', label: 'Cycle time', kind: 'time', better: 'lower', value: k.cycleTime?.mean }]
  if (r.level === 3) out.push({ key: 'resWait', label: 'Waiting for a person', kind: 'time', better: 'lower', value: k.resourceWait?.mean })
  out.push({ key: 'wait', label: 'Waiting in total', kind: 'time', better: 'lower', value: r.runs.length ? mean(r.runs.map((x) => x.typedWait + x.resourceWait)) : undefined })
  out.push({ key: 'processing', label: 'Processing', kind: 'time', better: 'none', value: k.processing?.mean })
  out.push({ key: 'efficiency', label: 'Efficiency', kind: 'pct', better: 'higher', value: k.efficiency?.mean })
  out.push({ key: 'cost', label: 'Cost per case', kind: 'cost', better: 'lower', value: k.cost?.mean })
  if (k.onTime) out.push({ key: 'onTime', label: r.target !== undefined ? `Cases within the cycle-time target` : 'On time', kind: 'pct', better: 'higher', value: k.onTime.mean })
  out.push({ key: 'throughput', label: 'Completed per time unit', kind: 'count', better: 'higher', value: k.throughput?.mean })
  for (const l of r.lanes) {
    out.push({ key: `util:${l.laneId}`, label: `${l.name || 'Lane'}: busy`, kind: 'pct', better: 'none', value: l.utilisation.mean })
    if (r.level === 3) out.push({ key: `lwait:${l.laneId}`, label: `${l.name || 'Lane'}: wait per request`, kind: 'time', better: 'lower', value: l.utilisation.mean >= 1 ? undefined : l.meanWait })
  }
  return out
}

export type Verdict = 'better' | 'worse' | 'same' | 'none'

export interface Delta {
  delta: number
  /** Relative to the base (undefined when the base is 0). */
  pct?: number
  verdict: Verdict
}

export function deltaOf(base: number | undefined, v: number | undefined, better: MetricValue['better']): Delta | undefined {
  if (base === undefined || v === undefined || !Number.isFinite(base) || !Number.isFinite(v)) return undefined
  const delta = v - base
  const same = Math.abs(delta) <= 1e-9 * Math.max(1, Math.abs(base))
  const pct = Math.abs(base) > 1e-12 ? delta / Math.abs(base) : undefined
  const verdict: Verdict = same ? 'same' : better === 'none' ? 'none' : (better === 'lower' ? delta < 0 : delta > 0) ? 'better' : 'worse'
  return { delta: same ? 0 : delta, pct: same ? 0 : pct, verdict }
}

export interface CompareRow {
  metric: MetricValue
  base: number | undefined
  scenario: number | undefined
  delta?: Delta
}

/** Base and scenario side by side on the metrics both runs have. */
export function compareResults(base: SimResult, scenario: SimResult): CompareRow[] {
  const sm = new Map(metricsOf(scenario).map((x) => [x.key, x]))
  return metricsOf(base)
    .filter((b) => sm.has(b.key))
    .map((b) => ({ metric: b, base: b.value, scenario: sm.get(b.key)!.value, delta: deltaOf(b.value, sm.get(b.key)!.value, b.better) }))
}

/** A target on a metric: lower-better figures must be at most it, higher-better at least it. */
export type Targets = Record<string, number>

export function meetsTarget(metric: Pick<MetricValue, 'better'>, value: number | undefined, target: number | undefined): boolean | undefined {
  if (target === undefined || value === undefined || metric.better === 'none') return undefined
  return metric.better === 'lower' ? value <= target + 1e-12 : value >= target - 1e-12
}

// ---------------------------------------------------------------- pinned runs

export const MAX_PINS = 3

/** A run kept for comparison: its figures only (small, so it can live in localStorage), not the whole result. */
export interface PinnedRun {
  id: string
  label: string
  /** Time unit of the figures: another unit than the model's now means they cannot be compared. */
  unit: TimeUnit
  level: number
  seed: number
  cases: number
  runs: number
  changes: string[]
  /** Typed by hand: what this variant costs to introduce. */
  cost?: number
  values: MetricValue[]
}

export function pinRun(r: SimResult, label: string, changes: string[], cost?: number): PinnedRun {
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label, unit: r.unit, level: r.level, seed: r.seed, cases: r.cases, runs: r.runs.length, changes, ...(cost !== undefined && { cost }), values: metricsOf(r) }
}

export interface PinColumn {
  pin: PinnedRun
  value: number | undefined
  /** Against the first pinned run. */
  delta?: Delta
}
export interface PinRow {
  metric: MetricValue
  cols: PinColumn[]
}

/** The pinned runs in columns (the first pinned is the base), Δ against the first. */
export function pinTable(pins: PinnedRun[]): PinRow[] {
  if (!pins.length) return []
  const rows: PinRow[] = []
  for (const mv of pins[0].values) {
    const base = mv.value
    rows.push({
      metric: mv,
      cols: pins.map((p, i) => {
        const v = p.values.find((x) => x.key === mv.key)?.value
        return { pin: p, value: v, delta: i === 0 ? undefined : deltaOf(base, v, mv.better) }
      }),
    })
  }
  return rows
}

export interface SummaryRow {
  id: string
  variant: string
  metric: string
  value: number | undefined
  target: number | undefined
  cost: number | undefined
  /** `pass` / `fail` / `no target`. */
  verdict: 'pass' | 'fail' | 'none'
  kind: MetricKind
}

/** "Variant / metric / target / cost / verdict": every pinned run judged on one metric. */
export function summaryRows(pins: PinnedRun[], judge: string | undefined, targets: Targets): SummaryRow[] {
  if (!judge) return []
  return pins.flatMap((p) => {
    const mv = p.values.find((x) => x.key === judge)
    if (!mv) return []
    const ok = meetsTarget(mv, mv.value, targets[judge])
    return [{ id: p.id, variant: p.label, metric: mv.label, value: mv.value, target: targets[judge], cost: p.cost, verdict: ok === undefined ? ('none' as const) : ok ? ('pass' as const) : ('fail' as const), kind: mv.kind }]
  })
}

// ---------------------------------------------------------------- scenario duration helper

/** "N cases in T": the arrival rate N / T per model unit and its inverse, the interval T / N (design note item 1). */
export function arrivalWindow(cases: number, windowIn: number): { rate: number; interval: number } | undefined {
  if (!(cases >= 1) || !(windowIn > 0) || !Number.isFinite(cases) || !Number.isFinite(windowIn)) return undefined
  return { rate: cases / windowIn, interval: windowIn / cases }
}
