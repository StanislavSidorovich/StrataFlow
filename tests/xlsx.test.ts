// Stage 6b phase 4: the .xlsx writer read back with readZip (sheets, headers, numeric cells, escaping, 31-character
// names, non-Latin text) and the tables built from a Kaiyo run.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { analyseModel } from '../src/core/analysis'
import { parseModel } from '../src/core/serialize'
import { simulate } from '../src/core/simulate'
import { buildWorkbookSheets, scenarioRows, xlsxFileName } from '../src/core/simTables'
import { pinRun } from '../src/core/whatIf'
import { buildXlsx, colName, sheetName, toTsv, xmlText } from '../src/core/xlsx'
import { readZip } from '../src/core/zip'

const dec = new TextDecoder()
async function parts(bytes: Uint8Array) {
  const z = await readZip(bytes)
  return new Map(z.map((e) => [e.name, dec.decode(e.data)]))
}

describe('xlsx writer', () => {
  it('writes the parts of a workbook, one sheet per entry, with the sheet names', async () => {
    const p = await parts(buildXlsx([{ name: 'Summary', rows: [['a']] }, { name: 'Lanes', rows: [['b']] }]))
    for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) expect(p.has(n), n).toBe(true)
    expect(p.get('xl/workbook.xml')).toContain('<sheet name="Summary" sheetId="1" r:id="rId1"/>')
    expect(p.get('xl/workbook.xml')).toContain('<sheet name="Lanes" sheetId="2" r:id="rId2"/>')
    expect(p.get('[Content_Types].xml')).toContain('/xl/worksheets/sheet2.xml')
  })

  it('numbers are numeric cells with formats, text is inline, bold headers have a style', async () => {
    const p = await parts(buildXlsx([{ name: 'T', rows: [[{ v: 'Name', bold: true }, { v: 'Share', bold: true }], ['Pack', 12.5], ['Ship', { v: 0.375, fmt: 'pct' }], ['x', null, Infinity, NaN, undefined]] }]))
    const x = p.get('xl/worksheets/sheet1.xml')!
    expect(x).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c>')
    expect(x).toContain('<c r="B2"><v>12.5</v></c>')
    expect(x).toContain('<c r="B3" s="2"><v>0.375</v></c>')
    expect(x).not.toMatch(/<c r="[C-E]4"/)
    expect(p.get('xl/styles.xml')).toContain('numFmtId="10"')
  })

  it('escapes XML and drops characters XML cannot hold; keeps non-Latin text', async () => {
    const p = await parts(buildXlsx([{ name: 'Тест', rows: [['A & B <c> "d" \'e\'', 'Склад\u0001 · 倉庫 🙂', '=1+1']] }]))
    const x = p.get('xl/worksheets/sheet1.xml')!
    expect(x).toContain('A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;')
    expect(x).toContain('Склад · 倉庫 🙂')
    expect(x).not.toContain('\u0001')
    expect(p.get('xl/workbook.xml')).toContain('name="Тест"')
    expect(xmlText('\uD800x')).toBe('x')
  })

  it('sheet names: 31 characters, no []:*?/\\, unique ignoring case, never empty', () => {
    const long = 'Process with a very long name that goes on'
    expect(sheetName(long)).toHaveLength(31)
    expect(sheetName('a[b]c:d*e?f/g\\h')).toBe('a b c d e f g h')
    expect(sheetName("'quoted'")).toBe('quoted')
    expect(sheetName('???')).toBe('Sheet')
    expect(sheetName('Lanes', ['lanes'])).toBe('Lanes 2')
    const a = sheetName(long)
    const b = sheetName(long, [a])
    expect(b).toHaveLength(31)
    expect(b).not.toBe(a)
    expect(b.endsWith(' 2')).toBe(true)
    expect(Array.from(sheetName('日本語'.repeat(20)))).toHaveLength(31)
  })

  it('writes valid, unique names into the workbook even when callers pass duplicates', async () => {
    const p = await parts(buildXlsx([{ name: 'X', rows: [] }, { name: 'x', rows: [] }, { name: 'a/b', rows: [] }]))
    const names = [...p.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1])
    expect(names).toEqual(['X', 'x 2', 'a b'])
  })

  it('column letters and the clipboard text', () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
    expect(toTsv([['a', 1.5, { v: 0.25, fmt: 'pct' }, null], ['b\tc\nd', Infinity]], 'en')).toBe('a\t1.5\t25 %\t\nb c d\t')
    expect(toTsv([[1.5]], 'pt-PT')).toBe('1,5')
    expect(toTsv([[1.5]], 'ru')).toBe('1,5')
  })
})

