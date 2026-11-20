// The tables of a simulation result as rows of cells: the sheets of the .xlsx export and the "Copy table" text
// (stage 6b phase 4; design §4.5). One place builds them, so the file and the clipboard agree.
import { UNIT_NAMES, type Analysis } from './analysis'
import { deltaOf, pinTable, summaryRows, type PinnedRun, type Targets } from './whatIf'
import type { Cell, Sheet } from './xlsx'
import type { SimResult } from './simulate'

const bold = (v: string): Cell => ({ v, bold: true })
const head = (...cols: string[]): Cell[] => cols.map(bold)
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined)
const pctCell = (v: number | undefined): Cell => ({ v, fmt: 'pct' })

export function processRows(r: SimResult, f?: Analysis): Cell[][] {
  const u = UNIT_NAMES[r.unit]
  const k = r.kpis
  const row = (label: string, iv: { mean: number; half?: number } | undefined, formula?: number, percent = false): Cell[] => [label, percent ? pctCell(iv?.mean) : iv?.mean, percent ? pctCell(iv?.half) : iv?.half, percent ? pctCell(formula) : formula]
  const rows: Cell[][] = [head('Process', 'Run (mean over runs)', '± 95 % interval', 'Formula')]
  rows.push(row(`Cycle time (${u})`, k.cycleTime, f?.cycleTime))
  rows.push(row(`Processing (${u})`, k.processing, f?.processingTime))
  rows.push(row(`Typed waiting (${u})`, k.typedWait, f?.waitingTime))
  if (r.level === 3) rows.push(row(`Waiting for a person (${u})`, k.resourceWait))
  rows.push(row('Efficiency', k.efficiency, f?.efficiency, true))
  rows.push(row('Cost per case', k.cost, f?.cost))
  rows.push(['Cycle time, slowest 10 % starts at (' + u + ')', mean(r.runs.map((x) => x.cycleTime.p90))])
  rows.push(row(`Completed per ${u === 'days' ? 'day' : u}`, k.throughput, r.arrivals))
  rows.push(row('Cases open at once, on average', k.wip))
  if (k.onTime) rows.push(row(r.target !== undefined ? `Cases within ${r.target} ${u}` : 'On time', k.onTime, undefined, true))
  return rows
}

export function elementRows(r: SimResult): Cell[][] {
  const u = UNIT_NAMES[r.unit]
  const rows: Cell[][] = [
    head('Name', 'Type', 'Instances started', 'Instances completed', `Avg time (${u})`, `Min time (${u})`, `Max time (${u})`, `Total time (${u})`, `Avg time waiting for a person (${u})`, `Min wait (${u})`, `Max wait (${u})`, `Standard deviation of wait (${u})`, `Total time waiting for a person (${u})`, `Avg typed wait (${u})`, 'Total fixed cost', 'Total unit cost'),
  ]
  for (const e of r.elements) {
    if (e.type === 'dataObject' || e.type === 'dataStore' || e.type === 'annotation') continue
    const t = e.time
    const w = e.resourceWait
    rows.push([e.name || e.type, e.type, e.started, e.completed, t.n ? t.mean : null, t.n ? t.min : null, t.n ? t.max : null, t.n ? t.total : null, w.n ? w.mean : null, w.n ? w.min : null, w.n ? w.max : null, w.n ? w.sd : null, w.n ? w.total : null, e.typedWait.n ? e.typedWait.mean : null, e.fixedCost, e.unitCost])
  }
  return rows
}

export function laneRows(r: SimResult, f?: Analysis): Cell[][] {
  const u = UNIT_NAMES[r.unit]
  const rows: Cell[][] = [head('Resource (lane)', 'People', 'Utilization (run)', '± 95 % interval', 'Utilization (formula)', 'Queue average', 'Queue longest', `Wait per request (${u})`, `Wait per request, M/M/c estimate (${u})`, 'Total fixed cost', 'Total unit cost', 'Total cost')]
  for (const l of r.lanes) {
    const res = f?.resources.find((x) => x.laneId === l.laneId)
    const q = f?.queues.find((x) => x.laneId === l.laneId)
    rows.push([l.name || 'Lane', l.capacity, pctCell(l.utilisation.mean), pctCell(l.utilisation.half), pctCell(res?.utilisation), l.avgQueue, l.maxQueue, r.level === 3 ? l.meanWait : null, q && !q.overloaded ? q.wait : null, l.fixedCost, l.unitCost, l.totalCost])
  }
  return rows
}

const metricCell = (kind: string, v: number | undefined): Cell => (kind === 'pct' ? pctCell(v) : v)

