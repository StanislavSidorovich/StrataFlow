// Runs a simulation off the page's main thread (stage 6b phase 3; design §3.1, §6).
// A worker does the work; when none can be made, or it dies before it answers, the same engine runs on the main
// thread in slices (`setTimeout` between them) so the page stays responsive and shows progress. Cancel terminates the
// worker; messages of an old run id are dropped. Nothing here touches the DOM, so a test can drive it with a fake worker.
import type { FlowModel } from '../core/metamodel'
import { Simulation, type SimResult } from '../core/simulate'
import { errorText } from './simWorkerCore'
import { SLICE_EVENTS, type FromWorker, type SimJobOptions, type ToWorker } from './simProtocol'

/** The part of `Worker` the runner uses. */
export interface WorkerLike {
  postMessage(m: ToWorker): void
  terminate(): void
  onmessage: ((e: { data: FromWorker }) => void) | null
  onerror: ((e: unknown) => void) | null
  onmessageerror?: ((e: unknown) => void) | null
}

export interface RunHandlers {
  onProgress(done: number, total: number): void
  onResult(result: SimResult): void
  onError(message: string): void
  /** The run (and every later one) continues on the main thread: no worker could be used. */
  onFallback?(): void
}

export type Schedule = (fn: () => void) => void

export class SimRunner {
  private nextId = 0
  private current: { id: number; model: FlowModel; options: SimJobOptions; h: RunHandlers } | null = null
  private worker: WorkerLike | null = null
  private noWorker: boolean

  /** `makeWorker` null = no worker at all (the fallback). `schedule` runs the next slice of a main-thread run. */
  constructor(
    private makeWorker: (() => WorkerLike) | null,
    private schedule: Schedule = (fn) => void setTimeout(fn, 0),
  ) {
    this.noWorker = makeWorker === null
  }

  get running() {
    return this.current !== null
  }
  get usesWorker() {
    return !this.noWorker
  }

  /** Starts a run and returns its id; a run still going is cancelled first. */
  run(model: FlowModel, options: SimJobOptions, h: RunHandlers): number {
    if (this.current) this.cancel()
    const id = ++this.nextId
    this.current = { id, model, options, h }
    if (!this.noWorker && !this.startWorker()) this.fallBack()
    if (!this.noWorker) this.worker!.postMessage({ type: 'run', id, model, options })
    else this.runMain(id)
    return id
  }

  /** Drops the current run: its worker is terminated (a new one is made next time); nothing is reported. */
  cancel(): void {
    this.current = null
    this.killWorker()
  }

  private killWorker() {
    const w = this.worker
    this.worker = null
    if (w) {
      w.onmessage = null
      w.onerror = null
      w.onmessageerror = null
      try {
        w.terminate()
      } catch {
        /* already gone */
      }
    }
  }

  private startWorker(): boolean {
    if (this.worker) return true
    try {
      const w = this.makeWorker!()
      w.onmessage = (e) => this.fromWorker(e.data)
      w.onerror = () => this.workerFailed()
      w.onmessageerror = () => this.workerFailed()
      this.worker = w
      return true
    } catch {
      return false
    }
  }

  private fromWorker(m: FromWorker) {
    const cur = this.current
    if (!cur || m.id !== cur.id) return
    if (m.type === 'progress') cur.h.onProgress(m.done, m.total)
    else {
      this.current = null
      if (m.type === 'result') cur.h.onResult(m.result)
      else cur.h.onError(m.message)
    }
  }

  /** The worker could not load or crashed: this run and later ones go on the main thread. */
  private workerFailed() {
    this.killWorker()
    const cur = this.current
    this.fallBack()
    if (cur) this.runMain(cur.id)
  }

  private fallBack() {
    this.noWorker = true
    this.current?.h.onFallback?.()
  }

  private runMain(id: number) {
    const cur = this.current
    if (!cur || cur.id !== id) return
    let sim: Simulation
    try {
      sim = new Simulation(cur.model, cur.options)
    } catch (e) {
      this.current = null
      cur.h.onError(errorText(e))
      return
    }
    const slice = () => {
      if (this.current?.id !== id) return
      try {
        const done = sim.step(SLICE_EVENTS)
        const p = sim.progress()
        cur.h.onProgress(p.done, p.total)
        if (done) {
          this.current = null
          cur.h.onResult(sim.result())
        } else this.schedule(slice)
      } catch (e) {
        this.current = null
        cur.h.onError(errorText(e))
      }
    }
    this.schedule(slice)
  }
}

/** The real worker; throws where `Worker` does not exist or the browser refuses it. */
export function realWorker(): WorkerLike {
  return new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
}
