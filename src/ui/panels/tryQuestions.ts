// The "Try this" questions of the Kaiyo example (stage 6b phase 5, design §5.3): three questions that walk the student
// through the Run tab. The box is shown while the Kaiyo example is open until it is dismissed; the dismissal is kept
// in localStorage when it is available and in memory otherwise (try/catch everywhere).
// The figures in the answers are measured on the example with its seed (tests/kaiyo-teaching.test.ts keeps them true).
import { create } from 'zustand'

export interface TryQuestion {
  id: 'wait' | 'peak' | 'second'
  title: string
  text: string
  /** What the button does, in a few words. */
  action: string
  answer: string
}

export const TRY_QUESTIONS: TryQuestion[] = [
  {
    id: 'wait',
    title: 'Guess the wait',
    text: 'At 12 orders a day the one person in the warehouse is busy about 68 % of the time (0.5 orders an hour × 1.35 h of work per order). Guess how long a warehouse task (0.75 h of work) waits for the person, then run level 3 and read Wait (run) in the Warehouse row.',
    action: 'Go to level 3',
    answer:
      'About 0.7 h of waiting before each task of 0.75 h (200 cases × 5 runs, seed 1; with 2 000 cases about 0.75 h). The estimate beside it, 1.56 h, is about twice as much: it assumes exponential work times, and the packing and shipping times here vary less. Busy 68 % is not "no queue".',
  },
  {
    id: 'peak',
    title: 'Peak season',
    text: 'In peak season 18 orders a day come, 1.5 times as many. Set up What if: arrivals × 1.5, then Run both with 200 cases and again with 400. The formula puts the warehouse at 101 % (the run shows about 105 %). What happens to the wait for a person?',
    action: 'Set up arrivals × 1.5',
    answer:
      'It keeps growing with the length of the run: Waiting for a person (per case) is about 11 h at 200 cases and 17 h at 400 (5 runs, seed 1). Above 100 % there is no steady state: the queue grows with every case, and Run shows the red warning.',
  },
  {
    id: 'second',
    title: 'A second packer',
    text: 'Set up What if: Warehouse 2 people, then Run both. The warehouse falls to about 35 % busy in the run (the formula 0.5 × 1.35 ÷ 2 says 34 %). How much of the wait for a person is left, and is the cycle time much shorter? Why not?',
    action: 'Set up Warehouse 2',
    answer:
      'Waiting for a person nearly vanishes (from about 1.4 h to 0.2 h per case, 200 cases × 5 runs, seed 1), but the cycle time only falls from about 70 h to 69 h. The typed waits, 23 h before packing and 47.5 h before shipping, dominate: the lever is the hand-over, not the people. Waiting, not work, is the target.',
  },
]

const KEY = 'strataflow.sim.tryDismissed'
const read = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
const write = (on: boolean) => {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* storage is off: the dismissal lives in memory only */
  }
}

interface TryState {
  dismissed: boolean
  dismiss: () => void
  show: () => void
}

export const useTry = create<TryState>()((set) => ({
  dismissed: read(),
  dismiss: () => {
    write(true)
    set({ dismissed: true })
  },
  show: () => {
    write(false)
    set({ dismissed: false })
  },
}))
