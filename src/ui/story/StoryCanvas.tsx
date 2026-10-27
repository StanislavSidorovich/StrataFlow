// The canvas of a story: the frame's model drawn read-only with the editor's own shapes, the beat's new shapes
// popping in, then their flows drawn, everything else dimmed; the camera moves to each beat; a token walks.
import { useEffect, useMemo, useState } from 'react'
import { Background, ConnectionMode, ReactFlow, useReactFlow, useStore, type Node } from '@xyflow/react'
import type { StoryFrame } from '../../core/story'
import { EdgeMarkers } from '../canvas/edges'
import { edgeTypes, nodeTypes, toEdges, toNodes } from '../canvas/Canvas'
import { useShown, useStory } from './storyStore'

/** Room kept on the right for the comment card. */
const cardRoom = (width: number) => (width < 700 ? 0 : Math.min(420, Math.max(300, width * 0.32)))

function StoryGhost({ data }: { data: { name: string; kind?: string } }) {
  return (
    <div className="story-ghost" title="Asked for by the task, not in the model yet">
      {data.kind && <small>{data.kind}</small>}
      <span>{data.name}</span>
    </div>
  )
}
const types = { ...nodeTypes, storyGhost: StoryGhost }

export function StoryCanvas({ frame }: { frame: StoryFrame }) {
  const model = frame.model
  const asking = useShown().asking
  // The token walks one step at a time along the beat's path.
  const [tokenAt, setTokenAt] = useState(-1)
  useEffect(() => {
    setTokenAt(-1)
    if (asking || !frame.token.length) return
    let k = 0
    setTokenAt(0)
    const t = setInterval(() => {
      k += 1
      setTokenAt(k)
      if (k >= frame.token.length - 1) clearInterval(t)
    }, 900)
    return () => clearInterval(t)
  }, [frame, asking])

  const lit = useMemo(() => new Set([...frame.current, ...(frame.focus ? [frame.focus] : []), ...frame.fit]), [frame])
  const fresh = useMemo(() => new Set(frame.current), [frame])
  const page = frame.page
  const tokens = useMemo(() => new Set(tokenAt >= 0 ? [frame.token[tokenAt]] : []), [frame, tokenAt])
  const passed = useMemo(() => new Set(tokenAt > 0 ? frame.tokenFlows.slice(0, tokenAt) : []), [frame, tokenAt])
  const plain = frame.overview || frame.token.length > 0

  const nodes: Node[] = useMemo(() => {
    const out: Node[] = toNodes(model, new Set(), page, new Map(), tokens).map((n) => {
      const cls = [n.className, fresh.has(n.id) ? 'story-new' : '', frame.focus === n.id ? 'story-focus' : '', !plain && !lit.has(n.id) ? 'story-dim' : ''].filter(Boolean).join(' ')
      return { ...n, className: cls, draggable: false, selectable: false, connectable: false } as Node
    })
    for (const g of frame.ghosts) out.push({ id: g.id, type: 'storyGhost', position: { x: g.x, y: g.y }, data: { name: g.name, kind: g.kind }, draggable: false, selectable: false, className: 'story-new' })
    return out
  }, [model, page, tokens, fresh, lit, frame, plain])

  const edges = useMemo(() => {
    const drawn = new Map(frame.drawn.map((d) => [d.id, d.from]))
    return toEdges(model, new Set(), page, passed).map((e) => {
      const from = drawn.get(e.id)
      const dim = !from && !plain && !(lit.has(e.source) && lit.has(e.target))
      const sequence = e.data?.kind === 'sequence'
      const cls = [from ? (sequence ? 'story-draw' : 'story-fade') : '', from === 'target' ? 'story-reverse' : '', dim ? 'story-dim' : ''].filter(Boolean).join(' ')
      return { ...e, selectable: false, className: cls, data: { ...e.data!, draw: from && sequence ? from : undefined } }
    })
  }, [model, page, passed, frame, lit, plain])

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={types} edgeTypes={edgeTypes} connectionMode={ConnectionMode.Loose} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnDoubleClick={false} minZoom={0.1} proOptions={{ hideAttribution: false }} fitView>
      <EdgeMarkers />
      <Background gap={20} size={1} />
      <StoryCamera frame={frame} />
    </ReactFlow>
  )
}

/** Moves the camera to each beat: what the beat shows fits the left part, the card gets the right. */
function StoryCamera({ frame }: { frame: StoryFrame }) {
  const flow = useReactFlow()
  const width = useStore((s) => s.width)
  const presenting = useStory((s) => s.presenting)
  useEffect(() => {
    const fit = (duration: number) => {
      const have = new Set(flow.getNodes().map((n) => n.id))
      const ids = frame.fit.filter((id) => have.has(id))
      const pick = ids.length ? ids : flow.getNodes().map((n) => n.id)
      void flow.fitView({ nodes: pick.map((id) => ({ id })), padding: { top: '56px', bottom: '56px', left: '56px', right: `${cardRoom(width)}px` }, maxZoom: presenting ? 1.3 : 1, minZoom: 0.2, duration })
    }
    // New nodes are measured first, or fitView leaves them out.
    const timers = [setTimeout(() => fit(700), 120), setTimeout(() => fit(300), 900)]
    return () => timers.forEach(clearTimeout)
  }, [frame, flow, width, presenting])
  return null
}
