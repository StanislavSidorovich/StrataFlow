// Multi-file Bizagi projects with reusable sub-processes: a classmate's coursework and the course practice.
// Private (gitignored or outside the repo): skipped where the files are absent (CI).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readProject } from '../src/core/bpmn/reusable'
import { lintModel } from '../src/core/lint'

// A classmate's coursework stays outside the repo (never copied in): its folder is named in the gitignored
// private/classmate-project.txt (or FLOW_CLASSMATE_PROJECT).
const POINTER = 'private/classmate-project.txt'
const CLASSMATE = process.env.FLOW_CLASSMATE_PROJECT ?? (existsSync(POINTER) ? readFileSync(POINTER, 'utf8').trim() : '')
const CLINIC = 'private/course/bizagi/practice-1/clinic sp'
const project = (dir: string, only?: RegExp) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.bpmn') && (!only || only.test(f))).map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') })) : []

describe.skipIf(!existsSync(CLASSMATE))('readProject on a classmate Bizagi project', () => {
  it('opens the four reusable sub-processes as pages', async () => {
    const { model, warnings, pages } = await readProject(project(CLASSMATE, /^Diagram [1-5]\.bpmn$/))
    expect(pages).toBe(4)
    const subs = model.nodes.filter((n) => n.type === 'subProcess')
    expect(subs).toHaveLength(4)
    for (const s of subs) expect(model.nodes.filter((n) => n.parentId === s.id).length, s.name).toBeGreaterThan(2)
    for (const n of model.nodes) expect(model.diagram.shapes[n.id], n.id).toBeDefined()
    // A page has lanes the main pool lacks (the main pool has one unnamed lane): said in the warnings.
    expect(warnings.some((w) => /lanes? ".+" not in the main pool/.test(w))).toBe(true)
    expect(lintModel(model).filter((i) => i.rule === 'P19')).toEqual([])
  })

  it('finds the main file among other files of the folder', async () => {
    const { model, warnings } = await readProject(project(CLASSMATE))
    expect(model.nodes.filter((n) => n.type === 'subProcess')).toHaveLength(4)
    expect(warnings.filter((w) => w.includes('is not called')).length).toBeGreaterThan(0)
  })
})

describe.skipIf(!existsSync(CLINIC))('readProject on the course practice (clinic)', () => {
  it('opens every called page', async () => {
    const files = project(CLINIC)
    const { model, warnings, pages } = await readProject(files)
    expect(pages).toBeGreaterThan(0)
    expect(warnings.filter((w) => w.includes('not among the files'))).toEqual([])
    for (const n of model.nodes) expect(model.diagram.shapes[n.id], n.id).toBeDefined()
  })
})
