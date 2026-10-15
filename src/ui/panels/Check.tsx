// The Check panel under the canvas: what the model check (core/lint) finds. A click on an issue opens the
// page it is on, selects its elements and brings them into view; "?" opens the help card.
import { useReactFlow } from '@xyflow/react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type { FlowModel } from '../../core/metamodel'
import { lintModel, RULES, summarize, type Issue, type Severity } from '../../core/lint'
import { nodeOf, pageOf } from '../../core/ops'
import { useEditor } from '../store'
import { HelpQ } from './Help'

let cache: { model: FlowModel | null; issues: Issue[] } = { model: null, issues: [] }

/** The issues of the current model, computed once per model version. */
export function useIssues(): Issue[] {
  const model = useEditor((s) => s.model)
  if (cache.model !== model) cache = { model, issues: lintModel(model) }
  return cache.issues
}

export const SEVERITY_ICON: Record<Severity, typeof CircleAlert> = { error: CircleAlert, warning: TriangleAlert, info: Info }
const SEVERITY_WORD: Record<Severity, [string, string]> = { error: ['error', 'errors'], warning: ['warning', 'warnings'], info: ['hint', 'hints'] }

/** "1 error · 2 warnings" (or "No issues"), for the status bar. */
export function issueSummary(issues: Issue[]): string {
  const c = summarize(issues)
  const parts = (['error', 'warning', 'info'] as Severity[]).filter((s) => c[s]).map((s) => `${c[s]} ${SEVERITY_WORD[s][c[s] === 1 ? 0 : 1]}`)
  return parts.length ? parts.join(' · ') : 'No issues'
}

export function CheckPanel() {
  const issues = useIssues()
  const flow = useReactFlow()
  const show = (i: Issue) => {
    const s = useEditor.getState()
    const m = s.model
    // A flow's ends tell where it is drawn.
    const first = i.elements.map((id) => nodeOf(m, id)?.id ?? m.flows.find((f) => f.id === id)?.source).find(Boolean)
    const page = first ? (pageOf(m, first) ?? null) : null
    if (page !== s.page) s.openPage(page)
    s.select(i.elements)
    const nodes = i.elements.filter((id) => nodeOf(m, id) || m.participants.some((p) => p.id === id) || m.lanes.some((l) => l.id === id))
    if (nodes.length) requestAnimationFrame(() => void flow.fitView({ nodes: nodes.map((id) => ({ id })), maxZoom: 1.2, padding: 0.4, duration: 300 }))
  }
  return (
    <section className="check-panel" aria-label="Model check" data-testid="check-panel">
      <header>
        <strong>Check</strong>
        <span className="muted">{issueSummary(issues)}. A warning is a question, not a verdict: you decide.</span>
        <button className="btn icon" onClick={() => useEditor.getState().setCheckOpen(false)} aria-label="Close the check" title="Close">
          <X size={14} />
        </button>
      </header>
      {issues.length === 0 ? (
        <p className="check-clean">
          <CircleCheck size={16} /> Every step is reachable, every path ends, splits match their joins, names read well.
        </p>
      ) : (
        <ul>
          {issues.map((i, k) => {
            const Icon = SEVERITY_ICON[i.severity]
            return (
              <li key={k} className={`is-${i.severity}`}>
                <button className="check-issue" onClick={() => show(i)} title={`${i.rule}: ${RULES[i.rule].title}. Click to show it.`} data-testid={`issue:${i.rule}`}>
                  <Icon size={14} />
                  <span className="check-rule">{i.rule}</span>
                  <span>{i.message}</span>
                </button>
                <HelpQ card={i.card} />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
