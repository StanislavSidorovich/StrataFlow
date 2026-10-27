// Starting a story: from the trainer (a case), from File → Open, from File → Example.
import { replayError, reviewReplay } from '../../core/reviewReplay'
import { parseStory, type Story } from '../../core/story'
import { paragraphs } from '../../data/mytask'
import { useTrainer } from '../trainer/trainerStore'
import type { TrainerCase } from '../../data/cases'
import { storyOfCase } from '../../data/story'
import shopOrderStory from '../../../cases/shop-order.flow-story.json?raw'
import { useEditor } from '../store'
import { useStory } from './storyStore'

/** Plays a story; a story that cannot play is reported in the notice and nothing opens. */
export function present(make: () => Story): boolean {
  try {
    useStory.getState().open(make())
    return true
  } catch (e) {
    useEditor.getState().showError(`The story cannot be played: ${(e as Error).message}`)
    return false
  }
}

export const presentCase = (c: TrainerCase) => present(() => storyOfCase(c))

/**
 * Plays the open model's review fix by fix (the Changes panel's Play review). The task text is "My task" when the
 * student has one, so each fix's quote is lit in it. Says why when it cannot play.
 */
export function playReview(): boolean {
  const { model, showError } = useEditor.getState()
  const why = replayError(model)
  if (why) return (showError(why), false)
  const task = useTrainer.getState().task
  const replay = reviewReplay(model, task.text.trim() ? paragraphs(task.text) : undefined)
  if (!replay) return false
  useStory.getState().openFrames(replay.story, replay.frames)
  return true
}

/** File → Open of a `.flow-story.json`: a story without a model of its own is told over the open model. */
export function openStoryText(text: string): boolean {
  return present(() => parseStory(text, useEditor.getState().model))
}

/** File → Example: the online shop story. */
export const presentExample = () => present(() => parseStory(shopOrderStory))
