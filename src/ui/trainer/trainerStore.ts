// Trainer session (SPEC §9): which case and level is open, the text tags, the last check and the hint
// ladder; the lesson being read. The working model lives in the editor store; the user's own model waits
// in `backup` there until the task ends (StrataSQL lesson: never lose the user's model to a task).
import { create } from 'zustand'
import { doItForMe } from '../../core/assist'
import type { CompareResult } from '../../core/compare'
import { lintModel, summarize } from '../../core/lint'
import type { FlowModel } from '../../core/metamodel'
import { caseById, registerCase, tagFits, unregisterCase, type Tag, type TrainerCase } from '../../data/cases'
import { parseCaseFile } from '../../data/caseFile'
import { addMark, EMPTY_TASK, remapMarks, type Mark, type MyTask } from '../../data/mytask'
import { checkGoals, compareWithCase, levelStartModel, nextHint, recordScore, redesignScore, taggingScore, viewCase, type GoalCheck, type Hint, type Level, type Progress } from '../../data/trainer'
import { walkthroughOf, type WalkStep } from '../../data/walkthrough'
import { loadStoredModel, TRAINER_MODEL_KEY, useEditor } from '../store'

const SESSION_KEY = 'strataflow.trainer.session'
const PROGRESS_KEY = 'strataflow.trainer.progress'
const CUES_KEY = 'strataflow.trainer.cues'
const FILE_CASES_KEY = 'strataflow.trainer.fileCases'
const MY_TASK_KEY = 'strataflow.trainer.myTask'

// Cases opened from files come back after a reload (before the session that may use one).
const fileCaseTexts = new Map<string, string>()
for (const text of readJson<string[]>(FILE_CASES_KEY, []))
  try {
    const c = parseCaseFile(text)
    registerCase(c)
    fileCaseTexts.set(c.id, text)
  } catch {
    // A stored case that no longer reads is dropped.
  }

/** The walkthrough steps of a case, built once. */
export const walkSteps = walkthroughOf

export interface Session {
  caseId: string
  level: Level
  /** Level 1: span → the last tag chosen. */
  tags: Record<number, Tag>
  /** Level 1: span → was the first tag right. */
  firstTry: Record<number, boolean>
  /** Level 0–1: the span whose explanation is shown. */
  openSpan: number | null
  /** Level 1: the model is shown although not every phrase is tagged yet. */
  peek: boolean
  /** Levels 2–4: the hint shown and how many rungs of it. */
  hint: { hint: Hint; shown: number } | null
  /** Level 0: the walkthrough step shown and the answer to its question (null = not answered yet). */
  walk?: { step: number; answered: number | null } | null
}

export interface Check {
  result: CompareResult
  errors: number
  warnings: number
  /** The model that was checked: an edit makes the result stale. */
  model: FlowModel
  /** Redesign level: the figures against the goals. */
  goals?: GoalCheck
  /** The score of the check (the redesign's counts its goals too). */
  score: number
}

interface TrainerState {
  /** The trainer column is shown. */
  open: boolean
  session: Session | null
  check: Check | null
  progress: Progress
  /** Text cues are highlighted in the case text. */
  cues: boolean
  /** Bumped when a case file is added or removed (the picker lists them). */
  fileCases: number
  /** "My task" is open. */
  myTask: boolean
  setMyTask: (open: boolean) => void
  /** The text of "My task" and its tags (kept in this browser). */
  task: MyTask
  setTaskText: (title: string, text: string) => void
  markTask: (mark: Mark) => void
  unmarkTask: (index: number) => void
  /** The lesson being read and its answers (question index → option; 0 = the guess). */
  lesson: { id: string; answers: Record<number, number> } | null

  setOpen: (open: boolean) => void
  start: (caseId: string, level: Level, opts?: { walk?: boolean }) => void
  exit: () => void
  /** Level 0: start the walkthrough, go to a step (null ends it), answer the step's question. */
  walkTo: (step: number | null) => void
  walkAnswer: (option: number) => void
  /** Levels 2–4: make the next item match the reference (one undo step). */
  doIt: () => void
  /** Adds the case of a `*.flow-case.json` file and starts its walkthrough. */
  openCaseFile: (text: string) => TrainerCase
  removeFileCase: (id: string) => void
  tag: (span: number, tag: Tag) => void
  showSpan: (span: number | null) => void
  setPeek: (peek: boolean) => void
  setCues: (on: boolean) => void
  runCheck: () => void
  moreHint: () => void
  openLesson: (id: string | null) => void
  answer: (q: number, option: number) => void
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const t = localStorage.getItem(key)
    return t ? (JSON.parse(t) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable: the session just does not survive a reload.
  }
}

