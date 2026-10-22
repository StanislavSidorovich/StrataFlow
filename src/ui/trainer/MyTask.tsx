// "My task": the student's own text beside their own model. Select words in the text, then a tag (keys
// 1–8); the lists say what the model does not show yet, what no phrase mentions, and which cue words are
// not tagged. Saved in this browser; can be saved as a case file (for a group, or to train on later).
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, Download, Pencil, Upload } from 'lucide-react'
import { TAGS, type Tag } from '../../data/cases'
import { compareTagging, coverage, MY_TASK_CHECKLIST, myTaskToCaseFile, paragraphs, textCues, untaggedCues, type PCue } from '../../data/mytask'
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
  const [picked, setPicked] = useState<Picked | null>(null)
  const [hints, setHints] = useState(false)
  const [compared, setCompared] = useState(false)
  const [showAll, setShowAll] = useState(false)
  /** The phrase a question points at, shown in the text until it is tagged. */
  const [focus, setFocus] = useState<{ p: number; start: number; end: number } | null>(null)
  const ps = useMemo(() => paragraphs(task.text), [task.text])
  const cues = useMemo(() => textCues(ps), [ps])
  // Recomputed as the student tags, so an answered question goes away.
  const questions = useMemo(() => (compared ? compareTagging(task.marks, cues) : []), [compared, task.marks, cues])
  const dotted = useMemo(() => (hints ? untaggedCues(cues, task.marks) : []), [hints, cues, task.marks])
  const cov = useMemo(() => coverage(task, model), [task, model])

  const tag = (t: Tag) => {
    if (!picked) return
    useTrainer.getState().markTask({ ...picked, tag: t })
    setPicked(null)
    setFocus(null)
    window.getSelection()?.removeAllRanges()
  }

  useEffect(() => {
    if (!picked) setFocus(null)
  }, [picked])

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

  /** Opens tagging on a cue's phrase (or on the student's tag there), as if the student had selected it. */
  const openCue = (c: PCue, mark?: Picked) => {
    const r = mark ?? { p: c.p, start: c.start, end: c.end, text: c.text }
    setPicked(r)
    setFocus({ p: r.p, start: r.start, end: r.end })
    document.querySelector(`[data-p="${c.p}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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

  if (!task.text.trim())
    return (
      <div className="my-task" data-testid="my-task-empty">
        <h2>My task</h2>
        <p className="small muted">Paste or write the text of your task, or load a .txt / .md file. It stays in this browser and is not sent anywhere.</p>
        <button className="btn accent" onClick={() => setEditing(true)} data-testid="my-task-add">
          <Pencil size={14} /> Add my text…
        </button>
        {editing && <MyTaskDialog task={task} onClose={() => setEditing(false)} />}
      </div>
    )

  return (
    <div className="my-task" data-testid="my-task">
      <div className="trainer-case-head">
        <h2>{task.title || 'My task'}</h2>
        <button className="btn icon" onClick={() => setEditing(true)} title="Edit the text (tags whose words stay are kept)" aria-label="Edit the text" data-testid="my-task-edit">
          <Pencil size={14} />
        </button>
      </div>
      {editing && <MyTaskDialog task={task} onClose={() => setEditing(false)} />}
      <p className="task-line">Select words of the text, then pick what they become (keys 1–8). Click a tag to remove it. Draw the model on the canvas as usual.</p>
      <div className="case-text" onMouseUp={onSelect} onKeyUp={onSelect} data-testid="my-task-paragraphs">
        {ps.map((text, p) => {
          const marks = task.marks.map((m, i) => ({ ...m, i })).filter((m) => m.p === p)
          const here = dotted.filter((c) => c.p === p)
          // The focused phrase is shown even when it is neither a tag nor a hint.
          const f = focus && focus.p === p && !marks.some((m) => m.start < focus.end && m.end > focus.start) && !here.some((c) => c.start < focus.end && c.end > focus.start) ? focus : null
          type Item = { start: number; end: number; mark?: (typeof marks)[number]; cue?: PCue }
          const items: Item[] = [...marks.map((m) => ({ start: m.start, end: m.end, mark: m })), ...here.map((c) => ({ start: c.start, end: c.end, cue: c })), ...(f ? [{ start: f.start, end: f.end }] : [])].sort((a, b) => a.start - b.start)
          const parts: React.ReactNode[] = []
          let at = 0
          for (const it of items) {
            if (it.start > at) parts.push(text.slice(at, it.start))
            const word = text.slice(it.start, it.end)
            const isFocus = !!focus && focus.p === p && focus.start < it.end && focus.end > it.start
            if (it.mark) {
              const m = it.mark
              parts.push(
                <span key={`m${m.i}`} role="button" tabIndex={0} className={`span is-${m.tag} is-right${isFocus ? ' is-focus' : ''}`} title={`${TAGS.find((t) => t.id === m.tag)!.label}: click to remove`} onClick={() => useTrainer.getState().unmarkTask(m.i)} data-testid={`mark:${m.i}`}>
                  {word}
                </span>,
              )
            } else if (it.cue) {
              const c = it.cue
              parts.push(
                <span key={`h${c.start}`} role="button" tabIndex={0} className={`span is-hint is-${c.tag}${isFocus ? ' is-focus' : ''}`} title={`Hint (${TAGS.find((t) => t.id === c.tag)!.label}?): ${c.why}. Click to tag it.`} onClick={() => openCue(c)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openCue(c))} data-testid={`hint:${p}:${c.start}`}>
                  {word}
                </span>,
              )
            } else parts.push(<span key={`f${it.start}`} className="span is-focus">{word}</span>)
            at = it.end
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
      <div className="my-task-tools">
        <button className="btn" disabled={task.marks.length === 0} title={task.marks.length === 0 ? 'Tag some phrases yourself first' : 'Questions where the text and your tags differ'} onClick={() => (setCompared(true), setShowAll(false))} data-testid="my-task-compare">
          Compare my tagging
        </button>
        <label className="small" title="Dotted lines under cue words you have not tagged yet; the colour is the tag they suggest">
          <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} data-testid="my-task-hints" /> Show hints
        </label>
      </div>
      {compared && (
        <div className="my-task-questions" data-testid="my-task-questions">
          {questions.length === 0 ? (
            <p className="check-clean small">
              <CircleCheck size={14} className="is-ok" /> Your tags cover every cue word in the text.
            </p>
          ) : (
            <>
              <p className="small">{questions.length} question(s) about your tagging. Click one to see it in the text.</p>
              <ul className="small cue-questions">
                {(showAll ? questions : questions.slice(0, 8)).map((q) => (
                  <li key={`${q.cue.p}:${q.cue.start}`}>
                    <button className={`link-btn span is-hint is-${q.mark?.tag ?? q.cue.tag}`} onClick={() => openCue(q.cue, q.mark && { p: q.mark.p, start: q.mark.start, end: q.mark.end, text: q.mark.text })} title="Show it in the text, ready to tag" data-testid="my-task-question">
                      {q.mark?.text ?? q.cue.text}
                    </button>
                    : {q.text}
                  </li>
                ))}
              </ul>
              {questions.length > 8 && !showAll && (
                <button className="link-btn small" onClick={() => setShowAll(true)}>
                  Show all {questions.length}
                </button>
              )}
            </>
          )}
          <p className="small muted">The cues are simple word patterns, no AI, so a question can be wrong. Your judgement wins.</p>
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

/** The text of the task: write or paste it, or load a .txt / .md file. */
function MyTaskDialog({ task, onClose }: { task: { title: string; text: string }; onClose: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [text, setText] = useState(task.text)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const load = async (f: File) => {
    if (f.size > 200_000) return setError('This file is too large for a task text (over 200 KB).')
    setText(await f.text())
    if (!title.trim()) setTitle(f.name.replace(/\.(txt|md|markdown)$/i, ''))
    setError(null)
  }
  const save = () => {
    if (paragraphs(text).length === 0) return setError('Paste or type the task text first.')
    useTrainer.getState().setTaskText(title.trim(), text)
    onClose()
  }
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-label="My task" onPointerDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()} data-testid="my-task-dialog">
      <div className="welcome-card my-task-dialog">
        <h2>My task</h2>
        <p className="small muted">Paste the text of your task (homework, a project) or load a .txt / .md file. It stays in this browser and is not sent anywhere. There is no reference answer: you tag the phrases, Flow asks about the cue words it noticed.</p>
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Purchase order approval" data-testid="my-task-title" />
        </label>
        <label className="field">
          <span>Text</span>
          <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="When a request comes in, the clerk checks…" autoFocus data-testid="my-task-text" />
        </label>
        {error && <p className="small is-error">{error}</p>}
        <input ref={file} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden data-testid="my-task-file" onChange={(e) => (e.target.files?.[0] && void load(e.target.files[0]), (e.target.value = ''))} />
        <div className="my-task-dialog-foot">
          <button className="btn" onClick={() => file.current?.click()}>
            <Upload size={14} /> Load .txt / .md…
          </button>
          <span>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>{' '}
            <button className="btn accent" disabled={!text.trim()} onClick={save} data-testid="my-task-done">
              <CircleCheck size={14} /> Save: tag it
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
