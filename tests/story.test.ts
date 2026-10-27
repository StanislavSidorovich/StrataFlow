// Story files and frames (SPEC §10.1): parse and refuse, the model reduced beat by beat, drawn flows, the group beat,
// every case as a draft story, the hand-written shop-order story.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { locateQuotes, missingQuotes, parseStory, StoryError, storyFrames, untold, type Story } from '../src/core/story'
import { parseModel } from '../src/core/serialize'
import { CASES } from '../src/data/cases'
import { storyFromCase, storyOfCase } from '../src/data/story'
import { nodeOf } from '../src/core/ops'
import { lintModel } from '../src/core/lint'

const shopText = readFileSync('cases/shop-order.flow-story.json', 'utf8')
const shop = () => parseModel(readFileSync('cases/shop-order.flow.json', 'utf8'))
const story = (beats: unknown[], extra: object = {}) => JSON.stringify({ format: 'flow-story', version: 1, title: 'T', beats, ...extra })
const refuse = (text: string, open = shop()) => {
  try {
    parseStory(text, open)
  } catch (e) {
    expect(e).toBeInstanceOf(StoryError)
    return (e as Error).message
  }
  throw new Error('expected a refusal')
}

describe('parse', () => {
  it('refuses what is not a story', () => {
    expect(refuse('nope')).toMatch(/Not a story file/)
    expect(refuse(JSON.stringify({ format: 'x' }))).toMatch(/format/)
    expect(refuse(story([]))).toMatch(/beats/)
  })
  it('names the bad beat and element', () => {
    expect(refuse(story([{ title: 'a', show: ['Online shop'] }, { title: 'Oops', show: ['Chek stock'] }]))).toMatch(/Beat 2 “Oops”.*no element named “Chek stock” \(did you mean “Check stock”/)
    expect(refuse(story([{ title: 'a', bogus: 1 }]))).toMatch(/Beat 1 “a”: unknown field “bogus”/)
    expect(refuse(story([{ title: 'a', show: ['Check stock'], question: { prompt: 'p', options: ['x', 'y'], right: 5, why: 'w' } }]))).toMatch(/Beat 1/)
  })
  it('refuses a flow between elements not shown, a boundary event without its host, a group of unshown steps', () => {
    expect(refuse(story([{ title: 'a', show: ['Check stock'], flows: ['Order received -> Check stock'] }]))).toMatch(/not both shown/)
    expect(refuse(story([{ title: 'a', show: ['14 days'] }]))).toMatch(/boundary event/)
    expect(refuse(story([{ title: 'a', group: { name: 'G', steps: ['Check stock'] } }]))).toMatch(/grouped before it is shown/)
  })
  it('refuses a token path with no flow, and finds a quote that is not in the text', () => {
    expect(refuse(story([{ title: 'a', show: ['Order received', 'Pack goods'], token: ['Order received', 'Pack goods'] }]))).toMatch(/no sequence flow/)
    const s = JSON.parse(story([{ title: 'a', quote: 'nowhere' }]))
    s.text = ['Something else.']
    expect(missingQuotes(s as Story)).toHaveLength(1)
  })
  it('tells a story over the open model when the file carries none, and needs one', () => {
    expect(() => parseStory(story([{ title: 'a', show: ['Check stock'] }]))).toThrow(/no model/)
    expect(parseStory(story([{ title: 'a', show: ['Check stock'] }]), shop()).beats).toHaveLength(1)
  })
})

describe('frames', () => {
  const s = parseStory(
    story([
      { title: 'pools', show: ['Online shop', 'Sales'] },
      { title: 'start', show: ['Order received', 'Customer'] },
      { title: 'check', show: ['Check stock'] },
    ]),
    shop(),
  )
  const frames = storyFrames(s, shop())
  it('reduces the model to what is shown so far and draws a flow once both ends are there', () => {
    expect(frames[0].model.nodes).toHaveLength(0)
    expect(frames[1].model.flows.map((f) => f.id)).toEqual(['MessageFlow_1'])
    expect(frames[2].model.flows.map((f) => f.id)).toContain('Flow_1')
    expect(frames[2].drawn.map((d) => d.id)).toEqual(['Flow_1'])
    expect(frames[2].current).toEqual(['Task_1'])
    expect(frames[2].focus).toBe('Task_1')
  })
  it('draws a flow from the older end', () => {
    expect(frames[2].drawn[0].from).toBe('source')
    const back = storyFrames(parseStory(story([{ title: 'a', show: ['Online shop', 'Sales', 'Check stock'] }, { title: 'b', show: ['Order received'] }]), shop()), shop())
    expect(back[1].drawn.find((d) => d.id === 'Flow_1')?.from).toBe('target')
  })
  it('holds a flow back until the beat that lists it', () => {
    const held = parseStory(
      story([
        { title: 'a', show: ['Online shop', 'Sales', 'Order received', 'Check stock'] },
        { title: 'b', flows: ['Order received -> Check stock'] },
      ]),
      shop(),
    )
    const f = storyFrames(held, shop())
    expect(f[0].model.flows.map((x) => x.id)).not.toContain('Flow_1')
    expect(f[1].drawn.map((d) => d.id)).toEqual(['Flow_1'])
  })
  it('walks a token along the named steps', () => {
    const t = parseStory(story([{ title: 'a', show: ['Order received', 'Check stock'] }, { title: 'run', token: ['Order received', 'Check stock'] }]), shop())
    expect(storyFrames(t, shop())[1].tokenFlows).toEqual(['Flow_1'])
  })
})

describe('shop-order story', () => {
  const s = parseStory(shopText)
  const frames = storyFrames(s, shop())
  it('has all its quotes in the text and at least 15 beats', () => {
    expect(missingQuotes(s)).toEqual([])
    expect(s.beats.length).toBeGreaterThanOrEqual(15)
    expect(locateQuotes(s).flat().every(Boolean)).toBe(true)
  })
  it('carries the shop-order model', () => {
    expect(s.model).toEqual(shop())
  })
  it('ends with Receive payment + 14 days + Reminder sent collapsed into Collect payment in the Sales lane', () => {
    const grouped = frames.find((f) => f.grouped)!
    const last = frames.at(-1)!
    const box = nodeOf(last.model, grouped.grouped!)!
    expect(box).toMatchObject({ name: 'Collect payment', type: 'subProcess', collapsed: true, laneId: 'Lane_1' })
    expect(nodeOf(last.model, 'Event_4')).toMatchObject({ parentId: box.id, attachedTo: 'Task_4' })
    const b = last.model.diagram.shapes[box.id]
    const ship = last.model.diagram.shapes.Task_5
    expect(ship.x - (b.x + b.width)).toBeLessThan(120)
    expect(lintModel(last.model, { expectLanes: true }).filter((i) => i.severity === 'error')).toEqual([])
  })
  it('opens the page of Collect payment in a beat of its own, with its steps and the timer on the border', () => {
    const at = frames.findIndex((x) => x.beat.page)
    const f = frames[at]
    const box = nodeOf(f.model, frames.find((x) => x.grouped)!.grouped!)!
    expect(at).toBeGreaterThan(frames.findIndex((x) => x.grouped))
    expect(f.page).toBe(box.id)
    // The three named steps, and the start and end event grouping added inside.
    expect(f.fit.map((id) => nodeOf(f.model, id)!.name)).toEqual(expect.arrayContaining(['14 days', 'Receive payment', 'Reminder sent']))
    expect(f.fit.every((id) => nodeOf(f.model, id)!.parentId === box.id)).toBe(true)
    expect(frames[at + 1].overview).toBe(true)
  })
  it('refuses a page beat that names a step, or a sub-process not shown yet', () => {
    expect(refuse(story([{ title: 'a', show: ['Check stock'], page: 'Check stock' }]))).toMatch(/not a collapsed sub-process/)
    expect(refuse(story([{ title: 'a', show: ['Check stock'], page: 'Nowhere' }]))).toMatch(/no element named/)
  })
  it('shows the whole reference before the group beat', () => {
    const at = frames.findIndex((x) => x.grouped)
    expect(frames[at - 1].model).toEqual(shop())
  })
})

describe('storyFromCase', () => {
  for (const c of CASES)
    it(`${c.id}: the last frame is the reference`, () => {
      const s = storyFromCase(c)
      const frames = storyFrames(s, c.reference())
      expect(frames.at(-1)!.model).toEqual(c.reference())
      expect(untold(frames, c.reference())).toEqual([])
      expect(missingQuotes(s)).toEqual([])
      expect(storyFrames(parseStory(JSON.stringify(s)), c.reference())).toHaveLength(frames.length)
    })
  it('uses the hand-written story where the case has one', () => {
    expect(storyOfCase(CASES.find((c) => c.id === 'shop-order')!).beats.some((b) => b.group)).toBe(true)
  })
})
