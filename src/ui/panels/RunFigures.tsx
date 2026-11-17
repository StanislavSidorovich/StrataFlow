// Properties: what the last Run found for the selected element or lane (stage 6b phase 3). Nothing when there is no
// result or the element was not in it.
import { UNIT_NAMES } from '../../core/analysis'
import { useEditor } from '../store'
import { useRun } from '../simRun'
import { count, fmt, pct } from './simFormat'

export function RunFigures({ id }: { id: string }) {
  const last = useRun((s) => s.last)
  const model = useEditor((s) => s.model)
  if (!last) return null
  const r = last.result
  const el = r.elements.find((e) => e.id === id)
  const lane = r.lanes.find((l) => l.laneId === id)
  if (!el && !lane) return null
  const unit = UNIT_NAMES[r.unit]
  const stale = last.model !== model
  const cases = Math.max(1, r.started)
  return (
    <section className={`run-props${stale ? ' is-stale' : ''}`} data-testid="run-props">
      <h3>Last run</h3>
      <p className="muted">
        Level {r.level}, {r.runs.length} × {count(r.cases)} cases, seed {r.seed}
        {stale && ' · the model changed since'}
      </p>
      {el && (
        <dl>
          <dt>Started · completed</dt>
          <dd>
            {count(el.started)} · {count(el.completed)} ({fmt(el.started / cases)} per case)
          </dd>
          {r.level >= 2 && el.time.n > 0 && (
            <>
              <dt>Time of one run</dt>
              <dd>
                {fmt(el.time.mean)} {unit} (shortest {fmt(el.time.min)}, longest {fmt(el.time.max)})
              </dd>
            </>
          )}
          {r.level >= 2 && el.typedWait.n > 0 && (
            <>
              <dt>Typed wait</dt>
              <dd>
                {fmt(el.typedWait.mean)} {unit}
              </dd>
            </>
          )}
          {r.level === 3 && el.resourceWait.n > 0 && (
            <>
              <dt>Wait for a person</dt>
              <dd>
                {fmt(el.resourceWait.mean)} {unit} (longest {fmt(el.resourceWait.max)})
              </dd>
            </>
          )}
          {r.level >= 2 && el.fixedCost + el.unitCost > 0 && (
            <>
              <dt>Cost per case</dt>
              <dd>{fmt((el.fixedCost + el.unitCost) / cases)}</dd>
            </>
          )}
        </dl>
      )}
      {lane && (
        <dl>
          <dt>Busy</dt>
          <dd>
            {pct(lane.utilisation.mean)}
            {lane.utilisation.half !== undefined && ` ± ${pct(lane.utilisation.half)}`} with {lane.capacity} {lane.capacity === 1 ? 'person' : 'people'}
          </dd>
          {r.level === 3 && (
            <>
              <dt>Queue</dt>
              <dd>
                {fmt(lane.avgQueue)} on average, longest {fmt(lane.maxQueue, 0)}; wait {fmt(lane.meanWait)} {unit}
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  )
}
