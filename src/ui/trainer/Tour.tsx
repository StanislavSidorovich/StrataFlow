// The welcome tour: a few cards pointing at the parts of the app. Opens once on the first visit; Help →
// Tour and the trainer's "Tour of the app" open it again.
import { useEffect, useLayoutEffect, useState } from 'react'
import { create } from 'zustand'

const SEEN_KEY = 'strataflow.tour.seen'

interface Step {
  /** CSS selector of the element the card points at (none = centred). */
  target?: string
  title: string
  text: string
}

export const TOUR: Step[] = [
  { title: 'Welcome to StrataFlow', text: 'Draw BPMN processes the way the course does, check them, and practise turning a text into a process. Six short stops.' },
  { target: '[data-testid="palette"]', title: 'Draw', text: 'Pick a shape (or press its key) and click the canvas. Drag from a shape\'s dot to connect; the kind of line is chosen for you. Right-click a shape for more.' },
  { target: '[data-testid="file-menu"]', title: 'Your files', text: 'Your process is kept in this browser. Save writes a .flow.json file; Export BPMN makes a file Bizagi Modeler and bpmn.io open; Open reads both, Bizagi exports included.' },
  { target: '[data-testid="check"]', title: 'Check', text: 'The model check asks questions about your model (course rules P01–P18): unreachable steps, splits without a matching join, names. A question, not a verdict.' },
  { target: '[data-testid="trainer"]', title: 'Trainer', text: 'Cases from easy to hard: a worked example, tagging the text, completing a process, then your own. Lessons explain one idea each.' },
  { target: '[data-testid="help-menu"]', title: 'Help', text: 'Help cards explain every element and rule with a small model. F1 opens them; a "?" next to a field opens its card.' },
]

const useTour = create<{ step: number | null }>(() => ({ step: null }))

export function startTour() {
  useTour.setState({ step: 0 })
}

function end() {
  useTour.setState({ step: null })
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // shown again next time
  }
}

/** Opens the tour on the first visit only. */
export function tourOnFirstVisit() {
  try {
    if (!localStorage.getItem(SEEN_KEY)) startTour()
  } catch {
    // no storage: no automatic tour
  }
}

export function Tour() {
  const step = useTour((s) => s.step)
  const [box, setBox] = useState<DOMRect | null>(null)
  const s = step === null ? undefined : TOUR[step]
  useLayoutEffect(() => {
    const el = s?.target ? document.querySelector(s.target) : null
    setBox(el ? el.getBoundingClientRect() : null)
  }, [s])
  useEffect(() => {
    if (step === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') useTour.setState({ step: Math.max(0, step - 1) })
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [step])
  if (!s || step === null) return null
  const next = () => (step + 1 < TOUR.length ? useTour.setState({ step: step + 1 }) : end())
  // The card goes under the target (or above it near the bottom), kept inside the window.
  const W = 300
  const style: React.CSSProperties = box
    ? box.height > 200 // a tall bar (the draw bar): the card goes to its right
      ? { left: box.right + 12, top: Math.max(8, box.top + 8) }
      : {
        left: Math.min(Math.max(8, box.left + box.width / 2 - W / 2), window.innerWidth - W - 8),
        top: box.bottom + 160 < window.innerHeight ? box.bottom + 10 : Math.max(8, box.top - 170),
      }
    : { left: '50%', top: '35%', transform: 'translateX(-50%)' }
  return (
    <div className="tour" role="dialog" aria-label="Tour" data-testid="tour">
      {box && <div className="tour-ring" style={{ left: box.left - 4, top: box.top - 4, width: box.width + 8, height: box.height + 8 }} />}
      <div className="tour-card" style={{ ...style, width: W }}>
        <div className="small muted">
          {step + 1} / {TOUR.length}
        </div>
        <strong>{s.title}</strong>
        <p>{s.text}</p>
        <div className="row">
          <button className="btn" onClick={end} data-testid="tour-skip">
            {step + 1 < TOUR.length ? 'Skip' : 'Close'}
          </button>
          {step > 0 && (
            <button className="btn" onClick={() => useTour.setState({ step: step - 1 })}>
              Back
            </button>
          )}
          <button className="btn accent" onClick={next} data-testid="tour-next" autoFocus>
            {step + 1 < TOUR.length ? 'Next' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
