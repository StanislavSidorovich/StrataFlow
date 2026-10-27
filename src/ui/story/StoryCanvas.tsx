// The canvas of a story: the frame's model drawn read-only with the editor's own shapes, the beat's new shapes
// popping in, then their flows drawn, everything else dimmed; the camera moves to each beat; a token walks.
// A review replay's frame also carries the marks of its changes (the Changes panel's colours and numbers) and the
// ghosts of what was removed. A collapsed sub-process opens on its page (a click or "Open page"), Back returns.
import { useEffect, useMemo, useState } from 'react'
import { Background, ConnectionMode, ReactFlow, useReactFlow, useStore, type Node } from '@xyflow/react'
import { ArrowLeft, FileSymlink } from 'lucide-react'
import type { StoryFrame } from '../../core/story'
import { nodeOf, pageOf } from '../../core/ops'
import { EdgeMarkers, type FlowEdge } from '../canvas/edges'
import { edgeTypes, nodeTypes, shownOn, toEdges, toNodes } from '../canvas/Canvas'
import type { ChangeMark, GhostNode } from '../canvas/nodes'
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
  // The page the viewer opened by hand (null = the main process); undefined follows the beat.
  const [opened, setOpened] = useState<string | null | undefined>(undefined)
  useEffect(() => setOpened(undefined), [frame])
  const page = opened === undefined ? frame.page : opened
  const byHand = opened !== undefined

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
  const tokens = useMemo(() => new Set(tokenAt >= 0 ? [frame.token[tokenAt]] : []), [frame, tokenAt])
  const passed = useMemo(() => new Set(tokenAt > 0 ? frame.tokenFlows.slice(0, tokenAt) : []), [frame, tokenAt])
  const plain = frame.overview || frame.token.length > 0 || byHand

  // A review frame: marks on the elements of this page (a change inside a collapsed sub-process marks the box).
  const review = useMemo(() => {
    const marks = new Map<string, ChangeMark>()
    const ghostNodes: GhostNode[] = []
    const ghostEdges: FlowEdge[] = []
    const r = frame.review
    if (!r) return { marks, ghostNodes, ghostEdges }
    const shown = shownOn(model, page)
    for (const [id, m] of Object.entries(r.marks)) {
      const mark: ChangeMark = { status: m.status, n: m.n }
      if (model.flows.some((f) => f.id === id)) {
        marks.set(id, mark)
        continue
      }
      let at: string | undefined = id
      while (at && !shown.has(at)) at = pageOf(model, at)
      if (at && !marks.has(at)) marks.set(at, at === id ? mark : { ...mark, status: 'changed' })
    }
    for (const g of r.removedNodes) {
      if (g.page !== page) continue
      ghostNodes.push({ id: `ghost:${g.id}`, type: 'ghost', position: { x: g.box.x, y: g.box.y }, width: g.box.width, height: g.box.height, data: { el: g.el, change: { status: 'removed', n: g.n } }, selectable: false, draggable: false, connectable: false, zIndex: 1 })
    }
    for (const g of r.removedFlows) {
      if (!shown.has(g.source) || !shown.has(g.target)) continue
      ghostEdges.push({ id: `ghost:${g.id}`, type: 'flow', source: g.source, target: g.target, selectable: false, focusable: false, zIndex: 2, data: { kind: 'sequence', name: g.name, points: g.points, ghost: true, change: { status: 'removed', n: g.n } } })
    }
    return { marks, ghostNodes, ghostEdges }
  }, [frame, model, page])

  const nodes: Node[] = useMemo(() => {
    const out: Node[] = toNodes(model, new Set(), page, new Map(), tokens, review.marks, review.ghostNodes).map((n) => {
      const cls = [n.className, fresh.has(n.id) ? 'story-new' : '', frame.focus === n.id ? 'story-focus' : '', !plain && !lit.has(n.id) ? 'story-dim' : ''].filter(Boolean).join(' ')
      return { ...n, className: cls, draggable: false, selectable: false, connectable: false } as Node
    })
    for (const g of frame.ghosts) out.push({ id: g.id, type: 'storyGhost', position: { x: g.x, y: g.y }, data: { name: g.name, kind: g.kind }, draggable: false, selectable: false, className: 'story-new' })
    return out
  }, [model, page, tokens, fresh, lit, frame, plain, review])

  const edges = useMemo(() => {
    const drawn = new Map(frame.drawn.map((d) => [d.id, d.from]))
    return toEdges(model, new Set(), page, passed, null, review.marks, review.ghostEdges).map((e) => {
      const from = drawn.get(e.id)
      const marked = review.marks.has(e.id) || e.id.startsWith('ghost:')
      const dim = !from && !plain && !marked && !(lit.has(e.source) && lit.has(e.target))
      const sequence = e.data?.kind === 'sequence'
      const cls = [from ? (sequence ? 'story-draw' : 'story-fade') : '', from === 'target' ? 'story-reverse' : '', dim ? 'story-dim' : ''].filter(Boolean).join(' ')
      return { ...e, selectable: false, className: cls, data: { ...e.data!, draw: from && sequence ? from : undefined } }
    })
  }, [model, page, passed, frame, lit, plain, review])

  // Collapsed sub-processes on this page: each opens on its own page.
  const boxes = useMemo(() => {
    const shown = shownOn(model, page)
    return model.nodes.filter((n) => n.type === 'subProcess' && n.collapsed && shown.has(n.id) && model.diagram.shapes[n.id])
  }, [model, page])
  const open = (id: string) => nodeOf(model, id)?.type === 'subProcess' && setOpened(id)
  const back = () => setOpened(frame.page && !byHand ? null : undefined)

  return (
    <>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={types} edgeTypes={edgeTypes} connectionMode={ConnectionMode.Loose} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnDoubleClick={false} minZoom={0.1} proOptions={{ hideAttribution: false }} fitView onNodeClick={(_, n) => boxes.some((b) => b.id === n.id) && open(n.id)}>
        <EdgeMarkers />
        <Background gap={20} size={1} />
        <StoryCamera frame={frame} page={page} byHand={byHand} />
      </ReactFlow>
      {(page || boxes.length > 0) && (
        <div className="story-pages" data-testid="story-pages">
          {page && (
            <button type="button" className="btn" onClick={back} title="Back to the process" data-testid="story-page-back">
              <ArrowLeft size={14} /> Back
            </button>
          )}
          {page && <span className="small story-pages-name">Page: {nodeOf(model, page)?.name || 'sub-process'}</span>}
          {boxes.map((b) => (
            <button key={b.id} type="button" className="btn" onClick={() => open(b.id)} title="Show what is inside this sub-process (or click it)" data-testid={`story-open-page:${b.name}`}>
              <FileSymlink size={14} /> Open page{boxes.length > 1 || page ? `: ${b.name || 'sub-process'}` : ''}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

/** Moves the camera to each beat: what the beat shows fits the left part, the card gets the right. */
function StoryCamera({ frame, page, byHand }: { frame: StoryFrame; page: string | null; byHand: boolean }) {
  const flow = useReactFlow()
  const width = useStore((s) => s.width)
  const presenting = useStory((s) => s.presenting)
  useEffect(() => {
    const fit = (duration: number) => {
      const have = new Set(flow.getNodes().map((n) => n.id))
      // A page opened by hand shows all of it.
      const ids = byHand ? [] : frame.fit.filter((id) => have.has(id))
      const pick = ids.length ? ids : flow.getNodes().map((n) => n.id)
      void flow.fitView({ nodes: pick.map((id) => ({ id })), padding: { top: '56px', bottom: '56px', left: '56px', right: `${cardRoom(width)}px` }, maxZoom: presenting ? 1.3 : 1, minZoom: 0.2, duration })
    }
    // New nodes are measured first, or fitView leaves them out.
    const timers = [setTimeout(() => fit(700), 120), setTimeout(() => fit(300), 900)]
    return () => timers.forEach(clearTimeout)
  }, [frame, flow, width, presenting, page, byHand])
  return null
}
