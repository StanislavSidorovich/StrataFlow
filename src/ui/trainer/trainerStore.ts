// Trainer session (SPEC §9): which case and level is open, the text tags, the last check and the hint
// ladder; the lesson being read. The working model lives in the editor store; the user's own model waits
// in `backup` there until the task ends (StrataSQL lesson: never lose the user's model to a task).
import { create } from 'zustand'
import type { CompareResult } from '../../core/compare'
import { lintModel, summarize } from '../../core/lint'
import type { FlowModel } from '../../core/metamodel'
import { caseById, tagFits, type Tag } from '../../data/cases'
import { compareWithCase, levelStartModel, nextHint, recordScore, taggingScore, type Hint, type Level, type Progress } from '../../data/trainer'
import { loadStoredModel, TRAINER_MODEL_KEY, useEditor } from '../store'

const SESSION_KEY = 'strataflow.trainer.session'
const PROGRESS_KEY = 'strataflow.trainer.progress'
const CUES_KEY = 'strataflow.trainer.cues'

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
  /** Levels 2–3: the hint shown and how many rungs of it. */
  hint: { hint: Hint; shown: number } | null
}

export interface Check {
  result: CompareResult
  errors: number
  warnings: number
  /** The model that was checked: an edit makes the result stale. */
  model: FlowModel
}

interface TrainerState {
  /** The trainer column is shown. */
  open: boolean
  session: Session | null
  check: Check | null
  progress: Progress
  /** Text cues are highlighted in the case text. */
  cues: boolean
  /** The lesson being read and its answers (question index → option; 0 = the guess). */
  lesson: { id: string; answers: Record<number, number> } | null

  setOpen: (open: boolean) => void
  start: (caseId: string, level: Level) => void
  exit: () => void
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

export const useTrainer = create<TrainerState>()((set, get) => ({
  open: false,
  session: null,
  check: null,
  progress: readJson<Progress>(PROGRESS_KEY, {}),
  cues: readJson<boolean>(CUES_KEY, false),
  lesson: null,

  setOpen: (open) => set({ open }),

  start(caseId, level) {
    const c = caseById(caseId)
    if (!c) return
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
    const session: Session = { caseId, level, tags: {}, firstTry: {}, openSpan: null, peek: false, hint: null }
    set({ open: true, session, check: null, lesson: null })
    if (level === 0) set({ progress: save(recordScore(get().progress, caseId, 0, 100)) })
  },

  exit() {
    const editor = useEditor.getState()
    if (editor.backup) {
      useEditor.setState({ model: editor.backup, backup: null, doc: editor.doc + 1, past: [], future: [], selection: [], page: null, error: null })
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
    const result = compareWithCase(c, model)
    const lint = summarize(lintModel(model, { expectLanes: true }))
    set({ check: { result, errors: lint.error, warnings: lint.warning, model } })
    set({ progress: save(recordScore(get().progress, s.caseId, s.level, result.score)) })
    // A new check keeps the hint when it is still about the same item, else starts a fresh ladder.
    const h = nextHint(c, result)
    const kept = s.hint && h && s.hint.hint.key === h.key ? s.hint.shown : 0
    set({ session: { ...s, hint: h && kept ? { hint: h, shown: kept } : null } })
  },

  moreHint() {
    const s = get().session
    const c = s && caseById(s.caseId)
    if (!s || !c) return
    const model = useEditor.getState().model
    const h = nextHint(c, compareWithCase(c, model))
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
