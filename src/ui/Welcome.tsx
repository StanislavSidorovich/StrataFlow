// The welcome card (docs/design.md "First screen"): what StrataFlow is in one line, then "what do you want
// to do?" in one click: new to BPMN (a lesson, a process built step by step) or already modelling (a case,
// a Bizagi file, drawing). Not a feature list: the tour and the help cards explain the interface. Shown at
// start until it is closed with "Show at start" unticked (as it is the first time); Help → Welcome opens
// it again. A trainer task in progress comes first, as Continue.
import { useEffect } from 'react'
import { create } from 'zustand'
import { BookOpen, Clapperboard, FilePlus2, FolderOpen, GraduationCap, MousePointer2, Play, X } from 'lucide-react'
import { AuthorLinks } from './AuthorLinks'
import { caseById, CASES } from '../data/cases'
import { LESSONS } from '../data/lessons'
import { LEVELS } from '../data/trainer'
import { newProcess } from './docs'
import { FEEDBACK_URL } from './links'
import { startTour } from './trainer/Tour'
import { useTrainer } from './trainer/trainerStore'

// '1' = show at start, '0' = not; no value = never answered, so shown once with the box unticked.
const AT_START_KEY = 'strataflow.welcome.atStart'

const stored = () => {
  try {
    return localStorage.getItem(AT_START_KEY)
  } catch {
    return '0'
  }
}

type Welcome = { open: boolean; atStart: boolean }

export const useWelcome = create<Welcome>(() => ({ open: false, atStart: stored() === '1' }))

export const openWelcome = () => useWelcome.setState({ open: true })

/** At start: the card, unless it was answered with the box unticked. */
export function welcomeAtStart() {
  if (stored() !== '0') openWelcome()
}

/** Any way out counts as an answer: the box decides whether the card comes back at start. */
function close() {
  try {
    localStorage.setItem(AT_START_KEY, useWelcome.getState().atStart ? '1' : '0')
  } catch {
    // shown again next time
  }
  useWelcome.setState({ open: false })
}

export function WelcomeCard({ onOpenFile }: { onOpenFile: () => void }) {
  const open = useWelcome((s) => s.open)
  const atStart = useWelcome((s) => s.atStart)
  const session = useTrainer((s) => s.session)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const go = (then: () => void) => () => {
    close()
    then()
  }

  const first = CASES[0]
  const current = session ? caseById(session.caseId) : undefined
  const level = session ? LEVELS.find((l) => l.level === session.level) : undefined

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onPointerDown={(e) => e.target === e.currentTarget && close()} data-testid="welcome">
      <div className="welcome-card">
        <button className="welcome-close" aria-label="Close" title="Close (Esc)" onClick={close} data-testid="welcome-close">
          <X size={16} />
        </button>
        <div className="welcome-head">
          <img src="./icon.svg" alt="" width={28} height={28} />
          <h2 id="welcome-title">Quaera Flow</h2>
        </div>
        <p className="welcome-lead">Learn BPMN by doing: from a text to a process, checked against the course rules.</p>

        {session && current && (
          <button className="welcome-choice is-continue" onClick={go(() => useTrainer.getState().setOpen(true))} data-testid="welcome-continue">
            <Play size={18} />
            <span>
              <strong>Continue: {current.title}</strong>
              <span className="muted">{level?.title ?? 'Trainer task'}, where you left it</span>
            </span>
          </button>
        )}

        <div className="welcome-cols">
          <section>
            <h3>New to BPMN</h3>
            <button className="welcome-choice" onClick={go(() => useTrainer.getState().openLesson(LESSONS[0].id))} data-testid="welcome-learn">
              <BookOpen size={18} />
              <span>
                <strong>Learn the basics</strong>
                <span className="muted">{LESSONS.length} short lessons, one idea each</span>
              </span>
            </button>
            <button className="welcome-choice" onClick={go(() => useTrainer.getState().start(first.id, 0, { walk: true }))} data-testid="welcome-watch">
              <Clapperboard size={18} />
              <span>
                <strong>Watch a process built</strong>
                <span className="muted">{first.title.split(':')[0]}, step by step: guess what comes next</span>
              </span>
            </button>
          </section>
          <section>
            <h3>Already modelling</h3>
            <button className="welcome-choice" onClick={go(() => useTrainer.getState().setOpen(true))} data-testid="welcome-practise">
              <GraduationCap size={18} />
              <span>
                <strong>Practise with a case</strong>
                <span className="muted">{CASES.length} cases from easy to hard, checked against a reference</span>
              </span>
            </button>
            <button className="welcome-choice" onClick={go(onOpenFile)} data-testid="welcome-open">
              <FolderOpen size={18} />
              <span>
                <strong>Open a Bizagi file</strong>
                <span className="muted">A .bpmn export: check it, change it, export it back</span>
              </span>
            </button>
            <button className="welcome-choice" onClick={close} data-testid="welcome-draw">
              <MousePointer2 size={18} />
              <span>
                <strong>Start drawing</strong>
                <span className="muted">On the process that is open now</span>
              </span>
            </button>
            <button className="welcome-link" onClick={go(() => void newProcess())} data-testid="welcome-empty">
              <FilePlus2 size={13} /> or on an empty canvas
            </button>
          </section>
        </div>

        <p className="welcome-small">
          Free, unofficial student tool. Works offline; files open in Bizagi Modeler. Course deliverables are still made in Bizagi.
        </p>
        <AuthorLinks />
        <div className="welcome-foot">
          <label>
            <input type="checkbox" checked={atStart} onChange={(e) => useWelcome.setState({ atStart: e.target.checked })} data-testid="welcome-at-start" /> Show at start
          </label>
          <button className="btn" onClick={go(startTour)} data-testid="welcome-tour">
            Take the 1-minute tour
          </button>
          <a href="https://model.quaera.app" target="_blank" rel="noopener" className="muted">
            Sister app: Quaera Model (data models)
          </a>
          {FEEDBACK_URL && (
            <a href={FEEDBACK_URL} target="_blank" rel="noopener" className="muted" data-testid="welcome-feedback">
              Send feedback
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
