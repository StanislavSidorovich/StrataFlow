// The queue panel of the Times and costs tab (stage 6b phase 4; chapter 6 note §2 items 7 and 8): the wait for a person in
// one lane counted two ways, "as in the course" (a team is one server with the summed speed, M/M/1) and "more exact"
// (M/M/c), and a small options table: add a person (μ goes up) against a second team (c = 2), with W, Wq, a target and a cost.
import { useState } from 'react'
import { UNIT_NAMES, type Analysis } from '../../core/analysis'
import type { FlowModel } from '../../core/metamodel'
import { parseNum } from '../../core/number'
import { monolith, exact, staffingOptions, type QueueOption } from '../../core/queue'
import { parseTime } from '../../core/whatIf'
import { fmt, pct } from './simFormat'
import './queuePanel.css'

const t = (q: QueueOption, x: number) => (q.stable ? fmt(x) : 'never settles')

export function QueuePanel({ a, model }: { a: Analysis; model: FlowModel }) {
  const lanes = a.queues.filter((q) => q.visits > 0)
  const [laneId, setLaneId] = useState<string | undefined>()
  const arrivals = model.sim?.arrivals
  if (!arrivals || !lanes.length) return null
  const q = lanes.find((x) => x.laneId === laneId) ?? lanes[0]
  const name = (id: string) => a.resources.find((r) => r.laneId === id)?.name ?? 'Lane'
  return <Panel key={q.laneId} q={q} lanes={lanes.map((x) => ({ id: x.laneId, name: name(x.laneId) }))} laneName={name(q.laneId)} onLane={setLaneId} arrivals={arrivals} model={model} />
}

