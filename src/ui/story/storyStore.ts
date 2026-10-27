// Story state (SPEC §10.1): the story, its frames, the beat shown and the answer to its question. A story takes
// the place of the editor while it runs; the open model and the trainer are left as they are.
import { create } from 'zustand'
import { storyFrames, type Story, type StoryFrame } from '../../core/story'
import { useEditor } from '../store'

const ASK_KEY = 'strataflow.story.ask'

interface StoryState {
  story: Story | null
  frames: StoryFrame[]
  beat: number
  /** The answer to this beat's question (null = not answered). */
  answered: number | null
  /** Predict-first questions are asked (never in full screen). */
  ask: boolean
  presenting: boolean
  setAsk: (on: boolean) => void
  /** Starts a story; throws StoryError when it cannot play. */
  open: (story: Story) => void
  /** Starts a story whose frames are already built (a review replay). */
  openFrames: (story: Story, frames: StoryFrame[]) => void
  exit: () => void
  goTo: (beat: number) => void
  answer: (option: number) => void
  setPresenting: (on: boolean) => void
}

const readAsk = () => {
  try {
    return localStorage.getItem(ASK_KEY) !== 'off'
  } catch {
    return true
  }
}

export const useStory = create<StoryState>()((set, get) => ({
  story: null,
  frames: [],
  beat: 0,
  answered: null,
  ask: readAsk(),
  presenting: false,

  setAsk(ask) {
    try {
      localStorage.setItem(ASK_KEY, ask ? 'on' : 'off')
    } catch {
      /* storage unavailable */
    }
    set({ ask, answered: null })
  },
  open(story) {
    const frames = storyFrames(story, story.model ?? useEditor.getState().model)
    set({ story, frames, beat: 0, answered: null })
  },
  openFrames(story, frames) {
    set({ story, frames, beat: 0, answered: null })
  },
  exit() {
    get().setPresenting(false)
    set({ story: null, frames: [], beat: 0, answered: null })
  },
  goTo(beat) {
    const { frames } = get()
    if (frames.length) set({ beat: Math.max(0, Math.min(beat, frames.length - 1)), answered: null })
  },
  answer(option) {
    if (get().answered === null) set({ answered: option })
  },
  setPresenting(presenting) {
    set({ presenting })
    try {
      if (presenting && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {})
      else if (!presenting && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
    } catch {
      /* no full screen: presenting still hides the bars */
    }
  },
}))

type Waiting = Pick<StoryState, 'frames' | 'beat' | 'answered' | 'ask' | 'presenting'>

/** The question is waiting for an answer: the canvas keeps the frame before. */
export function isAsking(s: Waiting): boolean {
  return !!s.frames[s.beat]?.question && s.answered === null && s.ask && !s.presenting && s.beat > 0
}

/** The frame the canvas shows (the one before while a question waits), and the frame whose words the card shows. */
export function useShown(): { canvas: StoryFrame | null; frame: StoryFrame | null; asking: boolean } {
  const s = useStory()
  const frame = s.story ? (s.frames[s.beat] ?? null) : null
  const asking = isAsking(s)
  return { frame, asking, canvas: asking ? s.frames[s.beat - 1] : frame }
}
