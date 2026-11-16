// The Simulate panel under the canvas (stage 6). Play: one case runs through the process, a token at a
// time; decisions ask which way. Times and costs: the figures of every activity, decision and lane are
// typed in the tables and the flow analysis (core/analysis) gives cycle time, waiting, efficiency, cost and
// how busy each lane is. "Keep as AS-IS" remembers the figures, so a redesign (TO-BE) shows what it changes.
import { useMemo, useState } from 'react'
import { create } from 'zustand'
import { FastForward, Pin, PinOff, Play, RotateCcw, StepForward, X } from 'lucide-react'
import { analyseModel, convertTime, littlesLaw, UNIT_NAMES, type Analysis } from '../../core/analysis'
import type { FlowModel, TimeUnit } from '../../core/metamodel'
import { isDecision } from '../../core/analysis'
import { parseNum } from '../../core/number'
import { nodeOf, setCapacity, setFires, setLaneCost, setProbability, setSim, setSimSettings } from '../../core/ops'
import { pending, playOn, startPlay, stepPlay, type PlayState } from '../../core/play'
import { useEditor } from '../store'
import { HelpQ } from './Help'
import { NumField } from './NumField'
import { ShapeCell } from './ShapeCell'

export interface Kpis {
  name: string
  cycleTime?: number
  processingTime?: number
  waitingTime?: number
  efficiency?: number
  cost?: number
  unit: string
}

const BASELINE_KEY = 'strataflow.sim.baseline'
const loadBaseline = (): Kpis | null => {
  try {
    return JSON.parse(localStorage.getItem(BASELINE_KEY) ?? 'null')
  } catch {
    return null
  }
}

interface SimState {
  open: boolean
  tab: 'play' | 'figures'
  pool: string | undefined
  play: PlayState | null
  baseline: Kpis | null
  setOpen: (open: boolean) => void
}

export const useSim = create<SimState>()((set) => ({
  open: false,
  tab: 'figures',
  pool: undefined,
  play: null,
  baseline: loadBaseline(),
  setOpen: (open) => set({ open, play: null }),
}))

// Another document on the canvas (a tab switch, Open): a token play of the old one stops.
useEditor.subscribe((s, prev) => {
  if (s.doc !== prev.doc && useSim.getState().play) useSim.setState({ play: null })
})

let cache: { model: FlowModel | null; out: Analysis[] } = { model: null, out: [] }
/** The analyses of the current model, computed once per model version. */
export function useAnalyses(): Analysis[] {
  const model = useEditor((s) => s.model)
  if (cache.model !== model) cache = { model, out: analyseModel(model) }
  return cache.out
}

const fmt = (x: number | undefined, digits = 2) => (x === undefined ? '—' : String(Math.round(x * 10 ** digits) / 10 ** digits))
const pct = (x: number | undefined) => (x === undefined ? '—' : `${x < 0.1 ? Math.round(x * 1000) / 10 : Math.round(x * 100)} %`)
/** For the free-text fields of Little's law: whatever does not parse counts as empty. */
const num = (v: string) => parseNum(v).value

