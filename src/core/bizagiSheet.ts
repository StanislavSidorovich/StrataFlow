// "What to type into Bizagi" (v0.19.1): Bizagi does not read Flow's figures from a .bpmn file, so the same
// figures come as a sheet in Bizagi's own units and field order: time in MINUTES, a triangular time as
// Most likely / Min / Max (Flow: min / likely / max), the arrival as an interval between cases plus
// "Max. arrival count". One row per setting, grouped by simulation level. Pure function, no React.
import { branchShares, convertTime, isDecision } from './analysis'
import { labelMap } from './simLabels'
import type { FlowModel, FlowNode, Shape, TimeUnit } from './metamodel'
import type { Cell, Sheet } from './xlsx'

const bold = (v: string): Cell => ({ v, bold: true })
const r = (x: number) => Math.round(x * 1e4) / 1e4

export const BIZAGI_COLUMNS = ['Level', 'Lane', 'Element', 'Setting', 'Distribution in Bizagi', 'Value / Mean', 'Most likely', 'Min', 'Max', 'Std deviation', 'Note']
type Row = [string, string, string, string, string, Cell, Cell, Cell, Cell, Cell, string]

export interface BizagiSheet {
  sheets: Sheet[]
  /** Settings the sheet lists (0 = Flow holds no figures yet). */
  rows: number
}

/** A time in Bizagi's minutes, as the fields of Bizagi's distribution dialog. */
export function bizagiTime(mean: number | undefined, shape: Shape | undefined, unit: TimeUnit): { dist: string; value?: number; likely?: number; min?: number; max?: number; sd?: number; note: string } | undefined {
  const mins = (x: number) => r(convertTime(x, unit, 'min'))
  if (shape?.kind === 'triangular') return { dist: 'Triangular', likely: mins(shape.mode), min: mins(shape.min), max: mins(shape.max), note: 'Bizagi order: Most likely, Min, Max.' }
  if (shape?.kind === 'uniform') return { dist: 'Uniform', min: mins(shape.min), max: mins(shape.max), note: '' }
  if (mean === undefined) return undefined
  if (shape?.kind === 'normal') {
    const cut = shape.min !== undefined || shape.max !== undefined ? ' Flow also cuts it to a range; Bizagi does not.' : ''
    return { dist: 'Normal', value: mins(mean), sd: mins(shape.sd), note: `Mean and standard deviation.${cut}` }
  }
  if (shape?.kind === 'exp') return { dist: 'Exponential', value: mins(mean), note: 'Mean.' }
  return { dist: 'Constant', value: mins(mean), note: '' }
}

const hasCost = (m: FlowModel) => m.lanes.some((l) => (l.useCost ?? 0) > 0 || (l.hourlyCost ?? 0) > 0) || m.nodes.some((n) => (n.sim?.cost ?? 0) > 0)

const arrivals0 = (m: FlowModel) => m.sim?.arrivals