/** The pinned runs: one block "variant / metric / target / cost / verdict" and the figures in columns with Δ against the first. */
export function scenarioRows(pins: PinnedRun[], targets: Targets, judge: string | undefined): Cell[][] {
  if (!pins.length) return [['No scenario to list yet.'], ['Run a what-if with "Run both", or press Pin base and Pin scenario, then export again.']]
  const rows: Cell[][] = []
  // One line per scenario and figure, against the first run (the base): the table a report needs.
  rows.push(head('Scenario', 'Changes', 'KPI', 'Base', 'Scenario value', 'Δ', 'Δ %'))
  if (pins.length < 2) rows.push(['Only the base is pinned: press Pin scenario (or Run both) to compare.'])
  for (const p of pins.slice(1)) {
    for (const mv of pins[0].values) {
      const v = p.values.find((x) => x.key === mv.key)
      const d = deltaOf(mv.value, v?.value, mv.better)
      rows.push([p.label, p.changes.join('; ') || 'none', mv.label, metricCell(mv.kind, mv.value), metricCell(mv.kind, v?.value), d === undefined ? null : metricCell(mv.kind, d.delta), d?.pct === undefined ? null : pctCell(d.pct)])
    }
  }
  rows.push([])
  rows.push(head('Variant', 'Changes', 'Cost of the variant', 'Seed', 'Cases × runs'))
  for (const p of pins) rows.push([p.label, p.changes.join('; ') || 'none (base)', p.cost, p.seed, `${p.cases} × ${p.runs}`])
  const sum = summaryRows(pins, judge, targets)
  if (sum.length) {
    rows.push([])
    rows.push(head('Variant', 'Metric', 'Value', 'Target', 'Cost', 'Verdict'))
    for (const s of sum) rows.push([s.variant, s.metric, metricCell(s.kind, s.value), metricCell(s.kind, s.target), s.cost, s.verdict === 'pass' ? 'meets the target' : s.verdict === 'fail' ? 'misses the target' : 'no target'])
  }
  rows.push([])
  const table = pinTable(pins)
  const cols: Cell[] = [bold('Figure')]
  pins.forEach((p, i) => (i === 0 ? cols.push(bold(p.label)) : cols.push(bold(p.label), bold('Δ'), bold('Δ %'))))
  rows.push(cols)
  for (const t of table) {
    const row: Cell[] = [t.metric.label]
    t.cols.forEach((c, i) => {
      row.push(metricCell(t.metric.kind, c.value))
      if (i > 0) row.push(c.delta === undefined ? null : metricCell(t.metric.kind, c.delta.delta), c.delta?.pct === undefined ? null : pctCell(c.delta.pct))
    })
    rows.push(row)
  }
  return rows
}

export interface WorkbookInput {
  result: SimResult
  formula?: Analysis
  pins: PinnedRun[]
  targets: Targets
  judge?: string
  /** For the Summary sheet; the page passes today's date, tests a fixed one. */
  date: string
}

/** Summary, Elements, Lanes, Scenarios. */
export function buildWorkbookSheets(i: WorkbookInput): Sheet[] {
  const r = i.result
  const u = UNIT_NAMES[r.unit]
  const info: Cell[][] = [
    [bold(r.name || 'Process')],
    ['Level', r.level],
    ['Cases per run', r.cases],
    ['Runs', r.runs.length],
    ['Seed', r.seed],
    [`New cases per ${u === 'days' ? 'day' : u}`, r.arrivals],
    ['Arrivals', r.arrivalShape === 'const' ? 'regular' : 'random (Poisson)'],
    ['Time unit', u],
    ['Date', i.date],
    [],
  ]
  const summary = [...info, ...processRows(r, i.formula)]
  if (r.notes.length) summary.push([], head('Notes'), ...r.notes.map((n): Cell[] => [n]))
  return [
    { name: 'Summary', rows: summary, widths: [44, 22, 18, 14] },
    { name: 'Elements', rows: elementRows(r), widths: [28, 14, 12, 12, 12, 12, 12, 12, 16, 12, 12, 14, 16, 14, 12, 12] },
    { name: 'Lanes', rows: laneRows(r, i.formula), widths: [26, 10, 16, 14, 18, 12, 12, 18, 22, 14, 14, 12] },
    { name: 'Scenarios', rows: scenarioRows(i.pins, i.targets, i.judge), widths: [34, 40, 28, 16, 16, 14, 12] },
  ]
}

/** File name: `<process> simulation L<level> seed<seed>.xlsx`, without characters a file system refuses. */
export function xlsxFileName(r: SimResult, tag?: string): string {
  const clean = (t: string) => t.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const base = clean(r.name || 'process') || 'process'
  const extra = tag && clean(tag) ? ` ${clean(tag).slice(0, 40)}` : ''
  return `${base} simulation${extra} L${r.level} seed${r.seed}.xlsx`
}
