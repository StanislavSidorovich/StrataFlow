// "My task": the student's own text beside their own model. Select words in the text, then a tag (keys
// 1–8); the lists say what the model does not show yet, what no phrase mentions, and which cue words are
// not tagged. Saved in this browser; can be saved as a case file (for a group, or to train on later).
import { useEffect, useMemo, useState } from 'react'
import { CircleCheck, Download, Pencil } from 'lucide-react'
import { TAGS, type Tag } from '../../data/cases'
import { coverage, MY_TASK_CHECKLIST, myTaskToCaseFile, paragraphs } from '../../data/mytask'
import { useEditor } from '../store'
import { useTrainer } from './trainerStore'

interface Picked {
  p: number
  start: number
  end: number
  text: string
}

export function MyTaskView() {
  const task = useTrainer((s) => s.task)
  const model = useEditor((s) => s.model)
  const [editing, setEditing] = useState(!task.text.trim())
  const [draft, setDraft] = useState({ title: task.title, text: task.text })
  const [picked, setPicked] = useState<Picked | null>(null)
  const ps = useMemo(() => paragraphs(task.text), [task.text])
  const cov = useMemo(() => coverage(task, model), [task, model])

  const tag = (t: Tag) => {
    if (!picked) return
    useTrainer.getState().markTask({ ...picked, tag: t })
    setPicked(null)
    window.getSelection()?.removeAllRanges()
  }

  useEffect(() => {
    if (!picked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      const t = TAGS[Number(e.key) - 1]
      if (t && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        tag(t.id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  /** The selected words as paragraph offsets (trimmed to whole words). */
  const onSelect = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return setPicked(null)
    const r = sel.getRangeAt(0)
    const para = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest('[data-p]') as HTMLElement | null
    const a = para(r.startContainer)
    if (!a || a !== para(r.endContainer)) return setPicked(null)
    const offset = (node: Node, at: number) => {
      const pre = document.createRange()
      pre.setStart(a, 0)
      pre.setEnd(node, at)
      return pre.toString().length
    }
    const p = Number(a.dataset.p)
    const text = ps[p]
    let start = offset(r.startContainer, r.startOffset)
    let end = offset(r.endContainer, r.endOffset)
    while (start < end && /\s/.test(text[start])) start++
    while (end > start && /[\s.,;:]/.test(text[end - 1])) end--
    if (end <= start) return setPicked(null)
    setPicked({ p, start, end, text: text.slice(start, end) })
  }

  const download = () => {
    const { text, left } = myTaskToCaseFile(task, model)
    const blob = new Blob([text], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(task.title || 'my-task').replace(/[^\w-]+/g, '-').toLowerCase()}.flow-case.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    useEditor.getState().say(`Saved the case file with your model as the reference${left ? ` (${left} tagged phrase(s) name nothing in the model yet and were left out)` : ''}. File → Open adds it to the trainer.`)
  }

  if (editing)
    return (
      <div className="my-task" data-testid="my-task-edit">
        <h2>My task</h2>
        <p className="small muted">Paste the text of your task. It stays in this browser and is not sent anywhere.</p>
        <label className="field">
          <span>Title</span>
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Purchase order approval" />
        </label>
        <label className="field">
          <span>Text</span>
          <textarea rows={12} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="When a request comes in, the clerk checks…" data-testid="my-task-text" />
        </label>
        <button
          className="btn accent"
          disabled={!draft.text.trim()}
          onClick={() => {
            useTrainer.getState().setTaskText(draft.title.trim(), draft.text)
            setEditing(false)
          }}
          data-testid="my-task-done"
        >
          <CircleCheck size={14} /> Done: tag it
        </button>
      </div>
    )

  return (
    <div className="my-task" data-testid="my-task">
      <div className="trainer-case-head">
        <h2>{task.title || 'My task'}</h2>
        <button className="btn icon" onClick={() => (setDraft({ title: task.title, text: task.text }), setEditing(true))} title="Edit the text (tags whose words stay are kept)" aria-label="Edit the text">
          <Pencil size={14} />
        </button>
      </div>
      <p className="task-line">Select words of the text, then pick what they become (keys 1–8). Click a tag to remove it. Draw the model on the canvas as usual.</p>
      <div className="case-text" onMouseUp={onSelect} onKeyUp={onSelect} data-testid="my-task-paragraphs">
        {ps.map((text, p) => {
          const marks = task.marks.map((m, i) => ({ ...m, i })).filter((m) => m.p === p)
          const parts: React.ReactNode[] = []
          let at = 0
          for (const m of marks) {
            if (m.start > at) parts.push(text.slice(at, m.start))
            parts.push(
              <span key={m.i} role="button" tabIndex={0} className={`span is-${m.tag} is-right`} title={`${TAGS.find((t) => t.id === m.tag)!.label}: click to remove`} onClick={() => useTrainer.getState().unmarkTask(m.i)} data-testid={`mark:${m.i}`}>
                {text.slice(m.start, m.end)}
              </span>,
            )
            at = m.end
          }
          if (at < text.length) parts.push(text.slice(at))
          return (
            <p key={p} data-p={p}>
              {parts}
            </p>
          )
        })}
      </div>
      {picked && (
        <div className="tag-buttons" data-testid="my-task-tags">
          <p className="small">“{picked.text}” is:</p>
          {TAGS.map((t, i) => (
            <button key={t.id} className={`tag-btn is-${t.id}`} title={`${t.hint} (key ${i + 1})`} onMouseDown={(e) => e.preventDefault()} onClick={() => tag(t.id)} data-testid={`my-tag:${t.id}`}>
              <kbd>{i + 1}</kbd> {t.label}
            </button>
          ))}
        </div>
      )}
      <h3>Not in your model yet ({cov.missing.length})</h3>
      {task.marks.length === 0 ? (
        <p className="small muted">Tag the phrases first.</p>
      ) : cov.missing.length ? (
        <ul className="result-list" data-testid="my-task-missing">
          {cov.missing.map(({ mark, why }) => (
            <li key={`${mark.p}:${mark.start}`} className="is-missing">
              <button disabled>
                “{mark.text}” ({TAGS.find((t) => t.id === mark.tag)!.label}): {why}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="check-clean small">
          <CircleCheck size={14} className="is-ok" /> Every tagged phrase is in the model.
        </p>
      )}
      {cov.unmentioned.length > 0 && (
        <details open={cov.unmentioned.length <= 6}>
          <summary className="small">In the model, but no tagged phrase names it ({cov.unmentioned.length})</summary>
          <ul className="result-list" data-testid="my-task-unmentioned">
            {cov.unmentioned.map((u) => (
              <li key={u.id} className="is-extra">
                <button onClick={() => useEditor.getState().select([u.id])}>
                  {u.what} “{u.name}”: is it in the text? Then tag it; if not, does the model need it?
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {cov.questions.length > 0 && (
        <details>
          <summary className="small">Cue words not tagged yet ({cov.questions.length})</summary>
          <ul className="small cue-questions">
            {cov.questions.slice(0, 30).map((q) => (
              <li key={`${q.p}:${q.start}`}>
                <mark className="cue">{q.text}</mark>: {q.why}?
              </li>
            ))}
          </ul>
        </details>
      )}
      <h3>Ask yourself</h3>
      <ul className="decisions">
        {MY_TASK_CHECKLIST.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
      <button className="btn" onClick={download} disabled={!task.marks.length} title="Your text, its tags and your model as a .flow-case.json: open it later (or in a classmate's browser) as a trainer case" data-testid="my-task-save">
        <Download size={14} /> Save as case file
      </button>
    </div>
  )
}
