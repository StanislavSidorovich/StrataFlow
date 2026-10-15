// Trainer data (SPEC §9): the case texts match `cases/*.md`, every phrase is found and points at real
// elements, the level start models, the hint ladder, and the text cues' precision on the tagged phrases.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lintModel } from '../src/core/lint'
import { CASES, spanRanges, TAGS } from '../src/data/cases'
import { cardById } from '../src/data/help'
import { LESSONS } from '../src/data/lessons'
import { findCues } from '../src/data/textcues'
import { compareWithCase, levelStartModel, nextHint, paragraphParts, recordScore, taggingScore } from '../src/data/trainer'

describe('trainer cases', () => {
  for (const c of CASES)
    describe(c.id, () => {
      it('the text is the case text of the .md file', () => {
        const md = readFileSync(`cases/${c.id}.md`, 'utf8').replace(/\r\n/g, '\n')
        const section = md.slice(md.indexOf('## 2.'), md.indexOf('## 3.'))
        const paragraphs = section
          .split('\n')
          .filter((l) => l.startsWith('>'))
          .map((l) => l.replace(/^> ?/, ''))
          .join('\n')
          .split(/\n\n|\n(?=\S)/)
          .map((p) => p.trim())
          .filter(Boolean)
        expect(c.text).toEqual(paragraphs)
      })

      it('every phrase is found, in order, and names elements of the reference', () => {
        const ref = c.reference()
        const names = new Set([...ref.nodes, ...ref.participants, ...ref.lanes].map((x) => x.name))
        spanRanges(c).forEach((r, i) => expect(r.start, c.spans[i].phrase).toBeGreaterThanOrEqual(0))
        for (const s of c.spans) for (const t of s.target) expect(names, `${s.phrase} → ${t}`).toContain(t)
        for (const k of Object.keys(c.synonyms)) expect(names, k).toContain(k)
        const parts = c.text.map((_, p) => paragraphParts(c, p))
        expect(parts.map((ps) => ps.map((x) => x.text).join(''))).toEqual(c.text)
        expect(parts.flat().filter((x) => x.span !== undefined)).toHaveLength(c.spans.length)
      })

      it('level 2 keeps pools, lanes and tasks, drops events, gateways and flows', () => {
        const m = levelStartModel(c, 2)
        expect(m.flows).toEqual([])
        expect(m.nodes.every((n) => n.type === 'task' || n.type === 'subProcess')).toBe(true)
        expect(m.lanes).toHaveLength(c.reference().lanes.length)
        expect(Object.keys(m.diagram.shapes).sort()).toEqual([...m.nodes, ...m.participants, ...m.lanes].map((x) => x.id).sort())
        const r = compareWithCase(c, m)
        expect(r.items.filter((i) => i.kind === 'lane' || i.kind === 'pool').every((i) => i.status === 'ok' || i.key.startsWith('pool:'))).toBe(true)
        expect(r.score).toBeLessThan(60)
      })

      it('the hint ladder leads to the reference: following the answers fixes the items one by one', () => {
        const m = levelStartModel(c, 2)
        const h = nextHint(c, compareWithCase(c, m))!
        expect(h.steps.length).toBeGreaterThanOrEqual(2)
        expect(h.steps[0]).toMatch(/^Not there yet|^Almost/)
        expect(nextHint(c, compareWithCase(c, c.reference()))).toBeNull()
      })

      it('level 3 starts empty and the reference lints clean', () => {
        expect(levelStartModel(c, 3).nodes).toEqual([])
        expect(lintModel(c.reference(), { expectLanes: true }).filter((i) => i.severity !== 'info')).toEqual([])
      })
    })

  it('every tag has a help card', () => {
    for (const t of TAGS) expect(cardById(t.card), t.id).toBeTruthy()
  })

  it('progress keeps the best score; level 1 counts first tries', () => {
    let p = recordScore({}, 'x', 2, 60)
    p = recordScore(p, 'x', 2, 40)
    expect(p['x:2']).toBe(60)
    const c = CASES[0]
    const all = Object.fromEntries(c.spans.map((_, i) => [i, true]))
    expect(taggingScore(c, all)).toBe(100)
    expect(taggingScore(c, { ...all, 0: false })).toBeLessThan(100)
  })
})

describe('text cues', () => {
  it('most cues fall on a tagged phrase of the same kind (precision ≥ 0.75)', () => {
    let hits = 0
    let total = 0
    const misses: string[] = []
    for (const c of CASES) {
      const ranges = spanRanges(c)
      c.text.forEach((text, p) => {
        for (const cue of findCues(text)) {
          total++
          const ok = c.spans.some((s, i) => s.p === p && ranges[i].start < cue.end && ranges[i].end > cue.start && (s.tag === cue.tag || s.accept?.includes(cue.tag)))
          if (ok) hits++
          else misses.push(`${c.id}: "${text.slice(cue.start, cue.end)}" as ${cue.tag}`)
        }
      })
    }
    expect(total).toBeGreaterThan(20)
    expect(hits / total, misses.join('\n')).toBeGreaterThanOrEqual(0.75)
  })

  it('finds the course cue words', () => {
    const tags = (t: string) => findCues(t).map((h) => h.tag)
    expect(tags('If the card is valid, otherwise not')).toEqual(['decision', 'decision'])
    expect(tags('Meanwhile the clerk packs')).toContain('parallel')
    expect(tags('after 2 days')).toEqual(['event'])
    expect(tags('the manager notifies the customer')).toEqual(['role', 'message'])
  })
})

describe('lessons', () => {
  it('every question has its answer among the options, cards and practice cases exist', () => {
    for (const l of LESSONS) {
      for (const q of [l.guess, ...l.test]) {
        expect(q.answer, q.q).toBeLessThan(q.options.length)
        expect(new Set(q.options).size, q.q).toBe(q.options.length)
      }
      for (const c of l.cards) expect(cardById(c), `${l.id}: ${c}`).toBeTruthy()
      if (l.practice) expect(CASES.some((c) => c.id === l.practice!.caseId)).toBe(true)
    }
  })
})
