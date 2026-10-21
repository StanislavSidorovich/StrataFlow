// Handles on the selected flow: drag a segment sideways to bend the route, drag an end onto a side of a shape
// (the same shape: it leaves or enters by that side; another shape: the flow is moved there). Segment drags
// are live and one undo step; an end is placed when released. Everything is drawn in model coordinates.
import { ViewportPortal, useReactFlow, useStore } from '@xyflow/react'
import { useState } from 'react'
import type { Point } from '../../core/metamodel'
import { flowOf, reconnect, setFlowRoute } from '../../core/ops'
import { dragSegment, isOrthogonal, nearestSide, route } from '../../core/routing'
import { useEditor } from '../store'

const MIN_SEGMENT = 18

export function FlowGrips({ elementAt }: { elementAt: (p: Point) => string | undefined }) {
  const model = useEditor((s) => s.model)
  const selection = useEditor((s) => s.selection)
  const linkFrom = useEditor((s) => s.linkFrom)
  const tool = useEditor((s) => s.tool)
  const zoom = useStore((s) => s.transform[2])
  const rf = useReactFlow()
  const [endDrag, setEndDrag] = useState<{ end: 'source' | 'target'; at: Point } | null>(null)

  const id = selection.length === 1 ? selection[0] : null
  const f = id ? flowOf(model, id) : undefined
  if (!f || linkFrom || tool.id !== 'select') return null
  const sb = model.diagram.shapes[f.source]
  const tb = model.diagram.shapes[f.target]
  if (!sb || !tb) return null
  const isPool = (x: string) => model.participants.some((p) => p.id === x)
  const pts = model.diagram.edges[f.id] ?? route(f, sb, tb, isPool(f.target), isPool(f.source))
  if (!pts || pts.length < 2 || !isOrthogonal(pts)) return null
  const flowId = f.id
  const k = 1 / zoom
  const at = (e: { clientX: number; clientY: number }) => rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })

  const dragSeg = (i: number, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const base = pts
    const start = at(e)
    const move = (ev: PointerEvent) => {
      const p = at(ev)
      const next = dragSegment(base, i, { x: p.x - start.x, y: p.y - start.y })
      useEditor.getState().apply((m) => setFlowRoute(m, flowId, { points: next }), { coalesce: `route:${flowId}` })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const dragEnd = (end: 'source' | 'target', e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const move = (ev: PointerEvent) => setEndDrag({ end, at: at(ev) })
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setEndDrag(null)
      const p = at(ev)
      const hit = elementAt(p)
      const shape = hit ? useEditor.getState().model.diagram.shapes[hit] : undefined
      if (!hit || !shape) return
      const side = nearestSide(shape, p)
      const current = end === 'source' ? f.source : f.target
      useEditor.getState().apply((m) => (hit === current ? setFlowRoute(m, flowId, end === 'source' ? { source: side } : { target: side }) : reconnect(m, flowId, end, hit, side)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const grips: React.ReactNode[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
    if (len < MIN_SEGMENT) continue
    const horiz = a.y === b.y
    grips.push(
      <div
        key={`s${i}`}
        className={`flow-grip flow-grip-seg ${horiz ? 'is-horizontal' : 'is-vertical'} nodrag nopan`}
        style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2, ['--k' as string]: k }}
        title="Drag to move this part of the line"
        data-testid="flow-grip-segment"
        onPointerDown={(e) => dragSeg(i, e)}
      />,
    )
  }
  // An end's grip sits a little inside the line, so the shape's own dot stays free to start another flow from.
  const inset = (from: Point, towards: Point): Point => {
    const len = Math.abs(towards.x - from.x) + Math.abs(towards.y - from.y)
    const step = Math.min(16 * k, len / 3)
    return len ? { x: from.x + ((towards.x - from.x) / len) * step, y: from.y + ((towards.y - from.y) / len) * step } : from
  }
  const ends: ['source' | 'target', Point][] = [
    ['source', endDrag?.end === 'source' ? endDrag.at : inset(pts[0], pts[1])],
    ['target', endDrag?.end === 'target' ? endDrag.at : inset(pts[pts.length - 1], pts[pts.length - 2])],
  ]
  for (const [end, p] of ends)
    grips.push(
      <div
        key={end}
        className="flow-grip flow-grip-end nodrag nopan"
        style={{ left: p.x, top: p.y, ['--k' as string]: k }}
        title="Drag onto the side of a shape to leave or enter by it"
        data-testid={`flow-grip-${end}`}
        onPointerDown={(e) => dragEnd(end, e)}
      />,
    )
  return <ViewportPortal>{grips}</ViewportPortal>
}
