// What-if in the Run tab (stage 6b phase 4; design §5.4). A scenario is a short list of changes; "Run both" runs the model and
// the scenario on the same seed and shows the two side by side with Δ, Δ % and a target per figure. Up to three runs can be
// pinned in columns, judged on one figure against its target and a typed cost, exported to .xlsx or copied as a table.
import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, Pin, PinOff, Play, Plus, X } from 'lucide-react'
import { UNIT_NAMES, type Analysis } from '../../core/analysis'
import type { FlowModel, TimeUnit } from '../../core/metamodel'
import { parseNum } from '../../core/number'
import { setSimSettings } from '../../core/ops'
import { buildWorkbookSheets, scenarioRows, xlsxFileName } from '../../core/simTables'
import {
  MAX_PINS,
  applyChanges,
  arrivalWindow,
  checkChange,
  compareResults,
  describeChange,
  meetsTarget,
  parseTime,
  picksFor,
  pinRun,
  pinTable,
  resolveChanges,
  summaryRows,
  validTarget,
  type Change,
  type ChangeKind,
  type Delta,
  type MetricKind,
  type MetricValue,
} from '../../core/whatIf'
import { toTsv, xlsxBlob, type Cell } from '../../core/xlsx'
import { saveExport } from '../files'
import { useEditor } from '../store'
import { useRun, type RunResult } from '../simRun'
import { useWhatIf } from '../whatIf'
import { count, fmt, pct } from './simFormat'
import './whatIf.css'

const perUnit = (u: string) => (u === 'days' ? 'day' : u)

/** A figure in its kind: a share as %, the rest as a number. */
const show = (kind: MetricKind, v: number | undefined) => (kind === 'pct' ? pct(v) : kind === 'count' ? fmt(v, 3) : fmt(v))

// ---------------------------------------------------------------- small shared parts

/** A text field for a figure with a unit or a share: the draft is kept as typed, red with the reason when it does not parse. */
function ValueField({ value, parse, onCommit, placeholder, title, testid, label }: { value: number | undefined; parse: (text: string) => { value?: number; error?: string; converted?: string }; onCommit: (v: number | undefined) => void; placeholder?: string; title?: string; testid?: string; label?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ error?: string; converted?: string }>({})
  const shown = value === undefined || !Number.isFinite(value) ? '' : String(Math.round(value * 1e6) / 1e6)
  return (
    <span className="num-field">
      <input
        className={`sim-num${msg.error ? ' is-invalid' : ''}`}
        inputMode="decimal"
        value={draft ?? shown}
        placeholder={placeholder}
        title={msg.error ?? title}
        aria-label={label}
        aria-invalid={msg.error ? true : undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          const p = parse(e.target.value)
          setMsg({ error: p.error, converted: p.converted })
          if (!p.error) onCommit(p.value)
        }}
        onBlur={() => {
          setDraft(null)
          setMsg({})
        }}
        data-testid={testid}
      />
      {msg.error && (
        <span className="num-error" role="alert" data-testid={testid ? `${testid}:error` : undefined}>
          {msg.error}
        </span>
      )}
      {!msg.error && msg.converted && <span className="muted wi-conv">{msg.converted}</span>}
    </span>
  )
}

/** Tab-separated text of the rows to the clipboard (decimals as the browser's locale writes them). */
export function CopyTable({ rows, testid }: { rows: () => Cell[][]; testid?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toTsv(rows(), typeof navigator === 'undefined' ? undefined : navigator.language))
      setState('ok')
    } catch {
      setState('fail')
    }
    setTimeout(() => setState('idle'), 2500)
  }
  return (
    <button className="btn wi-copy" onClick={copy} title="Copy this table as text: paste it into Excel or Google Sheets" data-testid={testid ?? 'wi-copy'}>
      <Copy size={12} /> {state === 'ok' ? 'Copied' : state === 'fail' ? 'Could not copy' : 'Copy table'}
    </button>
  )
}

const todayIso = () => new Date().toISOString().slice(0, 10)

