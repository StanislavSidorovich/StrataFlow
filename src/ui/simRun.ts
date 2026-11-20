// The Run tab's state (stage 6b phase 3): the level, the run in progress, the last result with the model it was run
// on (so an edit afterwards marks it stale) and the formula figures of that same model. One runner for the page.
import { create } from 'zustand'
import { analyseModel, type Analysis } from '../core/analysis'
import type { FlowModel } from '../core/metamodel'
import type { SimLevel, SimResult } from '../core/simulate'
import { describeChanges, resolveChanges, type Change } from '../core/whatIf'
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

/** "Run both": the model and the scenario on the same seed, side by side. */
export interface Compare {
  base: RunResult
  scenario: RunResult
  /** The scenario as it was run (names of the changes, what was ignored or rebalanced). */
  name: string
  changes: Change[]
  described: string[]
  notes: string[]
}

export interface RunOptions {
  /** A cycle-time target in the model's unit: the run reports the share of cases within it. */
  target?: number
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
  /** The last "Run both"; cleared by a plain run. */
  compare: Compare | null
  /** Which of the two runs of "Run both" is going. */
  phase: 'base' | 'scenario' | null
  start: (poolId: string | undefined, opts?: RunOptions) => void
  startCompare: (poolId: string | undefined, scenario: { name: string; changes: Change[] }, opts?: RunOptions) => void
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
  compare: null,
  phase: null,
  start: (poolId, opts = {}) => {
    if (get().running) return // a double click: one run
    const model = useEditor.getState().model
    set({ running: true, progress: { done: 0, total: 0 }, error: null, cancelled: false, phase: null })
    const fail = (message: string) => set({ running: false, progress: null, error: message, phase: null })
    try {
      runner.run(
        model,
        { level: get().level, poolId, ...(opts.target !== undefined && { target: opts.target }) },
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
            set({ running: false, progress: null, last: { result, model, formula }, badges: badgesOf(result), error: null, compare: null })
          },
          onError: fail,
          onFallback: () => set({ noWorker: true }),
        },
      )
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    }
  },
  startCompare: (poolId, scenario, opts = {}) => {
    if (get().running) return
    const model = useEditor.getState().model
    const level = get().level
    const res = resolveChanges(model, scenario.changes)
    set({ running: true, phase: 'base', progress: { done: 0, total: 0 }, error: null, cancelled: false })
    const fail = (message: string) => set({ running: false, progress: null, error: message, phase: null })
    const wrap = (result: SimResult): RunResult => {
      let formula: Analysis | undefined
      try {
        const all = analyseModel(model)
        formula = all.find((x) => x.poolId === result.poolId) ?? all[0]
      } catch {
        /* no formula column */
      }
      return { result, model, formula }
    }
    const handlers = (onResult: (r: SimResult) => void) => ({
      onProgress: (done: number, total: number) => set({ progress: { done, total } }),
      onResult,
      onError: fail,
      onFallback: () => set({ noWorker: true }),
    })
    const target = opts.target !== undefined ? { target: opts.target } : {}
    try {
      runner.run(model, { level, poolId, ...target }, handlers((base) => {
        set({ phase: 'scenario', progress: { done: 0, total: 0 } })
        try {
          runner.run(model, { level, poolId, ...target, overrides: res.overrides }, handlers((scen) => {
            const b = wrap(base)
            set({
              running: false,
              progress: null,
              phase: null,
              last: b,
              badges: badgesOf(base),
              error: null,
              compare: { base: b, scenario: wrap(scen), name: scenario.name, changes: scenario.changes, described: describeChanges(model, scenario.changes), notes: res.notes },
            })
          }))
        } catch (e) {
          fail(e instanceof Error ? e.message : String(e))
        }
      }))
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    }
  },
  cancel: () => {
    runner.cancel()
    set({ running: false, progress: null, cancelled: true, phase: null })
  },
}))

// Another document on the canvas (New, Open, an example, a tab switch): a run in progress stops, its result goes.
useEditor.subscribe((s, prev) => {
  if (s.doc !== prev.doc) {
    runner.cancel()
    useRun.setState({ running: false, progress: null, last: null, error: null, cancelled: false, badges: new Map(), compare: null, phase: null })
  }
})
