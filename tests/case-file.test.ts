// `*.flow-case.json`: every built-in case survives the trip to a case file and back; broken files say why.
import { describe, expect, it } from 'vitest'
import { CASES } from '../src/data/cases'
import { caseToFile, isCaseFile, parseCaseFile } from '../src/data/caseFile'
import { walkthroughSteps } from '../src/data/walkthrough'

describe('case files', () => {
  for (const c of CASES)
    it(`${c.id} round-trips`, () => {
      const text = caseToFile(c)
      expect(isCaseFile(text)).toBe(true)
      const back = parseCaseFile(text)
      expect(back.id).toBe(`file:${c.id}`)
      expect(back.text).toEqual(c.text)
      expect(back.spans).toEqual(c.spans)
      expect(back.synonyms).toEqual(c.synonyms)
      expect(back.reference()).toEqual(c.reference())
      expect(back.redesign?.reference()).toEqual(c.redesign?.reference())
      expect(back.redesign?.goals).toEqual(c.redesign?.goals)
      expect(walkthroughSteps(back).at(-1)!.model).toEqual(c.reference())
      expect(caseToFile(back)).toBe(text)
    })

  const base = () => JSON.parse(caseToFile(CASES[0]))
  const broken = (edit: (o: ReturnType<typeof base>) => void) => {
    const o = base()
    edit(o)
    return () => parseCaseFile(JSON.stringify(o))
  }

  it('refuses a model file, a phrase not in the text, a name not in the model, an unknown tag', () => {
    expect(isCaseFile('{"format":"strata-flow"}')).toBe(false)
    expect(() => parseCaseFile('{"format":"strata-flow","version":1}')).toThrow(/Not a Quaera Flow case/)
    expect(broken((o) => (o.case.spans[0].phrase = 'no such words'))).toThrow(/“no such words” is not in paragraph 0/)
    expect(broken((o) => (o.case.spans[1].target = ['Nowhere']))).toThrow(/names “Nowhere”, which is not in the reference/)
    expect(broken((o) => (o.case.spans[2].tag = 'thing'))).toThrow(/unknown tag “thing”/)
    expect(broken((o) => (o.case.spans[2].p = 3))).toThrow(/paragraph 3, the text has 1/)
    expect(broken((o) => delete o.case.title)).toThrow(/case.title is missing/)
    expect(broken((o) => (o.model.flows[0].target = 'Ghost'))).toThrow(/no element Ghost/)
  })
})
