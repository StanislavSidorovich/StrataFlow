// "My task": tagging an own text and checking a model against it without a reference.
import { describe, expect, it } from 'vitest'
import { emptyModel } from '../src/core/metamodel'
import { CASES, spanRanges } from '../src/data/cases'
import { parseCaseFile } from '../src/data/caseFile'
import { addMark, blocks, compareTagging, coverage, mentions, myTaskToCaseFile, paragraphs, remapMarks, textCues, untaggedCues, type Mark, type MyTask } from '../src/data/mytask'

const library = CASES.find((c) => c.id === 'library-lend')!
/** The library case typed in as an own task, tagged as the case does. */
function libraryTask(): MyTask {
  const ranges = spanRanges(library)
  let marks: Mark[] = []
  library.spans.forEach((s, i) => {
    if (s.phrase === 'Otherwise') return // overlaps nothing, but tags the same gateway twice
    marks = addMark(marks, { p: s.p, start: ranges[i].start, end: ranges[i].end, tag: s.tag, text: s.phrase })
  })
  return { title: 'Library', text: library.text.join('\n\n'), marks }
}

describe('my task', () => {
  it('splits the text into paragraphs without Markdown marks', () => {
    expect(paragraphs('# Title\n\n- **first** point\r\n2. second\n\n')).toEqual(['Title', 'first point', 'second'])
  })

  it('a phrase mentions an element when most of its words are there', () => {
    expect(mentions("checks the member's library card", 'Check library card')).toBe(true)
    expect(mentions('The librarian at the front desk', 'Front desk')).toBe(true)
    expect(mentions('stamps the due date in the book', 'Hand over book')).toBe(false)
  })

  it('the reference covers every tagged phrase; an empty model covers none', () => {
    const task = libraryTask()
    // Only the start event is named in other words than the text ("Loan requested").
    expect(coverage(task, library.reference()).missing.map((x) => x.mark.text)).toEqual(['asks to borrow a book'])
    expect(coverage(task, library.reference()).unmentioned.map((u) => u.name)).toEqual(['Loan requested'])
    const none = coverage(task, emptyModel())
    expect(none.missing).toHaveLength(task.marks.length)
    expect(none.missing.find((x) => x.mark.tag === 'decision')!.why).toMatch(/no exclusive/)
  })

  it('lists model elements no phrase names, and cue words not tagged', () => {
    const task = libraryTask()
    const fewer = { ...task, marks: task.marks.filter((m) => m.tag !== 'activity') }
    const cov = coverage(fewer, library.reference())
    expect(cov.unmentioned.map((u) => u.name)).toEqual(expect.arrayContaining(['Check library card', 'Fetch book']))
    expect(cov.questions.some((q) => q.text === 'checks')).toBe(true)
  })

  it('keeps tags whose words stay when the text is edited', () => {
    const task = libraryTask()
    const text = `Intro line.\n${task.text}`
    const marks = remapMarks(task.marks, text)
    expect(marks).toHaveLength(task.marks.length)
    expect(marks.every((m) => paragraphs(text)[m.p].slice(m.start, m.end) === m.text)).toBe(true)
  })

  it('saves as a case file that opens with its walkthrough', () => {
    const { text, left } = myTaskToCaseFile(libraryTask(), library.reference())
    const c = parseCaseFile(text)
    expect(c.title).toBe('Library')
    expect(left).toBeLessThanOrEqual(2)
    expect(c.spans.length).toBe(libraryTask().marks.length - left)
    expect(c.reference()).toEqual(library.reference())
  })
})

describe('my task: hints and compare', () => {
  const text = 'The clerk checks the card. If it is valid, the clerk sends a letter.'
  const cues = textCues(paragraphs(text))
  const mark = (phrase: string, tag: Mark['tag']): Mark => {
    const start = text.indexOf(phrase)
    return { p: 0, start, end: start + phrase.length, tag, text: phrase }
  }

  it('finds cues with their paragraph and tag', () => {
    expect(cues.map((c) => [c.text, c.tag])).toEqual(expect.arrayContaining([['If', 'decision'], ['checks', 'activity']]))
  })

  it('hints skip cues the student has tagged', () => {
    const marks = [mark('checks the card', 'activity')]
    const left = untaggedCues(cues, marks).map((c) => c.text)
    expect(left).not.toContain('checks')
    expect(left).toContain('If')
    expect(untaggedCues(cues, [])).toHaveLength(cues.length)
  })

  it('compare is empty until something is tagged', () => {
    expect(compareTagging([], cues)).toEqual([])
  })

  it('asks about untagged cues and about tags that disagree', () => {
    const q = compareTagging([mark('checks the card', 'activity'), mark('If', 'parallel')], cues)
    expect(q.find((x) => x.cue.text === 'If')).toMatchObject({ kind: 'other-tag' })
    expect(q.find((x) => x.cue.text === 'If')!.text).toMatch(/exclusive gateway/)
    expect(q.find((x) => x.cue.text === 'sends')).toMatchObject({ kind: 'untagged' })
    expect(q.some((x) => x.cue.text === 'checks')).toBe(false)
  })

  it('accepts a compatible tag: a pool for a role word, a message for a send', () => {
    const q = compareTagging([mark('The clerk', 'participant'), mark('sends a letter', 'message')], cues)
    expect(q.some((x) => x.kind === 'other-tag')).toBe(false)
  })

  it('a role named once is not asked again in the next sentence', () => {
    const q = compareTagging([mark('The clerk', 'role')], cues)
    expect(q.filter((x) => x.cue.tag === 'role')).toEqual([])
  })
})

describe('my task: text pasted from a PDF', () => {
  const pdf = [
    'Introduction',
    'The management team suspects that inefficiencies in the',
    'claims handling process may be',
    'contributing to these issues. The company requires your',
    'support.',
    'The Process',
    'The scope of this project is to model the',
    'process followed when a customer',
    'submits a claim. If all checks are successful, the claim moves to',
    'the next stage for damage',
    'evalua-',
    'tion.',
    'Claim Validation',
    'When a claim handler receives a claim, the first task is to verify.',
  ].join('\n')

  it('joins lines that break mid-sentence and keeps titles as headings', () => {
    expect(blocks(pdf)).toEqual([
      { text: 'Introduction', heading: true },
      { text: 'The management team suspects that inefficiencies in the claims handling process may be contributing to these issues. The company requires your support.', heading: false },
      { text: 'The Process', heading: true },
      { text: 'The scope of this project is to model the process followed when a customer submits a claim. If all checks are successful, the claim moves to the next stage for damage evaluation.', heading: false },
      { text: 'Claim Validation', heading: true },
      { text: 'When a claim handler receives a claim, the first task is to verify.', heading: false },
    ])
  })

  it('blank lines and bullets still separate; Markdown headings are headings', () => {
    expect(blocks('# Title\n\nfirst line\nsecond\n\n- one\n- two')).toEqual([
      { text: 'Title', heading: true },
      { text: 'first line second', heading: false },
      { text: 'one', heading: false },
      { text: 'two', heading: false },
    ])
  })
})