describe('simulation workbook', () => {
  const kaiyo = parseModel(readFileSync('cases/kaiyo-order.flow.json', 'utf8'))
  const result = simulate(kaiyo, { level: 3, cases: 100, runs: 2, seed: 1, target: 90 })
  const formula = analyseModel(kaiyo)[0]

  it('has the four sheets with headers and numeric figures', async () => {
    const sheets = buildWorkbookSheets({ result, formula, pins: [], targets: {}, date: '2026-11-17' })
    expect(sheets.map((s) => s.name)).toEqual(['Summary', 'Elements', 'Lanes', 'Scenarios'])
    const p = await parts(buildXlsx(sheets))
    const names = [...p.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1])
    expect(names).toEqual(['Summary', 'Elements', 'Lanes', 'Scenarios'])
    const lanes = p.get('xl/worksheets/sheet3.xml')!
    for (const h of ['Resource (lane)', 'Utilization (run)', 'Total cost']) expect(lanes).toContain(h)
    expect(lanes).toMatch(/<c r="A2" t="inlineStr"><is><t xml:space="preserve">Sales<\/t>/)
    expect(lanes).toMatch(/<c r="B2"><v>1<\/v><\/c>/)
    expect(lanes).toMatch(/<c r="C3" s="2"><v>0\.\d+<\/v><\/c>/)
    const el = p.get('xl/worksheets/sheet2.xml')!
    expect(el).toContain('Instances completed')
    expect(el).toContain('Pack goods')
    const sum = p.get('xl/worksheets/sheet1.xml')!
    expect(sum).toContain('2026-11-17')
    expect(sum).toMatch(/Cycle time \(h\)/)
    expect(p.get('xl/worksheets/sheet4.xml')).toContain('No run pinned')
  })

  it('the Scenarios sheet lists pinned runs with Δ against the first, the target and the verdict', async () => {
    const scen = simulate(kaiyo, { level: 3, cases: 100, runs: 2, seed: 1, target: 90, overrides: { capacity: { Lane_2: 2 } } })
    const pins = [pinRun(result, 'Base', []), { ...pinRun(scen, 'Packer 1 → 2', ['Warehouse 1 → 2']), cost: 1200 }]
    const rows = scenarioRows(pins, { cycle: 80 }, 'cycle')
    const flat = rows.map((r) => r.map((c) => (c !== null && typeof c === 'object' ? c.v : c)))
    expect(flat[0]).toEqual(['Variant', 'Changes', 'Cost of the variant', 'Seed', 'Cases × runs'])
    expect(flat[2][2]).toBe(1200)
    expect(flat.some((r) => r[0] === 'Packer 1 → 2' && r[1] === 'Cycle time' && (r[5] === 'meets the target' || r[5] === 'misses the target'))).toBe(true)
    const header = flat.find((r) => r[0] === 'Figure')!
    expect(header).toEqual(['Figure', 'Base', 'Packer 1 → 2', 'Δ', 'Δ %'])
    const p = await parts(buildXlsx(buildWorkbookSheets({ result, formula, pins, targets: { cycle: 80 }, judge: 'cycle', date: 'd' })))
    expect(p.get('xl/worksheets/sheet4.xml')).toContain('Packer 1 → 2')
  })

  it('file name follows the design and drops characters a file system refuses', () => {
    expect(xlsxFileName(result)).toMatch(/^.+ simulation L3 seed1\.xlsx$/)
    expect(xlsxFileName({ ...result, name: 'a/b:c*"d"' })).toBe('a b c d simulation L3 seed1.xlsx')
  })
})
