// What-if state of the Run tab (stage 6b phase 4): the scenario being edited, the targets, and up to three pinned runs.
// Pinned runs keep their figures only and live in localStorage when it is available (try/catch everywhere); a new
// document on the canvas clears them, since their figures belong to the model they were run on.
import { create } from 'zustand'
import { MAX_PINS, withChange, type Change, type PinnedRun, type Scenario, type Targets } from '../core/whatIf'
import { useEditor } from './store'

const KEY = 'strataflow.sim.pinned'
const UNITS = ['min', 'h', 'd']

function load(): PinnedRun[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((p) => p && typeof p.id === 'string' && typeof p.label === 'string' && UNITS.includes(p.unit) && Array.isArray(p.values) && Array.isArray(p.changes))
      .slice(0, MAX_PINS)
  } catch {
    return []
  }
}
function save(pins: PinnedRun[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(pins))
  } catch {
    /* storage is off or full: the pins live in memory only */
  }
}

interface WhatIfState {
  scenario: Scenario
  /** The kind being added and its target, set by the form and by a click on the canvas. */
  targets: Targets
  /** The metric the summary table judges the variants on. */
  judge: string | undefined
  pins: PinnedRun[]
  setName: (name: string) => void
  setCost: (cost: number | undefined) => void
  addChange: (c: Change) => void
  removeChange: (index: number) => void
  clearScenario: () => void
  setTarget: (key: string, value: number | undefined) => void
  setJudge: (key: string | undefined) => void
  /** Returns false when three runs are already pinned. */
  pin: (run: PinnedRun) => boolean
  unpin: (id: string) => void
  setPinCost: (id: string, cost: number | undefined) => void
  clearPins: () => void
}

export const useWhatIf = create<WhatIfState>()((set, get) => ({
  scenario: { name: '', changes: [] },
  targets: {},
  judge: undefined,
  pins: load(),
  setName: (name) => set((s) => ({ scenario: { ...s.scenario, name } })),
  setCost: (cost) =>
    set((s) => {
      const sc = { ...s.scenario }
      if (cost === undefined) delete sc.cost
      else sc.cost = cost
      return { scenario: sc }
    }),
  addChange: (c) => set((s) => ({ scenario: { ...s.scenario, changes: withChange(s.scenario.changes, c) } })),
  removeChange: (i) => set((s) => ({ scenario: { ...s.scenario, changes: s.scenario.changes.filter((_, k) => k !== i) } })),
  clearScenario: () => set({ scenario: { name: '', changes: [] } }),
  setTarget: (key, value) =>
    set((s) => {
      const t = { ...s.targets }
      if (value === undefined) delete t[key]
      else t[key] = value
      return { targets: t, judge: s.judge ?? (value === undefined ? undefined : key) }
    }),
  setJudge: (judge) => set({ judge }),
  pin: (run) => {
    const { pins } = get()
    if (pins.length >= MAX_PINS) return false
    const next = [...pins, run]
    save(next)
    set({ pins: next })
    return true
  },
  unpin: (id) => {
    const next = get().pins.filter((p) => p.id !== id)
    save(next)
    set({ pins: next })
  },
  setPinCost: (id, cost) => {
    const next = get().pins.map((p) => {
      if (p.id !== id) return p
      const q = { ...p }
      if (cost === undefined) delete q.cost
      else q.cost = cost
      return q
    })
    save(next)
    set({ pins: next })
  },
  clearPins: () => {
    save([])
    set({ pins: [] })
  },
}))

useEditor.subscribe((s, prev) => {
  if (s.doc !== prev.doc) {
    useWhatIf.setState({ scenario: { name: '', changes: [] }, targets: {}, judge: undefined, pins: [] })
    save([])
  }
})
