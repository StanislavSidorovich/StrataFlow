// Present mode (SPEC §10.1): the story in place of the editor. Left: the beats as a table of contents and the
// controls; middle: the canvas with the comment card, the whole task text under it with the beat's quote
// highlighted. Present = full screen, only the diagram, the text and a quiet bar; ← → / Space, Home / End, Esc.
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { ArrowLeft, ArrowRight, CircleCheck, CircleX, Maximize2, Share2, X } from 'lucide-react'
import { locateQuotes, quotesOf, textsOf, type QuoteSpan, type Story } from '../../core/story'
import { shareNow } from '../share'
import { StoryCanvas } from './StoryCanvas'
import { useShown, useStory } from './storyStore'

/** `**bold**`, `*italic*` and `code`. */
function rich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((t, i) =>
    t.startsWith('**') ? <strong key={i}>{t.slice(2, -2)}</strong> : t.startsWith('`') ? <code key={i}>{t.slice(1, -1)}</code> : t.startsWith('*') && t.length > 2 ? <em key={i}>{t.slice(1, -1)}</em> : t,
  )
}

/** ← → (also Space, PageUp/PageDown), Home / End; Esc leaves full screen. */
function useStoryKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return
      const { beat, frames, goTo, presenting, setPresenting } = useStory.getState()
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) goTo(beat + 1)
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) goTo(beat - 1)
      else if (e.key === 'Home') goTo(0)
      else if (e.key === 'End') goTo(frames.length - 1)
      else if (e.key === 'Escape' && presenting) setPresenting(false)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // The browser's own Esc leaves full screen: presenting ends with it.
    const onFull = () => {
      if (!document.fullscreenElement && useStory.getState().presenting) useStory.setState({ presenting: false })
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('fullscreenchange', onFull)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('fullscreenchange', onFull)
    }
  }, [])
}

export function StoryView() {
  const story = useStory((s) => s.story)
  const presenting = useStory((s) => s.presenting)
  const { canvas, frame } = useShown()
  useStoryKeys()
  if (!story || !canvas || !frame) return null
  return (
    <div className={`story-root${presenting ? ' is-presenting' : ''}`} data-testid="story">
      {!presenting && <StoryPane />}
      <div className="story-main">
        <div className="story-stage">
          <ReactFlowProvider>
            <div className="canvas-wrap story-canvas" data-testid="story-canvas">
              <StoryCanvas frame={canvas} />
            </div>
          </ReactFlowProvider>
          <StoryCard />
        </div>
        {story.text && <StoryText story={story} at={canvas.index} />}
        {presenting && <PresenterBar />}
      </div>
    </div>
  )
}

function StoryCard() {
  const { frame, asking } = useShown()
  const beat = useStory((s) => s.beat)
  const total = useStory((s) => s.frames.length)
  const answered = useStory((s) => s.answered)
  const story = useStory((s) => s.story)
  const presenting = useStory((s) => s.presenting)
  if (!frame || !story) return null
  const q = frame.question
  // With a task text the quote is lit in it; a quote the text does not hold is shown on its own.
  const located = locateQuotes(story)[frame.index] ?? []
  const quotes = quotesOf(frame.beat).filter((_, k) => !story.text || !located[k])
  const grade = q && answered !== null ? (answered === q.right ? 'right' : 'wrong') : null
  return (
    <div key={`${beat}:${asking}`} className={`story-card${presenting ? ' is-presenting' : ''}`} role="status" aria-live="polite" data-testid="story-card">
      <div className="story-card-step">
        {beat + 1} / {total}
        {asking ? ' · question' : ''}
      </div>
      {asking && q ? (
        <div className="ask" data-testid="story-question">
          <h3>{q.prompt}</h3>
          <div className="ask-options">
            {q.options.map((o, i) => (
              <button key={o} className="btn" onClick={() => useStory.getState().answer(i)} data-testid={`story-option:${i}`}>
                {o}
              </button>
            ))}
          </div>
          <button className="link small" onClick={() => useStory.getState().answer(-1)} data-testid="story-skip">
            I do not know, show me
          </button>
        </div>
      ) : (
        <>
          <h3 data-testid="story-title">{frame.beat.title}</h3>
          {grade && (
            <p className={`small walk-answer ${grade === 'right' ? 'is-right' : 'is-wrong'}`} data-testid="story-feedback">
              {grade === 'right' ? <CircleCheck size={14} /> : <CircleX size={14} />} {answered === -1 ? 'Here it is. ' : grade === 'right' ? 'Right. ' : `Not quite: ${q!.options[q!.right]}. `}
              {q!.why}
            </p>
          )}
          {quotes.map((t) => (
            <blockquote key={t}>“{t}”</blockquote>
          ))}
          {textsOf(frame.beat).map((t, k) => (
            <p key={k}>{rich(t)}</p>
          ))}
        </>
      )}
    </div>
  )
}

