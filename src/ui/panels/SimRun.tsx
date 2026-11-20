// The Run tab of Simulate (stage 6b phase 3; design §3.4, §4). It runs hundreds of invented cases through the process
// (core/simulate, in a worker) and puts every figure next to the formula that predicts it. Level 1 checks paths, level 2
// adds times (no queues: must match the flow analysis), level 3 adds limited people (queues, how busy each lane is).
import { useMemo } from 'react'
import { Play, RotateCcw, X } from 'lucide-react'
import { UNIT_NAMES, type Analysis } from '../../core/analysis'
import type { FlowModel } from '../../core/metamodel'
import { setSimSettings } from '../../core/ops'
import { SIM_LIMITS, type Interval, type SimLevel, type SimResult } from '../../core/simulate'
import { useEditor } from '../store'
import { useRun, type RunResult } from '../simRun'
import { isKaiyo } from '../exampleLink'
import { HelpQ } from './Help'
import { TryThis } from './TryThis'
import { NumField } from './NumField'
import { count, fmt, pct, pm } from './simFormat'
import { hasRates, sig } from '../../core/simLabels'
import { useRowLink } from './rowLink'
import { elementRows, laneRows, processRows } from '../../core/simTables'
import { useWhatIf } from '../whatIf'
import { CopyTable, DurationHelper, ExportButton, PinButton, WhatIfSection } from './WhatIf'
import './simRun.css'

const LEVELS: { level: SimLevel; name: string; hint: string }[] = [
  { level: 1, name: 'Validate', hint: 'Does every case reach an end? Counts per element, no times.' },
  { level: 2, name: 'Time', hint: 'Cycle time with enough people for everyone: no queues. It should match the formula.' },
  { level: 3, name: 'Resources', hint: 'People are limited: waiting for a person, how busy each lane is, lane costs. The new number the formula cannot give.' },
]

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const perUnit = (u: string) => (u === 'days' ? 'day' : u)

