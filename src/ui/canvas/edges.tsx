// BPMN connections: sequence (solid, filled arrow), message (dashed, open circle → open arrow),
// association and data association (dotted). Drawn along DI waypoints; without them (a new flow, or an
// end has moved) routed orthogonally between the sides of the two shapes that face each other.
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position, useInternalNode, useStore, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react'
import type { Bounds, FlowKind, Side } from '../../core/metamodel'
import { route, routeSides } from '../../core/routing'
import { ChangeBadge, type ChangeMark } from './nodes'

export type FlowData = { kind: FlowKind; name: string; points?: { x: number; y: number }[]; sourceSide?: Side; targetSide?: Side; isDefault?: boolean; conditional?: boolean; passed?: boolean; drop?: boolean; change?: ChangeMark }
export type FlowEdge = Edge<FlowData, 'flow'>

type Box = { x: number; y: number; w: number; h: number; pool: boolean }

function boxOf(n: InternalNode | undefined): Box | undefined {
  if (!n) return undefined
  const { x, y } = n.internals.positionAbsolute
  return { x, y, w: n.measured.width ?? n.width ?? 0, h: n.measured.height ?? n.height ?? 0, pool: n.type === 'pool' }
}

const side = (b: Box, p: Position) =>
  p === Position.Left ? { x: b.x, y: b.y + b.h / 2 } : p === Position.Right ? { x: b.x + b.w, y: b.y + b.h / 2 } : p === Position.Top ? { x: b.x + b.w / 2, y: b.y } : { x: b.x + b.w / 2, y: b.y + b.h }

/** The sides of two shapes that face each other: left/right when apart sideways, else top/bottom. */
export function facingSides(s: Box, t: Box, preferVertical: boolean) {
  const apartX = t.x >= s.x + s.w + 10 ? 1 : t.x + t.w <= s.x - 10 ? -1 : 0
  const apartY = t.y >= s.y + s.h + 10 ? 1 : t.y + t.h <= s.y - 10 ? -1 : 0
  if (apartX && !(preferVertical && apartY))
    return apartX > 0 ? ([Position.Right, Position.Left] as const) : ([Position.Left, Position.Right] as const)
  return apartY >= 0 ? ([Position.Bottom, Position.Top] as const) : ([Position.Top, Position.Bottom] as const)
}

export function BpmnEdge({ id, source, target, data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }: EdgeProps<FlowEdge>) {
  const sb = boxOf(useInternalNode(source))
  const tb = boxOf(useInternalNode(target))
  // The shapes this flow must not run through (shared by all flows, so one subscription is cheap).
  const lookup = useStore((s) => s.nodeLookup)
  if (sb && tb) {
    const [sp, tp] = facingSides(sb, tb, data?.kind === 'message')
    ;({ x: sourceX, y: sourceY } = side(sb, sp))
    ;({ x: targetX, y: targetY } = side(tb, tp))
    sourcePosition = sp
    targetPosition = tp
    // A message to or from a pool meets the pool's border straight above or below the other end.
    if (tb.pool && (tp === Position.Top || tp === Position.Bottom)) targetX = Math.min(Math.max(sourceX, tb.x + 40), tb.x + tb.w - 10)
    if (sb.pool && (sp === Position.Top || sp === Position.Bottom)) sourceX = Math.min(Math.max(targetX, sb.x + 40), sb.x + sb.w - 10)
  }
  const kind = data?.kind ?? 'sequence'
  let pts = data?.points
  // A side the user chose (a dot of the shape) decides the route; the user's own bends decide it more.
  if (!(pts && pts.length >= 2) && (data?.sourceSide || data?.targetSide) && sb && tb)
    pts = routeSides(
      { x: sb.x, y: sb.y, width: sb.w, height: sb.h },
      data.sourceSide ?? (sourcePosition as Side),
      { x: tb.x, y: tb.y, width: tb.w, height: tb.h },
      data.targetSide ?? (targetPosition as Side),
      { source: sb.pool, target: tb.pool },
    )
  // The automatic route keeps clear of other shapes: the vertical step moves into a gap beside them.
  if (!(pts && pts.length >= 2) && !data?.sourceSide && !data?.targetSide && sb && tb && !sb.pool && !tb.pool) {
    const s = { x: sb.x, y: sb.y, width: sb.w, height: sb.h }
    const t = { x: tb.x, y: tb.y, width: tb.w, height: tb.h }
    const inside = (b: Bounds, x: number, y: number) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
    const obstacles: Bounds[] = []
    for (const n of lookup.values()) {
      if (n.type !== 'shape' || n.id === source || n.id === target) continue
      const b = boxOf(n)!
      const box = { x: b.x, y: b.y, width: b.w, height: b.h }
      if (!inside(box, s.x + s.width, s.y + s.height / 2) && !inside(box, t.x, t.y + t.height / 2)) obstacles.push(box)
    }
    const plain = route({ kind, sourceSide: undefined, targetSide: undefined }, s, t)
    const clear = route({ kind, sourceSide: undefined, targetSide: undefined }, s, t, false, false, obstacles)
    if (plain && clear && plain.length === 4 && JSON.stringify(plain) !== JSON.stringify(clear)) pts = clear
  }
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
        className={`bpmn-edge bpmn-edge-${kind}${selected ? ' is-selected' : ''}${data?.passed ? ' is-passed' : ''}${data?.drop ? ' is-drop' : ''}${data?.change ? ` chg-${data.change.status}` : ''}`}
        markerEnd={marker}
        markerStart={kind === 'message' ? 'url(#bpmn-open-circle)' : data?.isDefault ? 'url(#bpmn-default-slash)' : data?.conditional ? 'url(#bpmn-cond-diamond)' : undefined}
      />
      {data?.change && (
        <EdgeLabelRenderer>
          <div className="chg-edge-badge nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + (data.name ? 12 : 0)}px)` }}>
            <ChangeBadge change={data.change} where="edge" />
          </div>
        </EdgeLabelRenderer>
      )}
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