/** The whole task text; this beat's quote lit, earlier ones faded, later ones plain. */
function StoryText({ story, at }: { story: Story; at: number }) {
  const spans = useMemo(() => locateQuotes(story), [story])
  const now = useRef<HTMLElement>(null)
  useEffect(() => {
    now.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [at])
  const marks: (QuoteSpan & { kind: 'now' | 'past' })[] = []
  spans.forEach((list, i) => {
    if (i > at) return
    for (const s of list) if (s) marks.push({ ...s, kind: i === at ? 'now' : 'past' })
  })
  return (
    <div className="story-text" data-testid="story-text">
      {(story.text ?? []).map((par, p) => {
        const mine = marks.filter((m) => m.p === p).sort((a, b) => a.from - b.from)
        const out: ReactNode[] = []
        let pos = 0
        for (const m of mine) {
          if (m.from < pos) continue
          if (m.from > pos) out.push(par.slice(pos, m.from))
          out.push(
            <mark key={`${m.from}:${m.kind}`} className={m.kind === 'now' ? 'is-now' : 'is-past'} ref={m.kind === 'now' ? now : undefined}>
              {par.slice(m.from, m.to)}
            </mark>,
          )
          pos = m.to
        }
        out.push(par.slice(pos))
        return <p key={p}>{out}</p>
      })}
    </div>
  )
}

function StoryPane() {
  const story = useStory((s) => s.story)!
  const frames = useStory((s) => s.frames)
  const beat = useStory((s) => s.beat)
  const ask = useStory((s) => s.ask)
  const { goTo, setPresenting, setAsk, exit } = useStory.getState()
  const last = frames.length - 1
  return (
    <aside className="story-pane" aria-label="Story" data-testid="story-pane">
      <div className="story-pane-head">
        <h2>{story.title}</h2>
        <button type="button" className="btn" onClick={exit} title="Close the story and go back to the editor" data-testid="story-exit">
          <X size={14} /> Close
        </button>
      </div>
      <div className="story-progress" aria-hidden>
        <div style={{ width: `${(100 * (beat + 1)) / frames.length}%` }} />
      </div>
      <div className="walk-nav">
        <button className="btn" onClick={() => goTo(beat - 1)} disabled={beat === 0} title="Previous beat (←)" data-testid="story-back">
          <ArrowLeft size={14} /> Back
        </button>
        <button className="btn accent" onClick={() => goTo(beat + 1)} disabled={beat === last} title="Next beat (→ or Space)" data-testid="story-next">
          Next <ArrowRight size={14} />
        </button>
        <button className="btn" onClick={() => setPresenting(true)} title="Full screen: only the diagram, the text and a quiet bar (Esc to leave)" data-testid="story-present">
          <Maximize2 size={14} /> Present
        </button>
        <button className="btn" onClick={() => void shareNow(false)} title="Save one .flow.html file to send: opening it lands in Quaera Flow on this story. Nothing is uploaded" data-testid="story-share">
          <Share2 size={14} /> Share
        </button>
        <button className="btn" onClick={() => void shareNow(true)} title="Copy the link instead (long; a file is tidier in a chat)" data-testid="story-share-link">
          Copy link
        </button>
      </div>
      <label className="small story-ask">
        <input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} data-testid="story-ask" /> Ask me first (predict, then see)
      </label>
      <ol className="story-beats">
        {frames.map((f, k) => (
          <li key={k}>
            <button type="button" className={k === beat ? 'is-now' : k < beat ? 'is-past' : ''} onClick={() => goTo(k)} aria-current={k === beat ? 'step' : undefined}>
              <span className="story-beat-n">{k + 1}</span>
              <span>{f.beat.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="muted small">Keys: ← → or Space, Home / End. Present hides everything but the diagram; questions are not asked there.</p>
    </aside>
  )
}

/** While presenting: a quiet bar at the bottom. */
function PresenterBar() {
  const beat = useStory((s) => s.beat)
  const total = useStory((s) => s.frames.length)
  const { goTo, setPresenting } = useStory.getState()
  return (
    <>
      <div className="story-presenter-progress" aria-hidden>
        <div style={{ width: `${(100 * (beat + 1)) / total}%` }} />
      </div>
      <div className="story-presenter-bar" role="toolbar" aria-label="Story">
        <button type="button" onClick={() => goTo(beat - 1)} disabled={beat === 0} aria-label="Previous beat" data-testid="present-back">
          ‹
        </button>
        <span data-testid="present-count">
          {beat + 1} / {total}
        </span>
        <button type="button" onClick={() => goTo(beat + 1)} disabled={beat === total - 1} aria-label="Next beat" data-testid="present-next">
          ›
        </button>
        <button type="button" onClick={() => setPresenting(false)} title="Leave presenting (Esc)" aria-label="Leave presenting">
          ✕
        </button>
      </div>
    </>
  )
}
