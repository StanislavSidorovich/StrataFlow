// BPMN connections: sequence (solid, filled arrow), message (dashed, open circle → open arrow),
// association and data association (dotted). Drawn along DI waypoints; once an end has moved,
// routed orthogonally between the shapes instead.
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react'
import type { FlowKind } from '../../core/metamodel'

export type FlowData = { kind: FlowKind; name: string; points?: { x: number; y: number }[]; isDefault?: boolean; conditional?: boolean }
export type FlowEdge = Edge<FlowData, 'flow'>

export function BpmnEdge({ id, data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }: EdgeProps<FlowEdge>) {
  const kind = data?.kind ?? 'sequence'
  const pts = data?.points
  let path: string
  let labelX: number
  let labelY: number
  let vertical = false
  if (pts && pts.length >= 2) {
    path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
    // Label in the middle of the longest segment: it is where a reader looks for it.
    let best = 0
    for (let i = 1; i < pts.length - 1; i++) if (len(pts[i], pts[i + 1]) > len(pts[best], pts[best + 1])) best = i
    labelX = (pts[best].x + pts[best + 1].x) / 2
    labelY = (pts[best].y + pts[best + 1].y) / 2
    vertical = pts[best].x === pts[best + 1].x
  } else {
    ;[path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 0 })
  }
  const marker = kind === 'sequence' ? 'url(#bpmn-arrow)' : kind === 'message' ? 'url(#bpmn-open-arrow)' : kind === 'data' ? 'url(#bpmn-line-arrow)' : undefined
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={`bpmn-edge bpmn-edge-${kind}${selected ? ' is-selected' : ''}`}
        markerEnd={marker}
        markerStart={kind === 'message' ? 'url(#bpmn-open-circle)' : data?.isDefault ? 'url(#bpmn-default-slash)' : data?.conditional ? 'url(#bpmn-cond-diamond)' : undefined}
      />
      {data?.name && (
        <EdgeLabelRenderer>
          <div className="bpmn-edge-label nodrag nopan" style={{ transform: vertical ? `translate(4px, -50%) translate(${labelX}px, ${labelY}px)` : `translate(-50%, -100%) translate(${labelX}px, ${labelY - 2}px)` }}>
            {data.name}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const len = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** Marker shapes, rendered once per canvas. */
export function EdgeMarkers() {
  return (
    <svg className="bpmn-markers" width={0} height={0} aria-hidden>
      <defs>
        <marker id="bpmn-arrow" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={10} markerHeight={10} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 0L10 5L0 10z" className="bpmn-marker-fill" />
        </marker>
        <marker id="bpmn-open-arrow" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={11} markerHeight={11} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M1 1L10 5L1 9z" className="bpmn-marker-open" />
        </marker>
        <marker id="bpmn-line-arrow" viewBox="0 0 10 10" refX={10} refY={5} markerWidth={10} markerHeight={10} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 1L10 5L0 9" className="bpmn-marker-line" />
        </marker>
        <marker id="bpmn-open-circle" viewBox="0 0 10 10" refX={5} refY={5} markerWidth={9} markerHeight={9} markerUnits="userSpaceOnUse" orient="auto">
          <circle cx={5} cy={5} r={4} className="bpmn-marker-open" />
        </marker>
        <marker id="bpmn-default-slash" viewBox="0 0 20 20" refX={0} refY={10} markerWidth={20} markerHeight={20} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M6 5L12 15" className="bpmn-marker-line" />
        </marker>
        <marker id="bpmn-cond-diamond" viewBox="0 0 20 10" refX={0} refY={5} markerWidth={20} markerHeight={10} markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 5L8 1L16 5L8 9z" className="bpmn-marker-open" />
        </marker>
      </defs>
    </svg>
  )
}
