// The trainer column (left of the canvas, so Properties stays on the right): the case picker with
// progress and lessons; a task (case text, tagging, Check with the comparison, the hint ladder); a lesson.
import { useEffect, type ReactNode } from 'react'
import { ArrowLeft, CircleCheck, Eye, EyeOff, GraduationCap, Lightbulb, ListChecks, Play, X } from 'lucide-react'
import type { CompareItem } from '../../core/compare'
import { CASES, caseById, TAGS, tagFits, type TrainerCase } from '../../data/cases'
import { LESSONS, lessonById, type Lesson, type Question } from '../../data/lessons'
import { findCues } from '../../data/textcues'
import { DONE_AT, LEVELS, paragraphParts, progressKey, type Level } from '../../data/trainer'
import { HelpQ } from '../panels/Help'
import { useEditor } from '../store'
import { startTour } from './Tour'
import { allTagged, useTrainer, type Session } from './trainerStore'

export function TrainerPane() {
  const session = useTrainer((s) => s.session)
  const lesson = useTrainer((s) => s.lesson)
  const l = lesson && lessonById(lesson.id)
  return (
    <aside className="side-panel trainer-panel" aria-label="Trainer" data-testid="trainer-panel">
      <div className="help-nav">
        {l || session ? (
          <button className="btn" onClick={() => (l ? useTrainer.getState().openLesson(null) : useTrainer.getState().exit())} title={session && !l ? 'Leave the task: your own process comes back' : 'Back to the cases'} data-testid="trainer-back">
            <ArrowLeft size={14} /> {session && !l ? 'Leave task' : 'Cases'}
          </button>
        ) : (
          <strong>
            <GraduationCap size={15} className="inline-icon" /> Trainer
          </strong>
        )}
        <button className="btn icon" onClick={() => useTrainer.getState().setOpen(false)} title="Hide the trainer (a task goes on)" aria-label="Hide the trainer" data-testid="trainer-close">
          <X size={14} />
        </button>
      </div>
      {l ? <LessonView lesson={l} /> : session ? <TaskView session={session} /> : <Picker />}
    </aside>
  )
}

// ---------------------------------------------------------------- picker