export function bizagiSheet(m: FlowModel): BizagiSheet {
  const unit: TimeUnit = m.sim?.unit ?? 'h'
  const label = labelMap(m)
  const laneOf = (n: FlowNode) => m.lanes.find((l) => l.id === n.laneId)?.name?.trim() || m.participants.find((p) => p.id === n.participantId)?.name?.trim() || ''
  const rows: Row[] = []
  const figures = !!arrivals0(m) || m.nodes.some((n) => n.sim && Object.keys(n.sim).length > 0)
  const blank = (level: string, lane: string, el: string, setting: string, dist: string, note: string): Row => [level, lane, el, setting, dist, null, null, null, null, null, note]
  const time = (level: string, n: FlowNode, setting: string, mean: number | undefined, shape: Shape | undefined, extra = '') => {
    const t = bizagiTime(mean, shape, unit)
    if (!t) return
    const row = blank(level, laneOf(n), label.get(n.id) ?? n.id, setting, t.dist, [t.note, extra].filter(Boolean).join(' '))
    row[5] = t.value ?? null
    row[6] = t.likely ?? null
    row[7] = t.min ?? null
    row[8] = t.max ?? null
    row[9] = t.sd ?? null
    rows.push(row)
  }

  // Level 1: the case count, gateway shares, boundary chances.
  const arrivals = m.sim?.arrivals
  const starts = m.nodes.filter((n) => n.type === 'event' && n.position === 'start')
  for (const s of starts) {
    const row = blank('1 Validation', laneOf(s), label.get(s.id) ?? s.id, 'Trigger counter (Max. arrival count)', '', 'Cases per run.')
    row[5] = m.sim?.cases ?? 200
    rows.push(row)
  }
  for (const g of m.nodes) {
    if (g.type !== 'gateway') continue
    const outs = m.flows.filter((f) => f.kind === 'sequence' && f.source === g.id)
    if (!isDecision(g, outs.length)) continue
    const shares = branchShares(outs)
    for (const f of outs) {
      const to = label.get(f.target) ?? f.target
      const row = blank('1 Validation', laneOf(g), label.get(g.id) ?? g.id, `Share of the flow to "${to}"${f.name ? ` (${f.name})` : ''}`, 'Percent', 'The shares of one gateway total 100.')
      row[5] = r((shares.get(f.id) ?? 0) * 100)
      rows.push(row)
    }
  }
  for (const b of m.nodes) {
    if (b.type !== 'event' || b.position !== 'boundary' || b.sim?.fires === undefined) continue
    const host = b.attachedTo ? label.get(b.attachedTo) ?? '' : ''
    const row = blank('1 Validation', laneOf(b), label.get(b.id) ?? b.id, `Chance that the event fires${host ? ` while "${host}" runs` : ''}`, 'Percent', 'If Bizagi offers shares only on flows, use this as the share of the flow out of the event.')
    row[5] = r(b.sim.fires * 100)
    rows.push(row)
  }

  // Level 2: the interval between cases, activity times, waits.
  if (arrivals && arrivals > 0) {
    const interval = r(convertTime(1 / arrivals, unit, 'min'))
    for (const s of starts) {
      const row = blank('2 Time', laneOf(s), label.get(s.id) ?? s.id, 'Interval between arrivals', m.sim?.arrivalShape === 'const' ? 'Constant' : 'Exponential', `Minutes (${interval >= 1440 ? `${r(interval / 1440)} days` : `${r(interval / 60)} h`}).`)
      row[5] = interval
      rows.push(row)
    }
  }
  for (const n of m.nodes) {
    if (n.type === 'task' || n.type === 'subProcess') time('2 Time', n, 'Processing time', n.sim?.duration, n.sim?.durationShape)
    if (n.type === 'task' || n.type === 'subProcess' || n.type === 'event') time('2 Time', n, 'Waiting time', n.sim?.wait, n.sim?.waitShape, 'If Bizagi has no waiting field here, add it to the time of the step before.')
  }

  // Level 3: people per lane.
  for (const l of m.lanes) {
    const row = blank('3 Resources', '', l.name?.trim() || 'Lane', 'Resource (role) and its quantity', '', 'Create the role, give it this many people, assign it to the lane\'s activities.')
    row[5] = l.capacity ?? 1
    rows.push(row)
  }

  const title: Cell[][] = [
    [bold('What to type into Bizagi Modeler (Simulation View)')],
    ["Bizagi does not read Flow's figures from the .bpmn file. All times here are minutes; a triangular time is in Bizagi's field order: Most likely, Min, Max."],
    [`Flow's time unit was ${unit === 'min' ? 'minutes' : unit === 'h' ? 'hours' : 'days'}.${hasCost(m) ? '' : " Costs and rates are not listed: leave Bizagi's cost fields empty."}`],
    ['Import the .bpmn into a new empty Bizagi file (a second import makes a second process). Do level 1 first, then 2, then 3.'],
    ...(arrivals && arrivals > 0 ? [[`Scenario duration: ${m.sim?.cases ?? 200} cases at this interval need about ${Math.ceil(((m.sim?.cases ?? 200) / arrivals) * (unit === 'min' ? 1 : unit === 'h' ? 60 : 1440) / 1440)} days of simulated time plus the time of the last case; set the duration before Start (in our test the run stopped at 30 days, after 4 cases).`]] : []),
    [],
  ]
  const body: Cell[][] = figures && rows.length
    ? [BIZAGI_COLUMNS.map(bold), ...rows.map((x) => [...x])]
    : [['Flow holds no simulation figures yet (nothing typed in the Simulate tab): there is nothing to enter in Bizagi.']]
  return { sheets: [{ name: 'Bizagi entry', rows: [...title, ...body], widths: [14, 22, 34, 44, 18, 12, 12, 10, 10, 12, 60] }], rows: figures ? rows.length : 0 }
}

export const bizagiSheetFileName = (m: FlowModel) => `${(m.name || 'process').trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').toLowerCase()}-bizagi-entry.xlsx`

/**
 * The flow names the Bizagi simulation copy leaves out (a named flow after a gateway makes Bizagi's simulation fail):
 * one row per flow, so the owner can type them in by hand after the simulation has been set up. `copy` is the model the
 * .bpmn was written from; the names come from `original`. Undefined when no name was dropped.
 */
export function flowLabelsSheet(original: FlowModel, copy: FlowModel): Sheet | undefined {
  const label = labelMap(original)
  const laneOf = (id: string | undefined) => {
    const n = original.nodes.find((x) => x.id === id)
    return (n && (original.lanes.find((l) => l.id === n.laneId)?.name?.trim() || original.participants.find((p) => p.id === n.participantId)?.name?.trim())) || ''
  }
  const rows: Cell[][] = []
  for (const f of original.flows) {
    if (f.kind !== 'sequence' || !f.name) continue
    if (copy.flows.find((c) => c.id === f.id)?.name) continue
    rows.push([laneOf(f.source), label.get(f.source) ?? f.source, label.get(f.target) ?? f.target, f.name])
  }
  if (!rows.length) return undefined
  return {
    name: 'Labels to add',
    rows: [
      [bold('Flow names to type into Bizagi by hand')],
      ["The .bpmn leaves these names out: Bizagi's simulation fails on a named flow after a gateway. After the simulation runs, double-click the flow and type the name, or skip it."],
      [],
      ['Lane', 'From (gateway)', 'To', 'Name to type'].map(bold),
      ...rows,
    ],
    widths: [24, 44, 44, 16],
  }
}