export function SimulatePanel() {
  const model = useEditor((s) => s.model)
  const analyses = useAnalyses()
  const { tab, pool } = useSim()
  const a = analyses.find((x) => x.poolId === pool) ?? analyses[0]
  const unit = UNIT_NAMES[model.sim?.unit ?? 'min']
  return (
    <section className="check-panel sim-panel" aria-label="Simulate" data-testid="sim-panel">
      <header>
        <strong>Simulate</strong>
        <div className="sim-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'figures'} className={`btn${tab === 'figures' ? ' is-open' : ''}`} onClick={() => useSim.setState({ tab: 'figures' })} data-testid="sim-tab-figures">
            Times and costs
          </button>
          <button role="tab" aria-selected={tab === 'play'} className={`btn${tab === 'play' ? ' is-open' : ''}`} onClick={() => useSim.setState({ tab: 'play' })} data-testid="sim-tab-play">
            Play a case
          </button>
        </div>
        {analyses.length > 1 && (
          <select value={a?.poolId ?? ''} onChange={(e) => useSim.setState({ pool: e.target.value || undefined, play: null })} title="The process to simulate" data-testid="sim-pool">
            {analyses.map((x) => (
              <option key={x.poolId ?? ''} value={x.poolId ?? ''}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        <span className="muted" />
        <HelpQ card="simulation" />
        <button className="btn icon" onClick={() => useSim.getState().setOpen(false)} aria-label="Close Simulate" title="Close">
          <X size={14} />
        </button>
      </header>
      {!a ? <p className="check-clean">Draw a process with a start event first.</p> : tab === 'play' ? <PlayTab a={a} unit={unit} /> : <FiguresTab a={a} model={model} unit={unit} />}
    </section>
  )
}

function PlayTab({ a, unit }: { a: Analysis; unit: string }) {
  const model = useEditor((s) => s.model)
  const play = useSim((s) => s.play)
  const set = (p: PlayState) => useSim.setState({ play: p })
  const p = play && pending(model, play)
  const name = (id: string) => nodeOf(model, id)?.name || nodeOf(model, id)?.type || id
  const shares = useMemo(() => {
    if (!play?.choice) return []
    return play.choice.flows.map((id) => model.flows.find((f) => f.id === id)!)
  }, [play, model])
  return (
    <div className="sim-body">
      <div className="row sim-controls">
        <button className="btn" onClick={() => set(startPlay(model, a.poolId))} data-testid="play-start" title="Put a token on the start event">
          {play ? <RotateCcw size={14} /> : <Play size={14} />} {play ? 'Again' : 'Start a case'}
        </button>
        <button className="btn" disabled={!play || play.done || !!play.choice} onClick={() => play && set(stepPlay(model, play))} data-testid="play-step" title="Run the next step">
          <StepForward size={14} /> Step
        </button>
        <button className="btn" disabled={!play || play.done || !!play.choice} onClick={() => play && set(playOn(model, play))} data-testid="play-on" title="Run until a decision needs you, or the case ends">
          <FastForward size={14} /> To the next decision
        </button>
        <button
          className="btn"
          disabled={!play || play.done}
          onClick={() => play && set(playOn(model, { ...play, choice: undefined }, { decide: true }))}
          data-testid="play-auto"
          title="Let the probabilities decide, up to the end of the case"
        >
          <FastForward size={14} /> By probabilities to the end
        </button>
        {play && (
          <span className="muted" data-testid="play-time">
            Step {play.steps} · time so far {fmt(play.time)} {unit}
          </span>
        )}
      </div>
      {play?.choice && p && (
        <div className="sim-choice" data-testid="play-choice">
          <strong>{name(play.choice.node)}</strong> Which way?
          {shares.map((f) => (
            <button key={f.id} className="btn" onClick={() => set(playOn(model, stepPlay(model, play, f.id)))} data-testid={`branch:${f.name || name(f.target)}`}>
              {f.name || name(f.target)}
              {f.probability !== undefined && <span className="muted"> {pct(f.probability)}</span>}
            </button>
          ))}
        </div>
      )}
      {!play && <p className="muted sim-hint">A case is one run of the process: one order, one patient, one loan. The token shows where it is; at a decision you choose the way, at a parallel split the token splits, and a parallel join waits for all its branches.</p>}
      {play && (
        <ol className="sim-log" data-testid="play-log">
          {play.log.slice(-12).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

function FiguresTab({ a, model, unit }: { a: Analysis; model: FlowModel; unit: string }) {
  const apply = useEditor((s) => s.apply)
  const baseline = useSim((s) => s.baseline)
  const [showAll, setShowAll] = useState(false)
  const k: Kpis = { name: model.name || a.name, cycleTime: a.cycleTime, processingTime: a.processingTime, waitingTime: a.waitingTime, efficiency: a.efficiency, cost: a.cost, unit }
  const keep = () => {
    useSim.setState({ baseline: k })
    try {
      localStorage.setItem(BASELINE_KEY, JSON.stringify(k))
    } catch {
      /* private mode: kept for this visit only */
    }
  }
  const drop = () => {
    useSim.setState({ baseline: null })
    try {
      localStorage.removeItem(BASELINE_KEY)
    } catch {
      /* nothing to drop */
    }
  }
  const decisions = model.nodes.filter((n) => {
    const outs = model.flows.filter((f) => f.kind === 'sequence' && f.source === n.id)
    return isDecision(n, outs.length) && (a.poolId ? n.participantId === a.poolId : !n.participantId)
  })
  const steps = showAll ? a.steps : a.steps.filter((s) => s.runs > 0 || s.missing)
  /** Runs an edit; returns why it was refused (shown on the field) and keeps the global banner quiet. */
  const commit = (edit: (m: FlowModel) => void, coalesce: string): string | void => {
    if (apply(edit, { coalesce })) return
    const message = useEditor.getState().error ?? 'Not accepted'
    useEditor.getState().showError(null)
    return message
  }
  const edit = (id: string, key: 'duration' | 'wait' | 'cost', v: number | undefined) => commit((m) => setSim(m, id, { [key]: v }), `sim:${id}:${key}`)
  const inPool = (n: { participantId?: string }) => (a.poolId ? n.participantId === a.poolId : !n.participantId)
  const boundaries = model.nodes.filter(
    (n) => n.type === 'event' && n.position === 'boundary' && inPool(n) && model.flows.some((f) => f.kind === 'sequence' && f.source === n.id),
  )
  return (
    <div className="sim-body sim-figures">
      <div className="sim-kpis" data-testid="sim-kpis">
        <Kpi label="Cycle time" value={a.cycleTime} base={baseline?.cycleTime} unit={unit} lowerIsBetter testid="kpi-cycle" title="Average time from start to end of a case" />
        <Kpi label="Processing" value={a.processingTime} base={baseline?.processingTime} unit={unit} lowerIsBetter testid="kpi-processing" title="Theoretical cycle time: only the work, no waiting" />
        <Kpi label="Waiting" value={a.waitingTime} base={baseline?.waitingTime} unit={unit} lowerIsBetter testid="kpi-waiting" title="Cycle time minus processing" />
        <Kpi label="Efficiency" value={a.efficiency} base={baseline?.efficiency} percent testid="kpi-efficiency" title="Cycle time efficiency = processing / cycle time" />
        <Kpi label="Cost per case" value={a.cost} base={baseline?.cost} lowerIsBetter testid="kpi-cost" title="Average cost of one case" />
        <div className="sim-baseline">
          {baseline ? (
            <>
              <span className="muted">AS-IS: {baseline.name}</span>
              <button className="btn" onClick={drop} title="Forget the AS-IS figures" data-testid="sim-unpin">
                <PinOff size={14} /> Forget
              </button>
            </>
          ) : (
            <button className="btn" onClick={keep} title="Remember these figures as the AS-IS process; then change the model (TO-BE) and compare" data-testid="sim-pin">
              <Pin size={14} /> Keep as AS-IS
            </button>
          )}
        </div>
      </div>

      <div className="sim-settings row">
        <label>
          Time unit{' '}
          <select value={model.sim?.unit ?? 'min'} onChange={(e) => apply((m) => setSimSettings(m, { unit: e.target.value === 'min' ? undefined : (e.target.value as TimeUnit) }))} data-testid="sim-unit">
            <option value="min">minutes</option>
            <option value="h">hours</option>
            <option value="d">days</option>
          </select>
        </label>
        <label title="How many new cases arrive per time unit (for how busy each lane is)">
          New cases per {unit === 'days' ? 'day' : unit}{' '}
          <NumField value={model.sim?.arrivals} placeholder="—" onCommit={(v) => commit((m) => setSimSettings(m, { arrivals: v }), 'sim:arrivals')} testid="sim-arrivals" />
        </label>
      </div>

      <Little a={a} model={model} unit={unit} />

      <table className="sim-table" data-testid="sim-steps">
        <thead>
          <tr>
            <th>Activity</th>
            <th title="Expected runs per case: 0.3 = in 30 % of cases, 1.25 = once plus a 25 % rework">Runs</th>
            <th title={`Processing time of one run, in ${unit}: the average`}>Duration</th>
            <th title="How the duration varies around its average (the flow analysis uses the average)">Spread</th>
            <th title={`Waiting time before it starts, in ${unit}: the average`}>Waiting</th>
            <th title="How the waiting varies around its average">Spread</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => {
            const node = nodeOf(model, s.id)
            return (
              <tr key={s.id} className={s.missing ? 'is-missing' : undefined}>
                <td>
                  <button className="link" onClick={() => useEditor.getState().select([s.id])}>
                    {s.name}
                  </button>
                </td>
                <td>{fmt(s.runs)}</td>
                <td>{s.event ? '' : <NumField value={node?.sim?.duration} placeholder="?" onCommit={(v) => edit(s.id, 'duration', v)} testid={`dur:${s.name}`} />}</td>
                <td>{s.event || !node ? '' : <ShapeCell node={node} which="duration" unit={unit} />}</td>
                <td>
                  <NumField value={node?.sim?.wait} placeholder="0" onCommit={(v) => edit(s.id, 'wait', v)} testid={`wait:${s.name}`} />
                </td>
                <td>{node ? <ShapeCell node={node} which="wait" unit={unit} /> : ''}</td>
                <td>{s.event ? '' : <NumField value={node?.sim?.cost} placeholder="0" onCommit={(v) => edit(s.id, 'cost', v)} testid={`cost:${s.name}`} />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {steps.length < a.steps.length && (
        <button className="link" onClick={() => setShowAll(true)}>
          Show the {a.steps.length - steps.length} steps no case reaches
        </button>
      )}

      {decisions.length > 0 && (
        <table className="sim-table" data-testid="sim-decisions">
          <thead>
            <tr>
              <th>Decision · branch</th>
              <th title="Share of cases taking the branch; empty ones share what is left">%</th>
            </tr>
          </thead>
          <tbody>
            {decisions.flatMap((g) =>
              model.flows
                .filter((f) => f.kind === 'sequence' && f.source === g.id)
                .map((f) => (
                  <tr key={f.id}>
                    <td>
                      {g.name || 'Decision'} · {f.name || nodeOf(model, f.target)?.name || f.target}
                    </td>
                    <td>
                      <NumField
                        percent
                        value={f.probability === undefined ? undefined : Math.round(f.probability * 1000) / 10}
                        placeholder="auto"
                        onCommit={(v) => commit((m) => setProbability(m, f.id, v === undefined ? undefined : v / 100), `p:${f.id}`)}
                        testid={`p:${g.name}:${f.name || nodeOf(model, f.target)?.name}`}
                      />
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      )}

      {boundaries.length > 0 && (
        <table className="sim-table" data-testid="sim-boundaries">
          <thead>
            <tr>
              <th>Boundary event · activity</th>
              <th title="Share of the activity's runs in which the event happens; blank = the path after it is not counted">Happens in %</th>
            </tr>
          </thead>
          <tbody>
            {boundaries.map((b) => (
              <tr key={b.id}>
                <td>
                  <button className="link" onClick={() => useEditor.getState().select([b.id])}>
                    {b.name || 'Boundary event'}
                  </button>
                  {' · '}
                  {nodeOf(model, b.type === 'event' ? (b.attachedTo ?? '') : '')?.name || 'activity'}
                  <span className="muted"> ({b.type === 'event' && b.interrupting === false ? 'activity goes on' : 'activity stops'})</span>
                </td>
                <td>
                  <NumField
                    percent
                    value={b.sim?.fires === undefined ? undefined : Math.round(b.sim.fires * 1000) / 10}
                    placeholder="0"
                    onCommit={(v) => commit((m) => setFires(m, b.id, v === undefined ? undefined : v / 100), `fires:${b.id}`)}
                    testid={`fires:${b.name}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {a.resources.length > 0 && (
        <table className="sim-table" data-testid="sim-lanes">
          <thead>
            <tr>
              <th>Lane (resource)</th>
              <th title="People (or machines) in this role working at once">Capacity</th>
              <th title={`Processing time per case in this lane, in ${unit}`}>Work per case</th>
              <th title="Arrival rate × work per case / capacity">Busy</th>
              <th title="Added to the cost of every run of an activity in this lane">Cost per use</th>
              <th title="Added for every hour of processing in this lane, whatever the model's time unit">Cost per hour</th>
              <th title={`Estimated wait for a person per activity run, in ${unit}: queueing theory (M/M/c, Erlang C) for random arrivals and random times with one queue. A real run or a quiet day will differ.`}>Wait for a person (est.)</th>
            </tr>
          </thead>
          <tbody>
            {a.resources.map((r) => (
              <tr key={r.laneId} className={r.utilisation !== undefined && r.utilisation > 1 ? 'is-missing' : undefined}>
                <td>{r.name}</td>
                <td>
                  <NumField value={model.lanes.find((l) => l.id === r.laneId)?.capacity} placeholder="1" onCommit={(v) => commit((m) => setCapacity(m, r.laneId, v), `cap:${r.laneId}`)} testid={`cap:${r.name}`} />
                </td>
                <td>{fmt(r.work)}</td>
                <td data-testid={`busy:${r.name}`}>{r.utilisation === undefined ? <span className="muted">set new cases</span> : pct(r.utilisation)}</td>
                <td>
                  <NumField value={r.useCost} placeholder="0" onCommit={(v) => commit((m) => setLaneCost(m, r.laneId, { useCost: v }), `use:${r.laneId}`)} testid={`usecost:${r.name}`} />
                </td>
                <td>
                  <NumField value={r.hourlyCost} placeholder="0" onCommit={(v) => commit((m) => setLaneCost(m, r.laneId, { hourlyCost: v }), `hour:${r.laneId}`)} testid={`hourcost:${r.name}`} />
                </td>
                <td data-testid={`est:${r.name}`}>
                  <QueueEstimate q={a.queues.find((x) => x.laneId === r.laneId)} unit={unit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {a.notes.length > 0 && (
        <ul className="sim-notes" data-testid="sim-notes">
          {a.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The M/M/c wait of a lane: a number, "never settles" when the lane is overloaded, or a hint when the arrival rate is missing. */
function QueueEstimate({ q, unit }: { q: Analysis['queues'][number] | undefined; unit: string }) {
  if (!q) return <span className="muted">set new cases</span>
  if (q.overloaded)
    return (
      <span className="sim-est is-worse" title="The people cannot keep up with the arrivals: the queue grows with every case and never settles, so there is no average wait">
        never settles
      </span>
    )
  const chance = q.pWait === undefined ? '' : `A case finds everyone busy ${pct(q.pWait)} of the time. `
  return (
    <span className="sim-est" title={`${chance}M/M/${q.servers}: ${fmt(q.visits)} run(s) per case of ${fmt(q.meanService)} ${unit} on average, random arrivals and times, one queue.`}>
      {fmt(q.wait)} {unit}
    </span>
  )
}

function Kpi({ label, value, base, unit, percent, lowerIsBetter, testid, title }: { label: string; value?: number; base?: number; unit?: string; percent?: boolean; lowerIsBetter?: boolean; testid: string; title: string }) {
  const show = (x: number | undefined) => (percent ? pct(x) : fmt(x))
  const delta = value !== undefined && base !== undefined && base !== 0 ? (value - base) / Math.abs(base) : undefined
  const better = delta !== undefined && delta !== 0 && (lowerIsBetter ? delta < 0 : delta > 0)
  return (
    <div className="sim-kpi" title={title} data-testid={testid}>
      <span className="muted">{label}</span>
      <strong>
        {show(value)}
        {unit && value !== undefined && <small> {unit}</small>}
      </strong>
      {base !== undefined && (
        <small className={delta ? (better ? 'is-better' : 'is-worse') : 'muted'}>
          AS-IS {show(base)}
          {delta ? ` · ${delta > 0 ? '+' : '−'}${Math.round(Math.abs(delta) * 100)} %` : ''}
        </small>
      )}
    </div>
  )
}

/** Little's law in plain words: cases open at once = new cases per time unit × cycle time (same unit on both sides). */
function Little({ a, model, unit }: { a: Analysis; model: FlowModel; unit: string }) {
  const tu: TimeUnit = model.sim?.unit ?? 'min'
  const rate = model.sim?.arrivals
  const [open, setOpen] = useState('')
  const [perDay, setPerDay] = useState('')
  const forward = rate !== undefined && a.cycleTime !== undefined ? littlesLaw({ rate, time: a.cycleTime }, tu, tu).wip : undefined
  const per = unit === 'days' ? 'day' : unit
  const backward = littlesLaw({ wip: num(open), rate: num(perDay) }, 'd', 'd').time
  return (
    <div className="sim-little" data-testid="sim-little">
      {forward !== undefined ? (
        <p data-testid="little-wip">
          <strong>About {fmt(forward, 1)} cases are open at the same time</strong>
          <span className="muted">
            {' '}
            (Little's law: {fmt(rate)} new per {per} × {fmt(a.cycleTime)} {unit} cycle time
            {tu !== 'd' && `, or ${fmt(convertTime(1, 'd', tu) * rate!, 1)} new per day × ${fmt(convertTime(a.cycleTime!, tu, 'd'), 1)} days`}
            ). A day here is 24 hours.
          </span>
        </p>
      ) : (
        <p className="muted">Fill in the new cases per {per} and every activity's time to see how many cases are open at once (Little's law).</p>
      )}
      <div className="row">
        <span className="muted">Seen from outside:</span>
        <label>
          open cases <input className="sim-num" inputMode="decimal" value={open} placeholder="60" onChange={(e) => setOpen(e.target.value)} data-testid="little-open" />
        </label>
        <label>
          new per day <input className="sim-num" inputMode="decimal" value={perDay} placeholder="15" onChange={(e) => setPerDay(e.target.value)} data-testid="little-perday" />
        </label>
        {backward !== undefined && (
          <span data-testid="little-time">
            a case stays about <strong>{fmt(backward, 1)} days</strong> ({fmt(convertTime(backward, 'd', tu), 1)} {unit})
          </span>
        )}
      </div>
    </div>
  )
}