export function SimRunTab({ a, model }: { a: Analysis | undefined; model: FlowModel }) {
  const run = useRun()
  const apply = useEditor((s) => s.apply)
  const cycleTarget = useWhatIf((s) => s.targets.cycle)
  const tu = model.sim?.unit ?? 'min'
  const unit = UNIT_NAMES[tu]
  const arrivals = model.sim?.arrivals
  const needArrivals = run.level === 3 && !arrivals
  const last = run.last
  const stale = !!last && last.model !== model

  /** Runs an edit of the model settings; returns why it was refused (shown on the field). */
  const commit = (edit: (m: FlowModel) => void, coalesce: string): string | void => {
    if (apply(edit, { coalesce })) return
    const message = useEditor.getState().error ?? 'Not accepted'
    useEditor.getState().showError(null)
    return message
  }
  const go = () => run.start(a?.poolId, cycleTarget !== undefined ? { target: cycleTarget } : {})
  const newSeed = () => {
    if (run.running) return
    if (apply((m) => setSimSettings(m, { seed: (m.sim?.seed ?? 1) + 1 }))) go()
  }

  return (
    <div className="sim-body sim-run" data-testid="run-tab">
      {isKaiyo(model) && <TryThis model={model} />}
      <div className="run-levels" role="radiogroup" aria-label="Simulation level">
        {LEVELS.map((l) => (
          <button key={l.level} role="radio" aria-checked={run.level === l.level} className={`btn${run.level === l.level ? ' is-open' : ''}`} onClick={() => useRun.setState({ level: l.level })} disabled={run.running} title={l.hint} data-testid={`run-level-${l.level}`}>
            {l.level} · {l.name}
          </button>
        ))}
        <button className="btn" disabled title="Working hours and shifts: later" data-testid="run-level-4">
          4 · Calendar (later)
        </button>
        <HelpQ card="simulation" />
      </div>
      <p className="muted run-hint">{LEVELS[run.level - 1].hint}</p>

      <div className="sim-settings row run-settings">
        <label title={`How many new cases arrive per ${perUnit(unit)}. 12 a day = 0.5 per hour = one every 2 hours.`}>
          New cases per {perUnit(unit)} <NumField value={arrivals} placeholder={run.level === 3 ? '?' : '1'} onCommit={(v) => commit((m) => setSimSettings(m, { arrivals: v }), 'sim:arrivals')} testid="run-arrivals" />
        </label>
        <label title="Random: the time between cases varies (Poisson arrivals). Regular: always the same, so no queue from arrivals.">
          Arrivals{' '}
          <select value={model.sim?.arrivalShape ?? 'exp'} onChange={(e) => apply((m) => setSimSettings(m, { arrivalShape: e.target.value === 'const' ? 'const' : undefined }))} data-testid="run-shape">
            <option value="exp">random (Poisson)</option>
            <option value="const">regular</option>
          </select>
        </label>
        <label title={`Cases per run, 1 to ${SIM_LIMITS.maxCases.toLocaleString('en')}`}>
          Cases <NumField value={model.sim?.cases} placeholder="200" onCommit={(v) => commit((m) => setSimSettings(m, { cases: v }), 'sim:cases')} testid="run-cases" />
        </label>
        <label title={`Runs of the same process with different dice, 1 to ${SIM_LIMITS.maxRuns}; the tiles show the average and a 95 % interval. Cases × runs is at most ${SIM_LIMITS.maxTotal.toLocaleString('en')}.`}>
          Runs <NumField value={model.sim?.runs} placeholder="5" onCommit={(v) => commit((m) => setSimSettings(m, { runs: v }), 'sim:runs')} testid="run-runs" />
        </label>
        <label title="The same model, settings and seed give the same numbers">
          Seed <NumField value={model.sim?.seed} placeholder="1" onCommit={(v) => commit((m) => setSimSettings(m, { seed: v }), 'sim:seed')} testid="run-seed" />
        </label>
      </div>

      <DurationHelper model={model} />

      <div className="row run-go">
        <button className="btn is-primary" onClick={go} disabled={run.running || needArrivals} data-testid="run-go" title={needArrivals ? `Level 3 needs the arrival rate: how many new cases per ${perUnit(unit)}?` : 'Run the simulation'}>
          <Play size={14} /> Run
        </button>
        {run.running && (
          <button className="btn" onClick={() => run.cancel()} data-testid="run-cancel" title="Stop; the partial result is thrown away">
            <X size={14} /> Cancel
          </button>
        )}
        <button className="btn" onClick={newSeed} disabled={run.running || needArrivals} title="Seed + 1, then run: the dots move" data-testid="run-newseed">
          <RotateCcw size={14} /> New seed
        </button>
        {run.running && run.progress && <Progress done={run.progress.done} total={run.progress.total} />}
        {needArrivals && !run.running && <span className="muted" data-testid="run-need-arrivals">Level 3 needs the arrival rate: how many new cases per {perUnit(unit)}?</span>}
        {!a && !run.running && !needArrivals && <span className="muted">Draw a process with a start event, then run it.</span>}
      </div>
      {run.running && run.noWorker && (
        <p className="run-banner is-info" data-testid="run-noworker">
          Running without a worker: the page may pause.
        </p>
      )}
      {run.error && (
        <p className="run-banner is-error" role="alert" data-testid="run-error">
          {run.error}
        </p>
      )}
      {run.cancelled && !run.running && !run.error && (
        <p className="run-banner is-info" data-testid="run-cancelled">
          Cancelled; nothing kept.
        </p>
      )}

      {last && <Results run={last} stale={stale} unit={unit} onRun={go} />}
      <WhatIfSection a={a} model={model} needArrivals={needArrivals} />
    </div>
  )
}

