// The Run tab's state (stage 6b phase 3): the level, the run in progress, the last result with the model it was run
// on (so an edit afterwards marks it stale) and the formula figures of that same model. One runner for the page.
import { create } from 'zustand'
import { analyseModel, type Analysis } from '../core/analysis'
import type { FlowModel } from '../core/metamodel'
import type { SimLevel, SimResult } from '../core/simulate'
import { useEditor } from './store'
import { SimRunner, realWorker } from './simRunner'

export interface RunResult {
  result: SimResult
  /** The model the run was made on: another model object in the editor means the figures are out of date. */
  model: FlowModel
  /** The flow analysis of that model for the same pool: the Formula column. */
  formula?: Analysis
}

/** What the canvas draws under an activity after a run. */
export interface Badge {
  completed: number
  time: number
  wait: number
  /** The activity with the longest wait for a person (level 3). */
  worst: boolean
}

interface RunState {
  level: SimLevel
  running: boolean
  progress: { done: number; total: number } | null
  last: RunResult | null
  error: string | null
  /** The last run was cancelled: nothing was kept. */
  cancelled: boolean
  /** Running on the main thread because no worker could be used. */
  noWorker: boolean
  badgesOn: boolean
  badges: Map<string, Badge>
  start: (poolId: string | undefined) => void
  cancel: () => void
}

let runner = new SimRunner(typeof Worker === 'undefined' ? null : realWorker)
/** Tests replace the runner (a fake worker). */
export function setRunner(r: SimRunner) {
  runner.cancel()
  runner = r
}

function badgesOf(r: SimResult): Map<string, Badge> {
  const out = new Map<string, Badge>()
  let worst: string | undefined
  let worstWait = 0
  for (const e of r.elements) {
    if (e.type !== 'task' && e.type !== 'subProcess') continue
    if (e.completed === 0 && e.started === 0) continue
    out.set(e.id, { completed: e.completed, time: e.time.mean, wait: e.resourceWait.mean, worst: false })
    if (r.level === 3 && e.resourceWait.mean > worstWait) {
      worstWait = e.resourceWait.mean
      worst = e.id
    }
  }
  if (worst) out.get(worst)!.worst = true
  return out
}

export const useRun = create<RunState>()((set, get) => ({
  level: 2,
  running: false,
  progress: null,
  last: null,
  error: null,
  cancelled: false,
  noWorker: !runner.usesWorker,
  badgesOn: false,
  badges: new Map(),
  start: (poolId) => {
    if (get().running) return // a double click: one run
    const model = useEditor.getState().model
    set({ running: true, progress: { done: 0, total: 0 }, error: null, cancelled: false })
    const fail = (message: string) => set({ running: false, progress: null, error: message })
    try {
      runner.run(
        model,
        { level: get().level, poolId },
        {
          onProgress: (done, total) => set({ progress: { done, total } }),
          onResult: (result) => {
            let formula: Analysis | undefined
            try {
              const all = analyseModel(model)
              formula = all.find((x) => x.poolId === result.poolId) ?? all[0]
            } catch {
              /* the figures stand without a formula column */
            }
            set({ running: false, progress: null, last: { result, model, formula }, badges: badgesOf(result), error: null })
          },
          onError: fail,
          onFallback: () => set({ noWorker: true }),
        },
      )
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    }
  },
  cancel: () => {
    runner.cancel()
    set({ running: false, progress: null, cancelled: true })
  },
}))

// Another document on the canvas (New, Open, an example, a tab switch): a run in progress stops, its result goes.
useEditor.subscribe((s, prev) => {
  if (s.doc !== prev.doc) {
    runner.cancel()
    useRun.setState({ running: false, progress: null, last: null, error: null, cancelled: false, badges: new Map() })
  }
})