function Panel({ q, lanes, laneName, onLane, arrivals, model }: { q: Analysis['queues'][number]; lanes: { id: string; name: string }[]; laneName: string; onLane: (id: string) => void; arrivals: number; model: FlowModel }) {
  const unit = model.sim?.unit ?? 'min'
  const u = UNIT_NAMES[unit]
  const lambda = arrivals * q.visits
  const c = q.servers
  const course = monolith(lambda, q.meanService, c)
  const more = exact(lambda, q.meanService, c)
  const options = staffingOptions(lambda, q.meanService, c)
  const [basis, setBasis] = useState<'course' | 'exact'>('course')
  const [on, setOn] = useState<'wq' | 'w'>('wq')
  const [targetText, setTargetText] = useState('')
  const [costs, setCosts] = useState<Record<string, string>>({})
  const target = parseTime(targetText, unit)
  return (
    <section className="qp" aria-label="Queue" data-testid="queue-panel">
      <h3>
        Waiting for a person{' '}
        {lanes.length > 1 ? (
          <select value={q.laneId} onChange={(e) => onLane(e.target.value)} aria-label="Lane" data-testid="qp-lane">
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        ) : (
          <span>{laneName}</span>
        )}
      </h3>
      <p className="muted qp-inputs">
        {fmt(lambda)} requests per {u === 'days' ? 'day' : u} (λ), {fmt(q.meanService)} {u} of work each (1/μ1), {c} {c === 1 ? 'person' : 'people'}.
      </p>
      <table className="sim-table qp-table" data-testid="qp-models">
        <thead>
          <tr>
            <th>Counted</th>
            <th title="How busy the server is: λ ÷ (c·μ1)">ρ</th>
            <th title={`Average wait in the queue, in ${u}`}>Wq ({u})</th>
            <th title={`Average time in the system: wait + service, in ${u}`}>W ({u})</th>
          </tr>
        </thead>
        <tbody>
          <tr data-testid="qp-course">
            <td title="The course folds a team into one server whose speed is c times one person's (μ = c·μ1) and uses the M/M/1 formulas">as in the course (one server, μ = c·μ1, M/M/1)</td>
            <td className="run-num">{pct(course.rho)}</td>
            <td className="run-num" data-testid="qp-course-wq">{t(course, course.wq)}</td>
            <td className="run-num">{t(course, course.w)}</td>
          </tr>
          <tr data-testid="qp-exact">
            <td title="c people serve c cases at once, each case takes the full time of one person: Erlang C">more exact (M/M/c)</td>
            <td className="run-num">{pct(more.rho)}</td>
            <td className="run-num" data-testid="qp-exact-wq">{t(more, more.wq)}</td>
            <td className="run-num">{t(more, more.w)}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted qp-note" data-testid="qp-note">
        {c > 1
          ? course.stable && more.stable
            ? `The single fast server understates the total time W (${fmt(course.w)} against ${fmt(more.w)} ${u}): a real team still needs the full ${fmt(q.meanService)} ${u} for each case, not ${fmt(q.meanService / c)}. Only the wait in the queue goes the other way (${fmt(course.wq)} against ${fmt(more.wq)} ${u}).`
            : 'The two ways differ a lot here: a real team still needs the full time of one person for each case.'
          : 'With one person the two ways are the same. They differ from two people up: the single fast server understates the total time W of a real team.'}
      </p>

      <h4>Options: more speed or a second team?</h4>
      <div className="row qp-target">
        <label>
          Target on{' '}
          <select value={on} onChange={(e) => setOn(e.target.value as 'wq' | 'w')} aria-label="Figure for the target" data-testid="qp-on">
            <option value="wq">wait in the queue (Wq)</option>
            <option value="w">time in the system (W)</option>
          </select>
        </label>
        <label>
          at most{' '}
          <input className={`sim-num${target.error ? ' is-invalid' : ''}`} value={targetText} onChange={(e) => setTargetText(e.target.value)} placeholder={`${u}, or 30 min`} title={`In ${u}, the model's unit; type 30 min or 1 h to convert`} aria-label="Target" data-testid="qp-target" />
        </label>
        {target.error && <span className="num-error">{target.error}</span>}
        {!target.error && target.converted && <span className="muted">{target.converted}</span>}
        <label>
          Count as{' '}
          <select value={basis} onChange={(e) => setBasis(e.target.value as 'course' | 'exact')} aria-label="Counting" data-testid="qp-basis">
            <option value="course">the course (M/M/1)</option>
            <option value="exact">M/M/c</option>
          </select>
        </label>
      </div>
      <table className="sim-table qp-table" data-testid="qp-options">
        <thead>
          <tr>
            <th>Option</th>
            <th>Wq ({u})</th>
            <th>W ({u})</th>
            <th>Target</th>
            <th title="What the option costs: type it, the model has no figure">Cost</th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => {
            const m = basis === 'course' ? o.course : o.exact
            const v = on === 'wq' ? m.wq : m.w
            const ok = target.value === undefined || target.error ? undefined : m.stable && v <= target.value + 1e-12
            const cost = parseNum(costs[o.id] ?? '')
            return (
              <tr key={o.id} data-testid={`qp-opt:${o.id}`}>
                <td title={o.note}>
                  {o.label}
                  <small className="muted"> {basis === 'course' ? `${o.course.servers} ${o.course.servers === 1 ? "server" : "servers"}, ${fmt(o.course.service)} ${u} each` : `${o.exact.servers} people`}</small>
                </td>
                <td className="run-num">{t(m, m.wq)}</td>
                <td className="run-num">{t(m, m.w)}</td>
                <td data-testid={`qp-ok:${o.id}`}>{ok === undefined ? '' : ok ? <span className="is-better">✓ meets</span> : <span className="is-worse">✗ misses</span>}</td>
                <td>
                  <input className={`sim-num${cost.error ? ' is-invalid' : ''}`} inputMode="decimal" value={costs[o.id] ?? ''} onChange={(e) => setCosts({ ...costs, [o.id]: e.target.value })} placeholder="0" title={cost.error} aria-label={`Cost of ${o.label}`} data-testid={`qp-cost:${o.id}`} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted qp-note">Adding a person makes the one team faster (μ goes up). A second team doubles the servers: each case still takes today's time, but two can be served at once.</p>
    </section>
  )
}