/** The stored task; its tags are matched to the text again (paragraphs are built from the text, and the rule that builds them can change). */
function readStoredTask(): MyTask {
  const t = readJson<MyTask>(MY_TASK_KEY, EMPTY_TASK)
  return t.text ? { ...t, marks: remapMarks(t.marks, t.text) } : t
}

export const useTrainer = create<TrainerState>()((set, get) => ({
  open: false,
  session: null,
  check: null,
  progress: readJson<Progress>(PROGRESS_KEY, {}),
  cues: readJson<boolean>(CUES_KEY, false),
  lesson: null,
  fileCases: 0,
  myTask: false,
  task: readStoredTask(),
  setTaskText(title, text) {
    const task = { title, text, marks: remapMarks(get().task.marks, text) }
    writeJson(MY_TASK_KEY, task)
    set({ task })
  },
  markTask(mark) {
    const task = { ...get().task, marks: addMark(get().task.marks, mark) }
    writeJson(MY_TASK_KEY, task)
    set({ task })
  },
  unmarkTask(index) {
    const task = { ...get().task, marks: get().task.marks.filter((_, i) => i !== index) }
    writeJson(MY_TASK_KEY, task)
    set({ task })
  },

  setOpen: (open) => set({ open }),
  setMyTask(myTask) {
    if (myTask && get().session) get().exit()
    set({ myTask, open: true, lesson: null })
  },

  start(caseId, level, opts = {}) {
    const c = caseById(caseId)
    if (!c) return
    if (level === 4 && !c.redesign) level = 3
    const editor = useEditor.getState()
    const backup = editor.backup ?? editor.model
    useEditor.setState({
      model: levelStartModel(c, level),
      backup,
      doc: editor.doc + 1,
      past: [],
      future: [],
      selection: [],
      page: null,
      error: null,
      message: null,
      checkOpen: false,
    })
    const session: Session = { caseId, level, tags: {}, firstTry: {}, openSpan: null, peek: false, hint: null, walk: null }
    set({ open: true, session, check: null, lesson: null, myTask: false })
    if (level === 0) set({ progress: save(recordScore(get().progress, caseId, 0, 100)) })
    if (level === 0 && opts.walk) get().walkTo(0)
  },

  walkTo(step) {
    const s = get().session
    const c = s && caseById(s.caseId)
    if (!s || !c || s.level !== 0) return
    const steps = walkSteps(c)
    if (step === null) {
      set({ session: { ...s, walk: null } })
      useEditor.setState({ model: c.reference(), selection: [], page: null })
      return
    }
    const i = Math.max(0, Math.min(step, steps.length - 1))
    set({ session: { ...s, walk: { step: i, answered: null }, openSpan: null } })
    showWalkStep(steps, i, false)
  },

  walkAnswer(option) {
    const s = get().session
    const c = s && caseById(s.caseId)
    if (!s?.walk || !c || s.walk.answered !== null) return
    set({ session: { ...s, walk: { ...s.walk, answered: option } } })
    showWalkStep(walkSteps(c), s.walk.step, true)
  },

  doIt() {
    const s = get().session
    const c = s && caseById(s.caseId)
    if (!s || !c || s.level < 2) return
    const v = viewCase(c, s.level)
    let said = ''
    const ok = useEditor.getState().apply((m) => {
      said = doItForMe(v.reference(), m, { synonyms: v.synonyms, groups: v.groups, figures: s.level === 4 })
    })
    if (!ok) return
    useEditor.getState().say(`${said} Undo (Ctrl+Z) takes it back.`)
    set({ session: { ...s, hint: null } })
    get().runCheck()
  },

  openCaseFile(text) {
    const c = parseCaseFile(text)
    registerCase(c)
    fileCaseTexts.set(c.id, text)
    writeJson(FILE_CASES_KEY, [...fileCaseTexts.values()])
    set({ fileCases: get().fileCases + 1 })
    get().start(c.id, 0, { walk: true })
    return c
  },

  removeFileCase(id) {
    if (get().session?.caseId === id) get().exit()
    unregisterCase(id)
    fileCaseTexts.delete(id)
    writeJson(FILE_CASES_KEY, [...fileCaseTexts.values()])
    set({ fileCases: get().fileCases + 1, progress: save(Object.fromEntries(Object.entries(get().progress).filter(([k]) => !k.startsWith(`${id}:`)))) })
  },

  exit() {
    const editor = useEditor.getState()
    if (editor.backup) {
      useEditor.setState({ model: editor.backup, backup: null, doc: editor.doc + 1, past: [], future: [], selection: [], page: null, error: null, message: null })
      try {
        localStorage.removeItem(TRAINER_MODEL_KEY)
      } catch {
        // nothing kept
      }
    }
    set({ session: null, check: null })
  },

  tag(span, tag) {
    const s = get().session
    const c = s && caseById(s.caseId)
    if (!s || !c) return
    const right = tagFits(c.spans[span], tag)
    const firstTry = span in s.firstTry ? s.firstTry : { ...s.firstTry, [span]: right }
    const next = { ...s, tags: { ...s.tags, [span]: tag }, firstTry, openSpan: span }
    set({ session: next })
    const done = c.spans.every((sp, i) => next.tags[i] && tagFits(sp, next.tags[i]))
    if (done) set({ progress: save(recordScore(get().progress, s.caseId, 1, taggingScore(c, firstTry))) })
  },

  showSpan(openSpan) {
    const s = get().session
    if (!s) return
    set({ session: { ...s, openSpan } })
    const c = caseById(s.caseId)
    if (openSpan === null || !c || (s.level === 1 && !s.peek && !allTagged(s))) return
    // Show the elements the phrase became.
    const m = useEditor.getState().model
    const names = new Set(c.spans[openSpan].target)
    const ids = [...m.nodes, ...m.participants, ...m.lanes].filter((x) => names.has(x.name)).map((x) => x.id)
    useEditor.getState().select(ids)
  },

  setPeek: (peek) => set((st) => (st.session ? { session: { ...st.session, peek } } : st)),
  setCues(cues) {
    writeJson(CUES_KEY, cues)
    set({ cues })
  },

  runCheck() {
    const s = get().session
    const c = s && caseById(s.caseId)
    if (!s || !c) return
    const model = useEditor.getState().model
    const result = compareWithCase(c, model, s.level)
    const lint = summarize(lintModel(model, { expectLanes: true }))
    const goals = s.level === 4 ? (checkGoals(c, model) ?? undefined) : undefined
    const score = goals ? redesignScore(result, goals) : result.score
    set({ check: { result, errors: lint.error, warnings: lint.warning, model, goals, score } })
    set({ progress: save(recordScore(get().progress, s.caseId, s.level, score)) })
    // A new check keeps the hint when it is still about the same item, else starts a fresh ladder.
    const h = nextHint(viewCase(c, s.level), result)
    const kept = s.hint && h && s.hint.hint.key === h.key ? s.hint.shown : 0
    set({ session: { ...s, hint: h && kept ? { hint: h, shown: kept } : null } })
  },

  moreHint() {
    const s = get().session
    const c = s && caseById(s.caseId)
    if (!s || !c) return
    const model = useEditor.getState().model
    const h = nextHint(viewCase(c, s.level), compareWithCase(c, model, s.level))
    if (!h) {
      set({ session: { ...s, hint: null } })
      return
    }
    const shown = s.hint && s.hint.hint.key === h.key ? Math.min(s.hint.shown + 1, h.steps.length) : 1
    set({ session: { ...s, hint: { hint: h, shown } } })
  },

  openLesson(id) {
    set({ lesson: id ? { id, answers: {} } : null, open: true })
  },

  answer(q, option) {
    const l = get().lesson
    if (!l || q in l.answers) return
    set({ lesson: { ...l, answers: { ...l.answers, [q]: option } } })
  },
}))