function Picker() {
  const progress = useTrainer((s) => s.progress)
  return (
    <div className="trainer-picker">
      <p className="muted">Learn to turn a text into a process: read a worked example, tag the text, complete a process, then build one yourself. Your own process waits and comes back when you leave a task.</p>
      <h3>Cases</h3>
      {CASES.map((c) => (
        <div key={c.id} className="trainer-case" data-testid={`case:${c.id}`}>
          <div className="trainer-case-head">
            <strong>{c.title}</strong>
            <span className="stars" title={`Difficulty ${c.difficulty} of 3`}>{'★'.repeat(c.difficulty)}</span>
          </div>
          <div className="muted small">{c.concepts.join(' · ')}</div>
          <div className="level-row">
            {LEVELS.map(({ level, title }) => {
              const best = progress[progressKey(c.id, level)]
              const done = best !== undefined && best >= (level === 0 ? 100 : DONE_AT)
              return (
                <button key={level} className={`level-btn${done ? ' is-done' : ''}`} title={`${title}${best !== undefined ? ` · best ${best} %` : ''}`} onClick={() => useTrainer.getState().start(c.id, level)} data-testid={`start:${c.id}:${level}`}>
                  {done ? <CircleCheck size={12} /> : null} {level}
                  <span>{title}</span>
                  {best !== undefined && level > 0 && <em>{best} %</em>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <h3>Lessons</h3>
      <ul className="help-list">
        {LESSONS.map((l, i) => (
          <li key={l.id}>
            <button onClick={() => useTrainer.getState().openLesson(l.id)} data-testid={`lesson:${l.id}`}>
              <strong>
                {i + 1}. {l.title}
              </strong>
              <span className="muted">{l.goal}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={startTour} data-testid="tour-start">
        <Play size={14} /> Tour of the app
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- a task

function TaskView({ session }: { session: Session }) {
  const c = caseById(session.caseId)!
  const level = session.level
  const cues = useTrainer((s) => s.cues)
  const past = useEditor((s) => s.past.length)

  const switchTo = (to: Level) => {
    if (to === level) return
    if (level >= 2 && past && !confirm('Start this level? Your drawing for this level is not kept (save it first with File → Save if you want it).')) return
    useTrainer.getState().start(c.id, to)
  }

  return (
    <div className="trainer-task" data-testid="trainer-task">
      <h2>{c.title}</h2>
      <div className="level-tabs" role="tablist">
        {LEVELS.map((l) => (
          <button key={l.level} role="tab" aria-selected={l.level === level} className={l.level === level ? 'is-active' : ''} onClick={() => switchTo(l.level)} title={l.title} data-testid={`level:${l.level}`}>
            {l.level} · {l.title}
          </button>
        ))}
      </div>
      <p className="task-line">{LEVELS[level].task}</p>
      {level > 0 && (
        <label className="check small" title="Mark words that hint at an element (if, while, sends…). A cue is a hint, not the answer.">
          <input type="checkbox" checked={cues} onChange={(e) => useTrainer.getState().setCues(e.target.checked)} data-testid="cues" /> Show cue words
        </label>
      )}
      <CaseText c={c} session={session} cues={cues && level > 0} />
      {level === 0 && <SpanNote c={c} session={session} />}
      {level === 1 && <Tagging c={c} session={session} />}
      {level === 0 && (
        <>
          <h3>Key decisions</h3>
          <ul className="decisions">
            {c.decisions.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </>
      )}
      {level >= 2 && <CheckBox c={c} session={session} />}
    </div>
  )
}

/** The case text: spans (levels 0–1, and the hint's phrase), cue words on request. */
function CaseText({ c, session, cues }: { c: TrainerCase; session: Session; cues: boolean }) {
  const hintSpan = session.hint && session.hint.shown >= 2 ? session.hint.hint.span : undefined
  return (
    <div className="case-text" data-testid="case-text">
      {c.text.map((_, p) => {
        let at = 0
        return (
          <p key={p}>
            {paragraphParts(c, p).map((part, i) => {
              const from = at
              at += part.text.length
              const inner = cues ? withCues(c.text[p], from, at) : part.text
              if (part.span === undefined) return <span key={i}>{inner}</span>
              const k = part.span
              const s = c.spans[k]
              if (session.level >= 2)
                return (
                  <span key={i} className={k === hintSpan ? 'span-hint' : undefined}>
                    {inner}
                  </span>
                )
              const tag = session.tags[k]
              const cls =
                session.level === 0 ? `span is-${s.tag}` : tag ? (tagFits(s, tag) ? `span is-${tag} is-right` : 'span is-wrong') : 'span is-open'
              return (
                // A span, not a button: a button is an inline block and breaks the lines of the text.
                <span
                  key={i}
                  role="button"
                  tabIndex={0}
                  className={`${cls}${session.openSpan === k ? ' is-focus' : ''}`}
                  onClick={() => useTrainer.getState().showSpan(k)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    useTrainer.getState().showSpan(k)
                  }}
                  data-testid={`span:${k}`}
                >
                  {inner}
                </span>
              )
            })}
          </p>
        )
      })}
    </div>
  )
}

function withCues(text: string, from: number, to: number): ReactNode {
  const hits = findCues(text).filter((h) => h.start < to && h.end > from)
  if (!hits.length) return text.slice(from, to)
  const out: ReactNode[] = []
  let at = from
  for (const h of hits) {
    const a = Math.max(h.start, from)
    const b = Math.min(h.end, to)
    if (a > at) out.push(text.slice(at, a))
    out.push(
      <mark key={a} className={`cue is-${h.tag}`} title={h.why}>
        {text.slice(a, b)}
      </mark>,
    )
    at = b
  }
  if (at < to) out.push(text.slice(at, to))
  return out
}

/** Level 0: what the clicked phrase became. */
function SpanNote({ c, session }: { c: TrainerCase; session: Session }) {
  const k = session.openSpan
  if (k === null) return <p className="muted small">Click a highlighted phrase.</p>
  const s = c.spans[k]
  const tag = TAGS.find((t) => t.id === s.tag)!
  return (
    <div className="span-note" data-testid="span-note">
      <div>
        <span className={`tag-pill is-${s.tag}`}>{tag.label}</span> → {s.target.map((t) => `“${t}”`).join(', ')} <HelpQ card={tag.card} />
      </div>
      <p>{s.why}</p>
    </div>
  )
}

/** Level 1: the tag buttons for the clicked phrase and the feedback. Keys 1–8 tag it. */
function Tagging({ c, session }: { c: TrainerCase; session: Session }) {
  const k = session.openSpan
  const done = allTagged(session)
  const left = c.spans.filter((s, i) => !(session.tags[i] && tagFits(s, session.tags[i]))).length
  useEffect(() => {
    if (k === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      const t = TAGS[Number(e.key) - 1]
      if (t && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        useTrainer.getState().tag(k, t.id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [k])
  const s = k !== null ? c.spans[k] : undefined
  const tag = k !== null ? session.tags[k] : undefined
  return (
    <div className="tagging">
      <p className="small muted" data-testid="tag-left">
        {done ? 'Every phrase is tagged: the model is shown. Click a phrase to see its element.' : `${left} of ${c.spans.length} phrases left.`}
      </p>
      {s && (
        <>
          <div className="tag-buttons">
            {TAGS.map((t, i) => (
              <button key={t.id} className={`tag-btn is-${t.id}${tag === t.id ? ' is-picked' : ''}`} title={`${t.hint} (key ${i + 1})`} onClick={() => useTrainer.getState().tag(k!, t.id)} data-testid={`tag:${t.id}`}>
                <kbd>{i + 1}</kbd> {t.label}
              </button>
            ))}
          </div>
          {tag && (
            <div className={`span-note${tagFits(s, tag) ? '' : ' is-wrong'}`} data-testid="tag-feedback">
              {tagFits(s, tag) ? (
                <>
                  <strong>Right.</strong> {s.why}
                </>
              ) : (
                <>
                  <strong>Not quite.</strong> {TAGS.find((t) => t.id === tag)!.label} is {TAGS.find((t) => t.id === tag)!.hint}. Read the phrase again: what does it become?
                </>
              )}
            </div>
          )}
        </>
      )}
      {!done && (
        <button className="btn small-btn" onClick={() => useTrainer.getState().setPeek(!session.peek)} data-testid="peek">
          {session.peek ? <EyeOff size={14} /> : <Eye size={14} />} {session.peek ? 'Veil the model' : 'Peek at the model'}
        </button>
      )}
    </div>
  )
}

/** Levels 2–3: Check, the result and the hint ladder. */
function CheckBox({ c, session }: { c: TrainerCase; session: Session }) {
  const check = useTrainer((s) => s.check)
  const model = useEditor((s) => s.model)
  const stale = check && check.model !== model
  const h = session.hint
  const todo = check?.result.items.filter((i) => i.status === 'missing' || i.status === 'different') ?? []
  const extra = check?.result.items.filter((i) => i.status === 'extra') ?? []
  const ok = check?.result.items.filter((i) => i.status === 'ok') ?? []
  return (
    <div className="trainer-check">
      <div className="row">
        <button className="btn accent" onClick={() => useTrainer.getState().runCheck()} data-testid="trainer-check">
          <ListChecks size={15} /> Check
        </button>
        <button className="btn" onClick={() => useTrainer.getState().moreHint()} title="What to add next: what → where in the text → why → the answer" data-testid="next-hint">
          <Lightbulb size={15} /> {h && h.shown < h.hint.steps.length ? 'More of this hint' : 'Next hint'}
        </button>
      </div>
      {h && (
        <ol className="hint-ladder" data-testid="hint">
          {h.hint.steps.slice(0, h.shown).map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      {check && (
        <div className={`check-result${stale ? ' is-stale' : ''}`} data-testid="check-result">
          <div className="score">
            <div className="score-bar">
              <span style={{ width: `${check.result.score}%` }} />
            </div>
            <strong data-testid="score">{check.result.score} %</strong>
          </div>
          {stale && <p className="small muted">You changed the model since: press Check again.</p>}
          {!todo.length && !extra.length ? (
            <p className="check-clean">
              <CircleCheck size={15} className="is-ok" /> Same process as the reference.{' '}
              {check.errors + check.warnings ? `The model check still has ${check.errors + check.warnings} remark(s): see Check in the top bar.` : 'The model check is clean too.'}
            </p>
          ) : (
            <>
              <ResultList title={`Not there yet (${todo.length})`} items={todo} />
              {extra.length > 0 && <ResultList title={`Not in the reference (${extra.length})`} items={extra} />}
              {(check.errors > 0 || check.warnings > 0) && (
                <p className="small">
                  Model check: {check.errors} error(s), {check.warnings} warning(s).{' '}
                  <button className="link" onClick={() => useEditor.getState().setCheckOpen(true)}>
                    Show them
                  </button>
                </p>
              )}
            </>
          )}
          {ok.length > 0 && (
            <details>
              <summary className="small muted">Right so far ({ok.length})</summary>
              <ResultList items={ok} />
            </details>
          )}
        </div>
      )}
      {!check && <p className="small muted">{session.level === 2 ? 'Tip: start with the start and end events, then the gateways, then connect.' : 'Tip: pools and lanes first, then the happy path left to right, then the other branches.'}</p>}
      <p className="small muted">{c.title}: the comparison matches steps by name (other words are fine) and by place; layout does not matter.</p>
    </div>
  )
}

function ResultList({ title, items }: { title?: string; items: CompareItem[] }) {
  return (
    <>
      {title && <h3>{title}</h3>}
      <ul className="result-list">
        {items.map((i) => (
          <li key={i.key} className={`is-${i.status}`}>
            <button onClick={() => i.mine.length && useEditor.getState().select(i.mine)} disabled={!i.mine.length} data-testid={`item:${i.key}`}>
              {i.text}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Level 1: the model is veiled until every phrase is tagged (or Peek). */
export function TrainerVeil() {
  const session = useTrainer((s) => s.session)
  if (!session || session.level !== 1 || session.peek || allTagged(session)) return null
  return (
    <div className="trainer-veil" data-testid="veil">
      <p>Tag every phrase of the text first: then the finished model shows here.</p>
      <button className="btn" onClick={() => useTrainer.getState().setPeek(true)}>
        <Eye size={14} /> Peek
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- a lesson

function LessonView({ lesson }: { lesson: Lesson }) {
  const answers = useTrainer((s) => s.lesson?.answers ?? NONE)
  const guessed = 0 in answers
  const right = lesson.test.filter((q, i) => answers[i + 1] === q.answer).length
  const finished = lesson.test.every((_, i) => i + 1 in answers)
  return (
    <article className="lesson" data-testid="lesson">
      <h2>{lesson.title}</h2>
      <p className="muted">{lesson.goal}</p>
      <h3>Guess first</h3>
      <Ask q={lesson.guess} index={0} answers={answers} />
      {guessed && (
        <>
          <h3>The idea</h3>
          {lesson.gist.map((g) => (
            <p key={g}>{md(g)}</p>
          ))}
          <div className="help-mistake">
            <strong>Trap.</strong> {lesson.trap}
          </div>
          <div className="help-chips">
            {lesson.cards.map((id) => (
              <button key={id} className="chip" onClick={() => useEditor.getState().openHelp(id)}>
                {id.replace(/-/g, ' ')}
              </button>
            ))}
          </div>
          <h3>Test yourself</h3>
          {lesson.test.map((q, i) => (
            <Ask key={q.q} q={q} index={i + 1} answers={answers} />
          ))}
          {finished && (
            <p className="check-clean" data-testid="lesson-score">
              {right} of {lesson.test.length} right.
            </p>
          )}
          {lesson.practice && (
            <button className="btn accent" onClick={() => useTrainer.getState().start(lesson.practice!.caseId, lesson.practice!.level)} data-testid="lesson-practice">
              <Play size={14} /> Practice: {caseById(lesson.practice.caseId)?.title}, level {lesson.practice.level}
            </button>
          )}
        </>
      )}
    </article>
  )
}

const NONE: Record<number, number> = {}

function Ask({ q, index, answers }: { q: Question; index: number; answers: Record<number, number> }) {
  const picked = answers[index]
  const done = picked !== undefined
  return (
    <div className="ask" data-testid={`ask:${index}`}>
      <p>{q.q}</p>
      <div className="ask-options">
        {q.options.map((o, i) => (
          <button key={o} disabled={done} className={done ? (i === q.answer ? 'is-right' : i === picked ? 'is-wrong' : '') : ''} onClick={() => useTrainer.getState().answer(index, i)}>
            {o}
          </button>
        ))}
      </div>
      {done && <p className="small">{picked === q.answer ? 'Right. ' : 'Not quite. '}{q.explain}</p>}
    </div>
  )
}

/** `**bold**` and `*italic*`. */
function md(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((t, i) =>
    t.startsWith('**') ? <strong key={i}>{t.slice(2, -2)}</strong> : t.startsWith('*') ? <em key={i}>{t.slice(1, -1)}</em> : t,
  )
}