/** Save the workbook (Summary, Elements, Lanes, Scenarios): the save dialog first where the browser has one. */
export function ExportButton({ run }: { run: RunResult }) {
  const pins = useWhatIf((s) => s.pins)
  const targets = useWhatIf((s) => s.targets)
  const judge = useWhatIf((s) => s.judge)
  const compare = useRun((s) => s.compare)
  const [msg, setMsg] = useState<string | null>(null)
  const noPicker = typeof window !== 'undefined' && !('showSaveFilePicker' in window)
  const go = async () => {
    setMsg(null)
    try {
      const entries = pins.length ? pins : compare ? [pinRun(compare.base.result, 'Base', []), pinRun(compare.scenario.result, compare.name || 'Scenario', compare.described)] : []
      const sheets = buildWorkbookSheets({ result: run.result, formula: run.formula, pins: entries, targets, judge, date: todayIso() })
      const name = await saveExport(xlsxFileName(run.result), 'xlsx', async () => xlsxBlob(sheets))
      setMsg(name ? `Saved ${name}` : null)
    } catch (e) {
      setMsg(`Could not save: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return (
    <span className="wi-export">
      <button className="btn" onClick={go} title="An Excel file: Summary, Elements, Lanes, Scenarios" data-testid="run-xlsx">
        <Download size={13} /> Excel (.xlsx)
      </button>
      {msg && (
        <span className="muted" role="status" data-testid="run-xlsx-msg">
          {msg}
        </span>
      )}
      {(noPicker || msg) && <span className="muted wi-dm">If a download manager took the file, use Copy table.</span>}
    </span>
  )
}

/** Keeps the current result as a column for comparison. */
export function PinButton({ run, label, changes }: { run: RunResult; label?: string; changes?: string[] }) {
  const pins = useWhatIf((s) => s.pins)
  const [msg, setMsg] = useState<string | null>(null)
  const go = () => {
    const p = pinRun(run.result, label ?? `Run L${run.result.level} seed ${run.result.seed}`, changes ?? [], undefined)
    const dup = pins.some((x) => x.label === p.label && x.seed === p.seed && x.level === p.level && JSON.stringify(x.values) === JSON.stringify(p.values))
    if (dup) return setMsg('Already pinned')
    if (!useWhatIf.getState().pin(p)) return setMsg(`${MAX_PINS} runs are pinned: unpin one first`)
    setMsg(null)
  }
  return (
    <span className="wi-pinwrap">
      <button className="btn" onClick={go} title={`Keep this run as a column to compare (up to ${MAX_PINS})`} data-testid="run-pin">
        <Pin size={13} /> Pin this run
      </button>
      {msg && <span className="muted" role="status">{msg}</span>}
    </span>
  )
}

// ---------------------------------------------------------------- scenario duration ("N cases in T")

/** "N cases in T hours" → arrival rate N/T (interval T/N), the way Bizagi's scenario duration and arrival count work. */
export function DurationHelper({ model }: { model: FlowModel }) {
  const unit: TimeUnit = model.sim?.unit ?? 'min'
  const [n, setN] = useState('')
  const [t, setT] = useState('')
  const apply = useEditor((s) => s.apply)
  const [error, setError] = useState<string | null>(null)
  const pn = parseNum(n)
  const pt = parseTime(t, unit)
  const win = pn.value !== undefined && pt.value !== undefined && !pn.error && !pt.error ? arrivalWindow(pn.value, pt.value) : undefined
  const u = UNIT_NAMES[unit]
  const use = () => {
    if (!win || pn.value === undefined) return
    const ok = apply((m) => setSimSettings(m, { arrivals: Math.round(win.rate * 1e6) / 1e6, cases: pn.value }), { coalesce: 'sim:window' })
    if (ok) setError(null)
    else {
      setError(useEditor.getState().error ?? 'Not accepted')
      useEditor.getState().showError(null)
    }
  }
  return (
    <div className="wi-window row" data-testid="run-window">
      <span title="Bizagi's scenario: a duration and a number of arrivals. Here the same thing sets the arrival rate and the cases per run.">
        <strong>N cases in T</strong>
      </span>
      <label>
        N <input className={`sim-num${pn.error ? ' is-invalid' : ''}`} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} placeholder="200" aria-label="Number of cases" data-testid="run-window-n" />
      </label>
      <label>
        T{' '}
        <input className={`sim-num${pt.error ? ' is-invalid' : ''}`} value={t} onChange={(e) => setT(e.target.value)} placeholder={`24 or 3 d (${u})`} title={`A bare number is in ${u}; add min, h or d to use another unit`} aria-label="Scenario duration" data-testid="run-window-t" />
      </label>
      {(pn.error || pt.error) && <span className="num-error">{pn.error ?? pt.error}</span>}
      {win && (
        <span className="muted" data-testid="run-window-out">
          interval T/N = {fmt(win.interval, 4)} {u}; {fmt(win.rate, 4)} new per {perUnit(u)}
          {pt.converted ? ` (${pt.converted})` : ''}
        </span>
      )}
      <button className="btn" onClick={use} disabled={!win} title="Set the new cases per time unit and the cases per run" data-testid="run-window-use">
        Use
      </button>
      {error && <span className="num-error" role="alert">{error}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- the scenario editor

const KINDS: { kind: ChangeKind; label: string }[] = [
  { kind: 'capacity', label: 'People in a lane' },
  { kind: 'arrivals', label: 'Arrivals × factor' },
  { kind: 'duration', label: 'Time of a task' },
  { kind: 'wait', label: 'Typed wait' },
  { kind: 'cost', label: 'Cost of a task' },
  { kind: 'branch', label: 'Share of a branch' },
  { kind: 'skip', label: 'Skip a task' },
  { kind: 'fires', label: 'Chance of a boundary event' },
]

/** What the element has now, for the placeholder ("was 0.5"). */
function currentOf(m: FlowModel, kind: ChangeKind, id: string): string {
  if (kind === 'capacity') return String(m.lanes.find((l) => l.id === id)?.capacity ?? 1)
  const n = m.nodes.find((x) => x.id === id)
  if (kind === 'duration' || kind === 'wait' || kind === 'cost') return n?.sim?.[kind] === undefined ? '0' : String(n.sim[kind])
  if (kind === 'fires') return n?.sim?.fires === undefined ? '0 %' : `${Math.round(n.sim.fires * 1000) / 10} %`
  return ''
}

function ChangeForm({ model }: { model: FlowModel }) {
  const [kind, setKind] = useState<ChangeKind>('capacity')
  const [target, setTarget] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const selection = useEditor((s) => s.selection)
  const picks = useMemo(() => picksFor(model, kind), [model, kind])
  const unit = model.sim?.unit ?? 'min'

  // A click on the canvas picks the target (and the kind it fits, when the current kind does not).
  useEffect(() => {
    if (selection.length !== 1) return
    const id = selection[0]
    if (validTarget(model, kind, id)) return setTarget(id)
    const fit = (['capacity', 'branch', 'fires', 'duration'] as ChangeKind[]).find((k) => validTarget(model, k, id))
    if (fit) {
      setKind(fit)
      setTarget(id)
      setText('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])
  useEffect(() => {
    if (kind !== 'arrivals' && target && !validTarget(model, kind, target)) setTarget('')
  }, [kind, target, model])

  const percent = kind === 'branch' || kind === 'fires'
  const parseValue = (): { value?: number; error?: string } => {
    if (kind === 'skip') return { value: 0 }
    if (kind === 'duration' || kind === 'wait') return parseTime(text, unit)
    const p = parseNum(text, { percent })
    if (p.error || p.value === undefined) return { error: p.error ?? 'Type a number' }
    return { value: percent ? p.value / 100 : p.value }
  }
  const add = () => {
    const v = parseValue()
    if (v.error || (v.value === undefined && kind !== 'skip')) return setError(v.error ?? 'Type a number')
    const c: Change = kind === 'arrivals' ? { kind, factor: v.value! } : kind === 'skip' ? { kind, id: target } : ({ kind, id: target, value: v.value! } as Change)
    const why = checkChange(model, c)
    if (why) return setError(why)
    useWhatIf.getState().addChange(c)
    setError(null)
    setText('')
  }
  const needsValue = kind !== 'skip'
  const placeholder = kind === 'arrivals' ? '1.5' : percent ? '% (30)' : target ? `was ${currentOf(model, kind, target)}` : 'new value'
  return (
    <div className="wi-form row" data-testid="wi-form">
      <select value={kind} onChange={(e) => setKind(e.target.value as ChangeKind)} aria-label="What to change" data-testid="wi-kind">
        {KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.label}
          </option>
        ))}
      </select>
      {kind !== 'arrivals' && (
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Which element" title="Pick here or click the element on the diagram" data-testid="wi-target">
          <option value="">{picks.length ? 'pick one, or click it on the diagram' : 'nothing of this kind in the model'}</option>
          {picks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      {needsValue && (
        <input
          className={`sim-num${error ? ' is-invalid' : ''}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={placeholder}
          title={kind === 'duration' || kind === 'wait' ? `In ${UNIT_NAMES[unit]}; or type 90 min, 2 h, 1 d` : undefined}
          aria-label="New value"
          data-testid="wi-value"
        />
      )}
      <button className="btn" onClick={add} data-testid="wi-add">
        <Plus size={13} /> Add change
      </button>
      {error && (
        <span className="num-error" role="alert" data-testid="wi-error">
          {error}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the section

export function WhatIfSection({ a, model, needArrivals }: { a: Analysis | undefined; model: FlowModel; needArrivals: boolean }) {
  const run = useRun()
  const apply = useEditor((s) => s.apply)
  const scenario = useWhatIf((s) => s.scenario)
  const targets = useWhatIf((s) => s.targets)
  const [applied, setApplied] = useState<string[] | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const resolved = useMemo(() => resolveChanges(model, scenario.changes), [model, scenario.changes])
  const empty = scenario.changes.length === 0
  const active = scenario.changes.length - resolved.dead.length
  const why = !a ? 'Draw a process with a start event first' : empty ? 'Add at least one change: a scenario with no changes is the model itself' : active === 0 ? 'Every change is about an element that is no longer in the model' : needArrivals ? `Level 3 needs the arrival rate: how many new cases per ${perUnit(UNIT_NAMES[model.sim?.unit ?? 'min'])}?` : undefined
  const go = () => run.startCompare(a?.poolId, { name: scenario.name || scenario.changes.map((c) => describeChange(model, c)).join(', '), changes: scenario.changes }, targets.cycle !== undefined ? { target: targets.cycle } : {})
  const applyToModel = () => {
    setApplied(null)
    setApplyError(null)
    let notes: string[] = []
    const ok = apply((m) => {
      notes = applyChanges(m, scenario.changes)
    })
    if (ok) {
      setApplied(notes)
      useWhatIf.getState().clearScenario()
    } else {
      setApplyError(useEditor.getState().error ?? 'Not accepted')
      useEditor.getState().showError(null)
    }
  }
  return (
    <section className="wi" aria-label="What if" data-testid="whatif">
      <h3>
        What if <span className="muted">change one thing, run both on the same seed, read the difference</span>
      </h3>
      <ChangeForm model={model} />
      {!empty && (
        <ul className="wi-changes" data-testid="wi-changes">
          {scenario.changes.map((c, i) => {
            const dead = resolved.dead.includes(c)
            return (
              <li key={`${c.kind}:${'id' in c ? c.id : ''}`} className={dead ? 'is-dead' : undefined} data-testid="wi-change">
                <span>{describeChange(model, c)}</span>
                {dead && <em> (no longer in the model)</em>}
                <button className="btn icon" onClick={() => useWhatIf.getState().removeChange(i)} aria-label={`Remove ${describeChange(model, c)}`} title="Remove this change">
                  <X size={12} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="wi-name row">
        <label>
          Name{' '}
          <input className="wi-text" value={scenario.name} onChange={(e) => useWhatIf.getState().setName(e.target.value)} placeholder="e.g. Second packer" aria-label="Scenario name" data-testid="wi-name" />
        </label>
        <label title="What the variant costs to introduce, by hand: the model has no figure for it">
          Cost of the variant <ValueField value={scenario.cost} parse={(t) => parseNum(t)} onCommit={(v) => useWhatIf.getState().setCost(v)} placeholder="0" testid="wi-cost" />
        </label>
      </div>
      {resolved.notes.length > 0 && (
        <ul className="sim-notes" data-testid="wi-notes">
          {resolved.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="row wi-go">
        <button className="btn is-primary" onClick={go} disabled={run.running || !!why} title={why ?? 'Run the model and the scenario on the same seed'} data-testid="wi-run">
          <Play size={14} /> Run both
        </button>
        <button className="btn" onClick={applyToModel} disabled={run.running || active === 0} title="Write these changes into the model as one edit you can undo" data-testid="wi-apply">
          Apply to the model
        </button>
        <button className="btn" onClick={() => useWhatIf.getState().clearScenario()} disabled={empty && !scenario.name} data-testid="wi-clear">
          Clear
        </button>
        {run.running && run.phase && <span className="muted" data-testid="wi-phase">{run.phase === 'base' ? 'Running the model…' : 'Running the scenario…'}</span>}
        {why && !run.running && (
          <span className="muted" data-testid="wi-why">
            {why}
          </span>
        )}
      </div>
      {applied && (
        <p className="run-banner is-info" role="status" data-testid="wi-applied">
          Applied to the model (Undo takes it back). The scenario is cleared: run again to see the new model.
          {applied.length > 0 && ` ${applied.join('. ')}.`}
        </p>
      )}
      {applyError && (
        <p className="run-banner is-error" role="alert">
          {applyError}
        </p>
      )}
      {run.compare && <CompareView model={model} />}
      <Pinned model={model} />
    </section>
  )
}

// ---------------------------------------------------------------- base against scenario

const arrow = (d: Delta | undefined) => (!d || d.delta === 0 ? '' : d.delta > 0 ? '▲' : '▼')
const cls = (d: Delta | undefined) => (d?.verdict === 'better' ? 'is-better' : d?.verdict === 'worse' ? 'is-worse' : '')
const dtxt = (kind: MetricKind, d: Delta | undefined) => (d ? (kind === 'pct' ? `${d.delta > 0 ? '+' : ''}${Math.round(d.delta * 10000) / 100} pt` : `${d.delta > 0 ? '+' : ''}${fmt(d.delta, Math.abs(d.delta) < 0.1 ? 3 : 2)}`) : '')

function TargetCell({ metric, value, unit }: { metric: MetricValue; value: number | undefined; unit: TimeUnit }) {
  const targets = useWhatIf((s) => s.targets)
  const t = targets[metric.key]
  const parse = (text: string) => (metric.kind === 'time' ? parseTime(text, unit) : metric.kind === 'pct' ? ((p) => (p.value === undefined ? p : { value: p.value / 100 }))(parseNum(text, { percent: true })) : parseNum(text))
  const shown = t === undefined ? undefined : metric.kind === 'pct' ? Math.round(t * 1000) / 10 : t
  const ok = meetsTarget(metric, value, t)
  return (
    <>
      <td>
        <ValueField
          value={shown}
          parse={parse}
          onCommit={(v) => useWhatIf.getState().setTarget(metric.key, v)}
          placeholder={metric.kind === 'time' ? `≤ ${UNIT_NAMES[unit]}` : metric.kind === 'pct' ? '% ' : ''}
          title={metric.kind === 'time' ? `In ${UNIT_NAMES[unit]} (the model's unit). Type 90 min or 2 h to convert.` : 'Target for this figure'}
          testid={`wi-target:${metric.key}`}
          label={`Target for ${metric.label}`}
        />
      </td>
      <td data-testid={`wi-ok:${metric.key}`}>{ok === undefined ? '' : ok ? <span className="is-better">✓ meets</span> : <span className="is-worse">✗ misses</span>}</td>
    </>
  )
}

function CompareView({ model }: { model: FlowModel }) {
  const compare = useRun((s) => s.compare)!
  const unit = model.sim?.unit ?? 'min'
  const rows = useMemo(() => compareResults(compare.base.result, compare.scenario.result), [compare])
  const stale = compare.base.model !== model
  const pins = useWhatIf((s) => s.pins)
  const [msg, setMsg] = useState<string | null>(null)
  const pinPair = (which: 'base' | 'scenario') => {
    const st = useWhatIf.getState()
    const label = which === 'base' ? 'Base' : compare.name || 'Scenario'
    const cost = which === 'scenario' ? st.scenario.cost : undefined
    const make = (w: 'base' | 'scenario') => pinRun(compare[w === 'base' ? 'base' : 'scenario'].result, w === 'base' ? 'Base' : label, w === 'base' ? [] : compare.described, w === 'scenario' ? cost : undefined)
    const need = which === 'scenario' && st.pins.length === 0 ? 2 : 1
    if (st.pins.length + need > MAX_PINS) return setMsg(`${MAX_PINS} runs are pinned: unpin one first`)
    const mine = make(which)
    if (st.pins.some((p) => p.label === mine.label && p.seed === mine.seed && JSON.stringify(p.values) === JSON.stringify(mine.values))) return setMsg('Already pinned')
    if (which === 'scenario' && st.pins.length === 0) st.pin(make('base')) // the base always comes first
    st.pin(mine)
    setMsg(null)
  }
  const r = compare.scenario.result
  const tableRows = () => [['Figure', 'Base', compare.name || 'Scenario', 'Δ', 'Δ %'] as Cell[], ...rows.map((x): Cell[] => [x.metric.label, { v: x.base, fmt: x.metric.kind === 'pct' ? 'pct' : undefined }, { v: x.scenario, fmt: x.metric.kind === 'pct' ? 'pct' : undefined }, x.delta?.delta, { v: x.delta?.pct, fmt: 'pct' }])]
  return (
    <div className={`wi-compare${stale ? ' is-stale' : ''}`} data-testid="wi-compare">
      <div className="row wi-head">
        <strong>
          Base against {compare.name || 'the scenario'} · level {r.level} · {r.runs.length} × {count(r.cases)} cases · seed {r.seed} for both
        </strong>
        <button className="btn" onClick={() => pinPair('base')} disabled={pins.some((p) => p.label === 'Base')} data-testid="wi-pin-base">
          <Pin size={13} /> Pin base
        </button>
        <button className="btn" onClick={() => pinPair('scenario')} data-testid="wi-pin-scenario">
          <Pin size={13} /> Pin scenario
        </button>
        <CopyTable rows={tableRows} testid="wi-copy-compare" />
        {msg && <span className="muted" role="status">{msg}</span>}
      </div>
      {stale && (
        <p className="run-banner is-warn" role="status" data-testid="wi-stale">
          The model changed since this comparison: the numbers are from the earlier version.
        </p>
      )}
      {compare.notes.length > 0 && (
        <ul className="sim-notes">
          {compare.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="run-scroll">
        <table className="sim-table run-table wi-table" data-testid="wi-table">
          <thead>
            <tr>
              <th>Figure</th>
              <th>Base</th>
              <th>{compare.name || 'Scenario'}</th>
              <th title="Scenario minus base">Δ</th>
              <th title="Relative to the base">Δ %</th>
              <th title={`A target the figure should meet, in the model's unit (${UNIT_NAMES[unit]}) unless you type a unit`}>Target</th>
              <th>Scenario</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.metric.key} data-testid={`wi-row:${x.metric.key}`}>
                <td>
                  {x.metric.label}
                  {x.metric.kind === 'time' ? ` (${UNIT_NAMES[unit]})` : ''}
                </td>
                <td className="run-num">{show(x.metric.kind, x.base)}</td>
                <td className="run-num">{show(x.metric.kind, x.scenario)}</td>
                <td className={`run-num ${cls(x.delta)}`} data-testid={`wi-delta:${x.metric.key}`}>
                  {arrow(x.delta)} {dtxt(x.metric.kind, x.delta)}
                </td>
                <td className={`run-num ${cls(x.delta)}`}>{x.delta?.pct === undefined ? '' : `${x.delta.pct > 0 ? '+' : ''}${Math.round(x.delta.pct * 1000) / 10} %`}</td>
                <TargetCell metric={x.metric} value={x.scenario} unit={unit} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted wi-legend">Green = better, red = worse (lower is better for times and costs). Both runs share the seed, so they see the same orders and the same dice: the difference is the change, not luck.</p>
    </div>
  )
}

// ---------------------------------------------------------------- pinned runs

function Pinned({ model }: { model: FlowModel }) {
  const pins = useWhatIf((s) => s.pins)
  const targets = useWhatIf((s) => s.targets)
  const judge = useWhatIf((s) => s.judge)
  const unit = model.sim?.unit ?? 'min'
  const table = useMemo(() => pinTable(pins), [pins])
  if (!pins.length) return null
  const mismatch = pins.filter((p) => p.unit !== unit)
  const judgeable = pins[0].values.filter((v) => v.better !== 'none')
  const jkey = judge && judgeable.some((v) => v.key === judge) ? judge : undefined
  const sum = summaryRows(pins, jkey, targets)
  const kind = judgeable.find((v) => v.key === jkey)
  const rows = () => scenarioRows(pins, targets, jkey)
  return (
    <div className="wi-pins" data-testid="wi-pins">
      <div className="row wi-head">
        <strong>Pinned runs</strong>
        <span className="muted">
          {pins.length} of {MAX_PINS}; the first is the base
        </span>
        <CopyTable rows={rows} testid="wi-copy-pins" />
        <button className="btn" onClick={() => useWhatIf.getState().clearPins()} data-testid="wi-unpin-all">
          <PinOff size={13} /> Unpin all
        </button>
      </div>
      {mismatch.length > 0 && (
        <p className="run-banner is-warn" role="status">
          {mismatch.map((p) => p.label).join(', ')} {mismatch.length === 1 ? 'was' : 'were'} run in {UNIT_NAMES[mismatch[0].unit]}, the model is in {UNIT_NAMES[unit]} now: their times are not comparable.
        </p>
      )}
      <div className="run-scroll">
        <table className="sim-table run-table wi-table" data-testid="wi-pin-table">
          <thead>
            <tr>
              <th>Figure</th>
              {pins.map((p, i) => (
                <th key={p.id} colSpan={i === 0 ? 1 : 2} title={p.changes.join('; ') || 'the model as it was'}>
                  {p.label}
                  <button className="btn icon" onClick={() => useWhatIf.getState().unpin(p.id)} aria-label={`Unpin ${p.label}`} title="Unpin">
                    <X size={12} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.map((row) => (
              <tr key={row.metric.key}>
                <td>{row.metric.label}</td>
                {row.cols.map((c, i) => (
                  <PinCells key={c.pin.id} kind={row.metric.kind} value={c.value} delta={c.delta} first={i === 0} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="wi-sub">Which variant meets the target?</h4>
      <div className="row wi-judge">
        <label>
          Judge on{' '}
          <select value={jkey ?? ''} onChange={(e) => useWhatIf.getState().setJudge(e.target.value || undefined)} aria-label="Figure to judge on" data-testid="wi-judge">
            <option value="">pick a figure</option>
            {judgeable.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        {jkey && kind && targets[jkey] === undefined && <JudgeTarget metric={kind} unit={unit} />}
        {!jkey && <span className="muted">Pick a figure, give it a target, and type what each variant costs.</span>}
      </div>
      {jkey && kind && targets[jkey] !== undefined && (
        <div className="run-scroll">
          <table className="sim-table run-table wi-table" data-testid="wi-summary">
            <thead>
              <tr>
                <th>Variant</th>
                <th>Figure</th>
                <th>Result</th>
                <th>Target</th>
                <th>Cost</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {sum.map((s, i) => {
                const p = pins.find((x) => x.id === s.id)!
                return (
                  <tr key={p.id} data-testid={`wi-sum:${s.variant}`}>
                    <td>{s.variant}</td>
                    <td>{s.metric}</td>
                    <td className="run-num">{show(s.kind, s.value)}</td>
                    <td className="run-num">{show(s.kind, s.target)}</td>
                    <td>
                      <ValueField value={p.cost} parse={(t) => parseNum(t)} onCommit={(v) => useWhatIf.getState().setPinCost(p.id, v)} placeholder="0" testid={`wi-pincost:${i}`} label={`Cost of ${s.variant}`} />
                    </td>
                    <td data-testid={`wi-verdict:${i}`}>{s.verdict === 'pass' ? <span className="is-better">✓ meets the target</span> : s.verdict === 'fail' ? <span className="is-worse">✗ misses the target</span> : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function JudgeTarget({ metric, unit }: { metric: MetricValue; unit: TimeUnit }) {
  return (
    <span className="muted">
      Target:{' '}
      <ValueField
        value={undefined}
        parse={(t) => (metric.kind === 'time' ? parseTime(t, unit) : metric.kind === 'pct' ? ((p) => (p.value === undefined ? p : { value: p.value / 100 }))(parseNum(t, { percent: true })) : parseNum(t))}
        onCommit={(v) => useWhatIf.getState().setTarget(metric.key, v)}
        placeholder={metric.kind === 'time' ? UNIT_NAMES[unit] : metric.kind === 'pct' ? '%' : ''}
        testid="wi-judge-target"
        label="Target"
      />
    </span>
  )
}

function PinCells({ kind, value, delta, first }: { kind: MetricKind; value: number | undefined; delta: Delta | undefined; first: boolean }) {
  return (
    <>
      <td className="run-num">{show(kind, value)}</td>
      {!first && (
        <td className={`run-num ${cls(delta)}`}>
          {arrow(delta)} {dtxt(kind, delta)}
          {delta?.pct !== undefined && delta.delta !== 0 && <small> ({delta.pct > 0 ? '+' : ''}{Math.round(delta.pct * 1000) / 10} %)</small>}
        </td>
      )}
    </>
  )
}
