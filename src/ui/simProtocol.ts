// Messages between the page and the simulation worker (stage 6b phase 3; design §3.1).
// Every message of a run carries its run id: the page drops anything whose id is not the current run's (a cancelled
// run's late progress or result).
import type { FlowModel } from '../core/metamodel'
import type { SimOptions, SimResult } from '../core/simulate'

/** What can be sent to a worker: `onProgress` is a function and stays on the page. */
export type SimJobOptions = Omit<SimOptions, 'onProgress'>

export type ToWorker = { type: 'run'; id: number; model: FlowModel; options: SimJobOptions }

export type FromWorker =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; result: SimResult }
  | { type: 'error'; id: number; message: string }

/** Events per slice of `Simulation.step`, in the worker and in the main-thread fallback. */
export const SLICE_EVENTS = 20_000
/** The worker tells the page how far it is about this often (ms). */
export const PROGRESS_MS = 100