export const allTagged = (s: Session) => {
  const c = caseById(s.caseId)
  return !!c && c.spans.every((sp, i) => s.tags[i] && tagFits(sp, s.tags[i]))
}

/** Shows a walkthrough step on the canvas: before its question is answered, the step before it. */
function showWalkStep(steps: WalkStep[], i: number, answered: boolean) {
  const step = steps[i]
  const shown = step.question && !answered ? steps[Math.max(0, i - 1)] : step
  const page = step.page
  useEditor.setState({ model: shown.model, selection: shown === step ? step.focus.filter((id) => shown.model.nodes.some((n) => n.id === id) || shown.model.participants.some((p) => p.id === id) || shown.model.lanes.some((l) => l.id === id)) : [], page, past: [], future: [] })
}

function save(p: Progress): Progress {
  writeJson(PROGRESS_KEY, p)
  return p
}

// The session survives a reload together with the trainer's model (and the user's own model as backup).
const stored = readJson<Session | null>(SESSION_KEY, null)
if (stored && caseById(stored.caseId)) {
  const model = loadStoredModel(TRAINER_MODEL_KEY)
  const own = loadStoredModel()
  if (model) {
    useEditor.setState({ model, backup: own ?? useEditor.getState().model })
    useTrainer.setState({ session: { ...stored, hint: null }, open: true })
  }
}
useTrainer.subscribe((st, prev) => {
  if (st.session !== prev.session) writeJson(SESSION_KEY, st.session)
})
// New or Open during a task ends it (the editor drops the backup): the session goes too.
useEditor.subscribe((st, prev) => {
  if (prev.backup && !st.backup && useTrainer.getState().session) useTrainer.setState({ session: null, check: null })
})
