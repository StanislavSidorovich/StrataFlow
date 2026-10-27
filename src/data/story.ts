// Stories of the trainer's cases: a hand-written `cases/<id>.flow-story.json` where there is one, else a draft
// made from the case itself (`storyFromCase`: pools and lanes, then the walkthrough's order, the phrases as
// quotes, their "why" as the comment, the walkthrough's questions).
import type { FlowModel } from '../core/metamodel'
import { parseStory, STORY_FORMAT, STORY_VERSION, type Beat, type Story } from '../core/story'
import type { TrainerCase } from './cases'
import { walkthroughOf } from './walkthrough'
import shopOrderStory from '../../cases/shop-order.flow-story.json?raw'

/** Hand-written stories, by case id. */
export const STORY_TEXTS: Record<string, string> = { 'shop-order': shopOrderStory }

/** How a beat names an element: its name when that is unique, else `#id`. */
function namer(ref: FlowModel) {
  const all = [...ref.participants, ...ref.lanes, ...ref.nodes]
  return (id: string) => {
    const name = all.find((x) => x.id === id)?.name
    return name && all.filter((x) => x.name === name).length === 1 ? name : `#${id}`
  }
}

export function storyFromCase(c: TrainerCase): Story {
  const ref = c.reference()
  const nm = namer(ref)
  const beats: Beat[] = walkthroughOf(c).map((step) => {
    if (step.key === 'done') return { title: step.title, overview: true, text: step.text.slice(1) }
    const quotes = step.spans.map((i) => c.spans[i].phrase)
    const whys = step.spans.map((i) => c.spans[i].why)
    return {
      title: step.title,
      show: step.focus.map(nm),
      ...(quotes.length ? { quote: quotes } : {}),
      text: whys.length ? whys : step.text,
      ...(step.question ? { question: step.question } : {}),
    }
  })
  return { format: STORY_FORMAT, version: STORY_VERSION, title: c.title, model: ref, text: c.text, beats }
}

/** The story to present for a case: the hand-written one if the case has it. */
export function storyOfCase(c: TrainerCase): Story {
  const text = STORY_TEXTS[c.id]
  return text ? parseStory(text) : storyFromCase(c)
}
