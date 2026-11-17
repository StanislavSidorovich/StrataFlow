// What the simulation worker does with one job, apart from the worker plumbing so a test can run it directly.
import { Simulation } from '../core/simulate'
import { PROGRESS_MS, SLICE_EVENTS, type FromWorker, type ToWorker } from './simProtocol'

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Runs the job in slices, reports progress about every 100 ms, then the result or the error text (a `SimError`'s message is for the person). */
export function runJob(msg: ToWorker, post: (m: FromWorker) => void, now: () => number = Date.now): void {
  try {
    const sim = new Simulation(msg.model, msg.options)
    let last = now()
    while (!sim.step(SLICE_EVENTS)) {
      const t = now()
      if (t - last >= PROGRESS_MS) {
        last = t
        const p = sim.progress()
        post({ type: 'progress', id: msg.id, done: p.done, total: p.total })
      }
    }
    post({ type: 'result', id: msg.id, result: sim.result() })
  } catch (e) {
    post({ type: 'error', id: msg.id, message: errorText(e) })
  }
}
