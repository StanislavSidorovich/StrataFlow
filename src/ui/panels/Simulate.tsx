// The Simulate panel under the canvas (stage 6). Play: one case runs through the process, a token at a
// time; decisions ask which way. Times and costs: the figures of every activity, decision and lane are
// typed in the tables and the flow analysis (core/analysis) gives cycle time, waiting, efficiency, cost and
// how busy each lane is. "Keep as AS-IS" remembers the figures, so a redesign (TO-BE) shows what it changes.
import { useMemo, useState } from 'react'
import { create } from 'zustand'
import { FastForward, Pin, PinOff, Play, RotateCcw, StepForward, X } from 'lucide-react'
import { analyseModel, UNIT_NAMES, type Analysis } from '../../core/analysis'
import type { FlowModel, TimeUnit } from '../../core/metamodel'
import { isDecision } from '../../core/analysis'
import { nodeOf, setCapacity, setProbability, setSim, setSimSettings } from '../../core/ops'
import { pending, playOn, startPlay, stepPlay, type PlayState } from '../../core/play'
import { useEditor } from '../store'
import { HelpQ } from './Help'

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

let cache: { model: FlowModel | null; out: Analysis[] } = { model: null, out: [] }
/** The analyses of the current model, computed once per model version. */
export function useAnalyses(): Analysis[] {
  const model = useEditor((s) => s.model)
  if (cache.model !== model) cache = { model, out: analyseModel(model) }
  return cache.out
}

const fmt = (x: number | undefined, digits = 2) => (x === undefined ? '—' : String(Math.round(x * 10 ** digits) / 10 ** digits))
const pct = (x: number | undefined) => (x === undefined ? '—' : `${x < 0.1 ? Math.round(x * 1000) / 10 : Math.round(x * 100)} %`)
const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')))

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
  const edit = (id: string, key: 'duration' | 'wait' | 'cost', v: string) => apply((m) => setSim(m, id, { [key]: num(v) }), { coalesce: `sim:${id}:${key}` })
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
          <input className="sim-num" inputMode="decimal" value={model.sim?.arrivals ?? ''} placeholder="—" onChange={(e) => apply((m) => setSimSettings(m, { arrivals: num(e.target.value) }), { coalesce: 'sim:arrivals' })} data-testid="sim-arrivals" />
        </label>
      </div>

      <table className="sim-table" data-testid="sim-steps">
        <thead>
          <tr>
            <th>Activity</th>
            <th title="Expected runs per case: 0.3 = in 30 % of cases, 1.25 = once plus a 25 % rework">Runs</th>
            <th title={`Processing time of one run, in ${unit}`}>Duration</th>
            <th title={`Waiting time before it starts, in ${unit}`}>Waiting</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.id} className={s.missing ? 'is-missing' : undefined}>
              <td>
                <button className="link" onClick={() => useEditor.getState().select([s.id])}>
                  {s.name}
                </button>
              </td>
              <td>{fmt(s.runs)}</td>
              <td>{s.event ? '' : <input className="sim-num" inputMode="decimal" value={nodeOf(model, s.id)?.sim?.duration ?? ''} placeholder="?" onChange={(e) => edit(s.id, 'duration', e.target.value)} data-testid={`dur:${s.name}`} />}</td>
              <td>
                <input className="sim-num" inputMode="decimal" value={nodeOf(model, s.id)?.sim?.wait ?? ''} placeholder="0" onChange={(e) => edit(s.id, 'wait', e.target.value)} data-testid={`wait:${s.name}`} />
              </td>
              <td>{s.event ? '' : <input className="sim-num" inputMode="decimal" value={nodeOf(model, s.id)?.sim?.cost ?? ''} placeholder="0" onChange={(e) => edit(s.id, 'cost', e.target.value)} data-testid={`cost:${s.name}`} />}</td>
            </tr>
          ))}
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
                      <input
                        className="sim-num"
                        inputMode="decimal"
                        value={f.probability === undefined ? '' : Math.round(f.probability * 1000) / 10}
                        placeholder="auto"
                        onChange={(e) => {
                          const v = num(e.target.value)
                          apply((m) => setProbability(m, f.id, v === undefined ? undefined : v / 100), { coalesce: `p:${f.id}` })
                        }}
                        data-testid={`p:${g.name}:${f.name || nodeOf(model, f.target)?.name}`}
                      />
                    </td>
                  </tr>
                )),
            )}
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
            </tr>
          </thead>
          <tbody>
            {a.resources.map((r) => (
              <tr key={r.laneId} className={r.utilisation !== undefined && r.utilisation > 1 ? 'is-missing' : undefined}>
                <td>{r.name}</td>
                <td>
                  <input className="sim-num" inputMode="decimal" value={model.lanes.find((l) => l.id === r.laneId)?.capacity ?? ''} placeholder="1" onChange={(e) => apply((m) => setCapacity(m, r.laneId, num(e.target.value)), { coalesce: `cap:${r.laneId}` })} data-testid={`cap:${r.name}`} />
                </td>
                <td>{fmt(r.work)}</td>
                <td data-testid={`busy:${r.name}`}>{r.utilisation === undefined ? <span className="muted">set new cases</span> : pct(r.utilisation)}</td>
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
