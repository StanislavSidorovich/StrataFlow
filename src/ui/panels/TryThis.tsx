// The "Try this" box of the Run tab, shown while the Kaiyo example is open (design §5.3). Each question has a button
// that sets up the level or the what-if scenario (the student still presses Run / Run both) and an answer to open
// after the guess.
import { X } from 'lucide-react'
import type { FlowModel } from '../../core/metamodel'
import { useRun } from '../simRun'
import { useWhatIf } from '../whatIf'
import { TRY_QUESTIONS, useTry, type TryQuestion } from './tryQuestions'
import './tryThis.css'

function setUp(q: TryQuestion, model: FlowModel) {
  useRun.setState({ level: 3 })
  const wi = useWhatIf.getState()
  if (q.id === 'peak') {
    wi.clearScenario()
    wi.setName('Peak season')
    wi.addChange({ kind: 'arrivals', factor: 1.5 })
  } else if (q.id === 'second') {
    const lane = model.lanes.find((l) => l.name === 'Warehouse')
    if (!lane) return
    wi.clearScenario()
    wi.setName('Second packer')
    wi.addChange({ kind: 'capacity', id: lane.id, value: 2 })
  }
}

export function TryThis({ model }: { model: FlowModel }) {
  const dismissed = useTry((s) => s.dismissed)
  const running = useRun((s) => s.running)
  if (dismissed) return null
  const hasWarehouse = model.lanes.some((l) => l.name === 'Warehouse')
  return (
    <section className="try-this" aria-label="Try this" data-testid="try-this">
      <div className="try-head">
        <strong>Try this</strong>
        <span className="muted">three questions on the Kaiyo example</span>
        <button className="btn icon" onClick={() => useTry.getState().dismiss()} aria-label="Dismiss the questions" title="Hide these questions (the simulation lesson, or the Kaiyo chip on a Help card, brings them back)" data-testid="try-dismiss">
          <X size={12} />
        </button>
      </div>
      <ol>
        {TRY_QUESTIONS.map((q) => (
          <li key={q.id} data-testid={`try:${q.id}`}>
            <p>
              <strong>{q.title}.</strong> {q.text}
            </p>
            <button className="btn" onClick={() => setUp(q, model)} disabled={running || (q.id === 'second' && !hasWarehouse)} data-testid={`try-setup:${q.id}`}>
              {q.action}
            </button>
            <details>
              <summary>Answer</summary>
              <p className="muted">{q.answer}</p>
            </details>
          </li>
        ))}
      </ol>
    </section>
  )
}