function Progress({ done, total }: { done: number; total: number }) {
  const known = total > 0
  return (
    <span className="run-progress" data-testid="run-progress">
      <progress value={known ? done : undefined} max={known ? total : undefined} aria-label="Simulation progress" />
      <span className="muted">{known ? `${count(done)} of ${count(total)} cases` : 'Starting…'}</span>
    </span>
  )
}

// ---------------------------------------------------------------- results

function Results({ run, stale, unit, onRun }: { run: RunResult; stale: boolean; unit: string; onRun: () => void }) {
  const { result: r, formula: f } = run
  const rated = hasRates(useEditor((s) => s.model))
  const badgesOn = useRun((s) => s.badgesOn)
  const timed = r.level >= 2
  return (
    <div className={`run-results${stale ? ' is-stale' : ''}${r.unstable ? ' is-unstable' : ''}`} data-testid="run-results">
      <div className="run-head row">
        <strong>
          {r.name || 'Process'} · level {r.level} · {r.runs.length} × {count(r.cases)} cases · seed {r.seed}
        </strong>
        <label className="check run-badges" title="A small label under every activity: times it ran, average time, average wait for a person">
          <input type="checkbox" checked={badgesOn} onChange={(e) => useRun.setState({ badgesOn: e.target.checked })} data-testid="run-badges" />
          Show on diagram
        </label>
        <PinButton run={run} />
        <ExportButton run={run} />
      </div>
      {stale && (
        <p className="run-banner is-warn" role="status" data-testid="run-stale">
          The model changed since this run: these numbers are from the earlier version.{' '}
          <button className="link" onClick={onRun}>
            Run again
          </button>
        </p>
      )}
      {r.unstable && (
        <p className="run-banner is-error" role="alert" data-testid="run-unstable">
          Someone is busy 100 % of the time or more: the queue grows with every case and never settles. The waiting times below depend on how many cases you run, so treat them as unreliable.
        </p>
      )}
      {r.stopped && (
        <p className="run-banner is-warn" role="status" data-testid="run-stopped">
          {r.stopped === 'events' ? `Stopped early: more than ${SIM_LIMITS.maxEvents.toLocaleString('en')} events in one run. Try fewer cases.` : 'Stopped at the time limit: some cases were still open.'}
        </p>
      )}
      {r.stuck > 0 && (
        <p className="run-banner is-warn" role="status" data-testid="run-stuck">
          {count(r.stuck)} of {count(r.started)} cases never reached an end
          {r.stuckAt.length > 0 && <>: stuck at {r.stuckAt.map((s) => `${s.name} (${count(s.cases)})`).join(', ')}</>}.
        </p>
      )}
      <CaseLine r={r} />
      {timed && <Tiles r={r} f={f} unit={unit} rated={rated} />}
      {timed && <Strip r={r} f={f} unit={unit} />}
      {timed && <ProcessTable r={r} f={f} unit={unit} />}
      <ElementTable r={r} f={f} unit={unit} rated={rated} />
      {timed && r.lanes.length > 0 && <LaneTable r={r} f={f} unit={unit} rated={rated} />}
      {timed && <LittleRow r={r} f={f} unit={unit} />}
      {r.unreached.length > 0 && (
        <p className="muted run-unreached" data-testid="run-unreached">
          No case reached: {r.unreached.slice(0, 8).map((id) => r.elements.find((e) => e.id === id)?.name || id).join(', ')}
          {r.unreached.length > 8 && ` and ${r.unreached.length - 8} more`}.
        </p>
      )}
      {r.notes.length > 0 && (
        <ul className="sim-notes" data-testid="run-notes">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CaseLine({ r }: { r: SimResult }) {
  return (
    <p className="run-cases" data-testid="run-cases-line">
      <strong>{count(r.started)}</strong> cases started · <strong>{count(r.completed)}</strong> completed
      {r.stuck > 0 && <> · <strong>{count(r.stuck)}</strong> stuck</>}
      {r.open > 0 && <> · <strong>{count(r.open)}</strong> still open</>}
    </p>
  )
}

function Tiles({ r, f, unit, rated }: { r: SimResult; f?: Analysis; unit: string; rated: boolean }) {
  const k = r.kpis
  const waitIv = (): Interval | undefined => {
    if (!k.typedWait || !k.resourceWait) return undefined
    const sums = r.runs.map((x) => x.typedWait + x.resourceWait)
    const m = mean(sums)
    return { mean: m, min: Math.min(...sums), max: Math.max(...sums) }
  }
  return (
    <div className="sim-kpis run-kpis" data-testid="run-kpis">
      <Tile label="Cycle time" iv={k.cycleTime} unit={unit} formula={f?.cycleTime} testid="run-kpi-cycle" title="Average time from start to end of a case: the mean over the runs with its 95 % interval" />
      {r.level === 3 && <Tile label="Waiting for a person" iv={k.resourceWait} unit={unit} testid="run-kpi-waitpeople" title="Time spent in queues for a person (the longest chain of each case): the new number level 3 adds" />}
      <Tile label="Waiting in total" iv={waitIv()} unit={unit} formula={f?.waitingTime} testid="run-kpi-wait" title="Typed waiting plus waiting for a person" />
      <Tile label="Efficiency" iv={k.efficiency} percent formula={f?.efficiency} testid="run-kpi-eff" title="Processing ÷ cycle time" />
      <Tile label="Cost per case" iv={k.cost} formula={f?.cost} testid="run-kpi-cost" title={rated ? 'Task costs and lane costs' : 'No task cost and no lane rate is typed: there is no cost to show (not 0)'} blank={rated ? undefined : 'no rates'} />
    </div>
  )
}

function Tile({ label, iv, unit, percent, formula, testid, title, blank }: { label: string; iv?: Interval; unit?: string; percent?: boolean; formula?: number; testid: string; title: string; blank?: string }) {
  if (!iv) return null
  const show = (x: number | undefined) => (percent ? pct(x) : fmt(x))
  return (
    <div className="sim-kpi run-kpi" title={title} data-testid={testid}>
      <span className="muted">{label}</span>
      <strong>
        {blank ? <span className="muted sim-norates">{blank}</span> : show(iv.mean)}
        {!blank && iv.half !== undefined && <small className="run-half"> ± {percent ? pct(iv.half) : fmt(iv.half)}</small>}
        {!blank && unit && <small> {unit}</small>}
      </strong>
      {!blank && formula !== undefined && <small className="muted">Formula {show(formula)}</small>}
    </div>
  )
}

/** One dot per run (its mean cycle time) and the formula's value as a tick: how far one run can be from the long-run value. */
function Strip({ r, f, unit }: { r: SimResult; f?: Analysis; unit: string }) {
  const pts = r.runs.filter((x) => x.completed > 0).map((x) => ({ v: x.cycleTime.mean, run: x.run, seed: x.seed }))
  if (!pts.length) return null
  const vals = [...pts.map((p) => p.v), ...(f?.cycleTime !== undefined ? [f.cycleTime] : [])]
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (hi - lo < 1e-9) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.08
  lo -= pad
  hi += pad
  const W = 260
  const x = (v: number) => 6 + ((v - lo) / (hi - lo)) * (W - 12)
  const m = mean(pts.map((p) => p.v))
  return (
    <div className="run-strip" data-testid="run-strip">
      <span className="muted">Each run's average cycle time ({unit}):</span>
      <svg width={W} height={34} viewBox={`0 0 ${W} 34`} role="img" aria-label={`Average cycle time of each of ${pts.length} runs, from ${fmt(Math.min(...pts.map((p) => p.v)))} to ${fmt(Math.max(...pts.map((p) => p.v)))} ${unit}`}>
        <line x1={6} x2={W - 6} y1={17} y2={17} className="strip-axis" />
        <line x1={x(m)} x2={x(m)} y1={6} y2={28} className="strip-mean">
          <title>{`Mean of the runs: ${fmt(m)} ${unit}`}</title>
        </line>
        {f?.cycleTime !== undefined && (
          <path d={`M${x(f.cycleTime)} 31 l-4 -6 h8 z`} className="strip-formula">
            <title>{`Formula: ${fmt(f.cycleTime)} ${unit}`}</title>
          </path>
        )}
        {pts.map((p) => (
          <circle key={p.run} cx={x(p.v)} cy={17} r={4.5} className="strip-dot" data-testid={`run-dot-${p.run}`}>
            <title>{`Run ${p.run + 1} (seed ${p.seed}): ${fmt(p.v)} ${unit}`}</title>
          </circle>
        ))}
      </svg>
      {f?.cycleTime !== undefined && <span className="muted run-legend">▲ formula</span>}
    </div>
  )
}

function Row({ label, run, range, formula, title, testid }: { label: string; run: string; range?: string; formula?: string; title?: string; testid?: string }) {
  return (
    <tr data-testid={testid}>
      <td title={title}>{label}</td>
      <td className="run-num">{run}</td>
      <td className="run-num muted">{range ?? ''}</td>
      <td className="run-num">{formula ?? <span className="muted">—</span>}</td>
    </tr>
  )
}

function ProcessTable({ r, f, unit }: { r: SimResult; f?: Analysis; unit: string }) {
  const k = r.kpis
  const rng = (iv: Interval | undefined, show: (x: number) => string = fmt) => (iv && r.runs.length > 1 ? `${show(iv.min)} – ${show(iv.max)}` : '')
  const t = (iv: Interval | undefined) => (iv ? pm(iv.mean, iv.half) : '—')
  const p90 = mean(r.runs.map((x) => x.cycleTime.p90))
  const fastest = mean(r.runs.map((x) => x.cycleTime.min))
  const slowest = mean(r.runs.map((x) => x.cycleTime.max))
  const per = perUnit(unit)
  return (
    <div className="run-scroll">
      <CopyTable rows={() => processRows(r, f)} testid="run-copy-process" />
      <table className="sim-table run-table" data-testid="run-table-process">
        <thead>
          <tr>
            <th>Process</th>
            <th title="Mean over the runs ± the 95 % interval">Run</th>
            <th title="Lowest and highest run">Between runs</th>
            <th title="Flow analysis: exact averages, no randomness, no queues">Formula</th>
          </tr>
        </thead>
        <tbody>
          <Row label={`Cycle time (${unit})`} run={t(k.cycleTime)} range={rng(k.cycleTime)} formula={fmt(f?.cycleTime)} testid="run-row-cycle" />
          <Row label={`Processing (${unit})`} run={t(k.processing)} range={rng(k.processing)} formula={fmt(f?.processingTime)} title="Time spent working along the longest chain of each case" />
          <Row label={`Typed waiting (${unit})`} run={t(k.typedWait)} range={rng(k.typedWait)} formula={fmt(f?.waitingTime)} title="Waiting you typed in (hand-over, tray, truck)" />
          {r.level === 3 && <Row label={`Waiting for a person (${unit})`} run={t(k.resourceWait)} range={rng(k.resourceWait)} title="Queues for a person: only the run finds this; see the lanes for the queueing estimate" testid="run-row-resource" />}
          <Row label="Efficiency" run={k.efficiency ? `${pct(k.efficiency.mean)}${k.efficiency.half !== undefined ? ` ± ${pct(k.efficiency.half)}` : ''}` : '—'} formula={pct(f?.efficiency)} title="Processing ÷ cycle time" />
          <Row label="Cost per case" run={t(k.cost)} range={rng(k.cost)} formula={fmt(f?.cost)} />
          <Row label={`Cycle time of the slowest 10 % starts at (${unit})`} run={fmt(p90)} title="90th percentile: nine cases in ten finish sooner" />
          <Row label={`Fastest · slowest case (${unit})`} run={`${fmt(fastest)} · ${fmt(slowest)}`} />
          <Row label={`Spread of the cycle time, σ (${unit})`} run={t(k.cycleTimeSd)} />
          <Row label={`Completed per ${per}`} run={t(k.throughput)} title="Cases completed ÷ the time from the first arrival to the last case done" formula={r.arrivals ? fmt(r.arrivals) : undefined} />
          <Row label="Cases open at once, on average" run={t(k.wip)} testid="run-row-wip" />
        </tbody>
      </table>
    </div>
  )
}

function ElementTable({ r, f, unit, rated }: { r: SimResult; f?: Analysis; unit: string; rated: boolean }) {
  const row = useRowLink()
  const rows = useMemo(
    () =>
      r.elements.filter((e) => {
        if (e.type === 'dataObject' || e.type === 'dataStore' || e.type === 'annotation') return false
        if (r.level === 1) return true
        return e.time.n > 0 || e.typedWait.n > 0 || e.resourceWait.n > 0 || e.fixedCost > 0 || e.unitCost > 0
      }),
    [r],
  )
  if (!rows.length) return null
  const level1 = r.level === 1
  const people = r.level === 3
  const longest = people ? rows.reduce((m, e) => (e.resourceWait.mean > m ? e.resourceWait.mean : m), 0) : 0
  const cases = Math.max(1, r.started)
  const select = (id: string) => useEditor.getState().select([id])
  return (
    <div className="run-scroll">
      <CopyTable rows={() => elementRows(r)} testid="run-copy-elements" />
      <table className="sim-table run-table" data-testid="run-table-elements">
        <thead>
          <tr>
            <th>{level1 ? 'Element' : 'Activity'}</th>
            {level1 && <th>Type</th>}
            <th title="Times it was entered, over all runs">Started</th>
            <th title="Times it was left">Completed</th>
            <th title="Starts per case in the run. 0.3 = in 30 % of cases, 1.25 = once plus a 25 % rework">Per case (run)</th>
            <th title="The same, from the flow analysis">Per case (formula)</th>
            {!level1 && <th title={`Average processing time of one run, in ${unit}`}>Time</th>}
            {!level1 && <th title={`Average typed waiting before it starts, in ${unit}`}>Typed wait</th>}
            {people && <th title={`Average wait for a person per run, in ${unit}`}>Wait for a person</th>}
            {people && <th title={`Longest wait for a person, in ${unit}`}>Longest wait</th>}
            {!level1 && <th title={rated ? 'Task cost and lane costs, per case' : 'No task cost and no lane rate is typed'}>Cost per case{!rated && <span className="muted"> · no rates</span>}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const step = f?.steps.find((s) => s.id === e.id)
            return (
              <tr key={e.id} {...row(e.id, people && longest > 0 && e.resourceWait.mean === longest ? 'is-worst' : undefined)} data-testid={`run-el:${e.name}`}>
                <td className="sim-name">
                  <button className="link" onClick={() => select(e.id)} title={e.name || e.type}>
                    {e.name || e.type}
                  </button>
                </td>
                {level1 && <td className="muted">{e.type}</td>}
                <td className="run-num">{count(e.started)}</td>
                <td className="run-num">{count(e.completed)}</td>
                <td className="run-num">{fmt(e.started / cases)}</td>
                <td className="run-num">{step ? fmt(step.runs) : <span className="muted">—</span>}</td>
                {!level1 && <td className="run-num">{e.time.n ? fmt(e.time.mean) : ''}</td>}
                {!level1 && <td className="run-num">{e.typedWait.n ? fmt(e.typedWait.mean) : ''}</td>}
                {people && <td className="run-num">{e.resourceWait.n ? fmt(e.resourceWait.mean) : ''}</td>}
                {people && <td className="run-num">{e.resourceWait.n ? fmt(e.resourceWait.max) : ''}</td>}
                {!level1 && <td className="run-num">{e.fixedCost + e.unitCost > 0 ? fmt((e.fixedCost + e.unitCost) / cases) : ''}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function LaneTable({ r, f, unit, rated }: { r: SimResult; f?: Analysis; unit: string; rated: boolean }) {
  const people = r.level === 3
  const cases = Math.max(1, r.started)
  return (
    <div className="run-scroll">
      <CopyTable rows={() => laneRows(r, f)} testid="run-copy-lanes" />
      <table className="sim-table run-table" data-testid="run-table-lanes">
        <thead>
          <tr>
            <th>Lane (resource)</th>
            <th title="People counted in the run">People</th>
            <th title="Busy time ÷ (people × the time cases were arriving): the run, mean ± 95 % interval">Busy (run)</th>
            <th title="Arrival rate × work per case ÷ people, from the flow analysis">Busy (formula)</th>
            {people && <th title="Average number of cases waiting for this lane, and the longest queue seen">Queue avg · longest</th>}
            {people && <th title={`Average wait for a person per request, in ${unit}`}>Wait (run)</th>}
            {people && <th title={`Estimate from queueing theory (M/M/c, Erlang C): random arrivals and times, one queue. In ${unit}`}>Wait (M/M/c est.)</th>}
            <th title="Lane costs per case">Cost per case{!rated && <span className="muted"> · no rates</span>}</th>
          </tr>
        </thead>
        <tbody>
          {r.lanes.map((l) => {
            const res = f?.resources.find((x) => x.laneId === l.laneId)
            const q = f?.queues.find((x) => x.laneId === l.laneId)
            const over = l.utilisation.mean >= 1
            return (
              <tr key={l.laneId} className={over ? 'is-over' : undefined} data-testid={`run-lane:${l.name}`}>
                <td>{l.name}</td>
                <td className="run-num">{l.capacity}</td>
                <td className="run-num" data-testid={`run-busy:${l.name}`}>
                  {pct(l.utilisation.mean)}
                  {l.utilisation.half !== undefined && <span className="muted"> ± {pct(l.utilisation.half)}</span>}
                </td>
                <td className="run-num">{res?.utilisation === undefined ? <span className="muted">—</span> : pct(res.utilisation)}</td>
                {people && (
                  <td className="run-num">
                    {fmt(l.avgQueue)} · {fmt(l.maxQueue, 0)}
                  </td>
                )}
                {people && <td className="run-num">{over ? <span title="The queue never settles">grows</span> : fmt(l.meanWait)}</td>}
                {people && <td className="run-num">{!q ? <span className="muted">—</span> : q.overloaded ? 'never settles' : fmt(q.wait)}</td>}
                <td className="run-num">{l.totalCost > 0 ? fmt(l.totalCost / cases) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Little's law on the run: cases open at once = throughput × time in the process (an identity when every case completes). */
function LittleRow({ r, f, unit }: { r: SimResult; f?: Analysis; unit: string }) {
  const k = r.kpis
  if (!k.wip || !k.throughput || !k.cycleTime) return null
  const per = perUnit(unit)
  const product = mean(r.runs.map((x) => x.throughput * x.cycleTime.mean))
  const formulaWip = f?.cycleTime !== undefined && r.arrivals ? r.arrivals * f.cycleTime : undefined
  return (
    <p className="sim-little run-little" data-testid="run-little">
      <strong>Little's law:</strong> cases open at once = completed per {per} × cycle time. Run: {fmt(k.wip.mean)} open on average; {sig(k.throughput.mean, 2)} per {per} × {fmt(k.cycleTime.mean)} {unit} = {fmt(product)}
      {r.stuck + r.open === 0 ? ' (equal: it holds for every run in which all cases complete).' : ' (not equal: some cases did not complete).'}
      {formulaWip !== undefined && (
        <>
          {' '}
          Formula: {sig(r.arrivals)} new per {per} × {fmt(f!.cycleTime)} {unit} = {fmt(formulaWip)}.
        </>
      )}
    </p>
  )
}
