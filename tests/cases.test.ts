// The own cases (cases/README.md): each reference model is drawn with the editor's operations, laid out and
// saved as `cases/<id>.flow.json`; the file must match the drawing. UPDATE_CASES=1 writes the files.
// Lint and BPMN round-trip of the files: tests/lint.test.ts and tests/bpmn-roundtrip.test.ts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyModel } from '../src/core/metamodel'
import { autoLayout } from '../src/core/layout'
import { serializeModel } from '../src/core/serialize'
import { CASES } from './fixtures/cases'

const SECTIONS = ['Meta', 'Case text', 'Text → model mapping', 'Reference process', 'Key decisions and alternatives', 'AS-IS problems / TO-BE ideas', 'Hints per level, synonyms']

describe('own cases', () => {
  for (const c of CASES)
    describe(c.id, () => {
      it('the reference model file matches the drawing', async () => {
        const m = emptyModel(c.name)
        c.draw(m)
        await autoLayout(m)
        const text = serializeModel(m)
        const file = `cases/${c.id}.flow.json`
        if (process.env.UPDATE_CASES || !existsSync(file)) writeFileSync(file, text)
        // A Windows checkout may turn LF into CRLF.
        expect(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).toBe(text)
      })

      it('the case file has the 7 sections and names every step of the model', () => {
        const md = readFileSync(`cases/${c.md ?? c.id}.md`, 'utf8')
        expect(md.match(/^## \d\. .+$/gm)).toEqual(SECTIONS.map((s, i) => `## ${i + 1}. ${s}`))
        const m = emptyModel(c.name)
        c.draw(m)
        const reference = md.slice(md.indexOf('## 4.'), md.indexOf('## 5.'))
        for (const n of m.nodes) if (n.name) expect(reference, n.name).toContain(n.name)
        for (const p of m.participants) expect(reference, p.name).toContain(p.name)
        for (const l of m.lanes) expect(reference, l.name).toContain(l.name)
      })
    })
})
