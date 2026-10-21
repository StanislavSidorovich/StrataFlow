// BPMN shapes as React Flow nodes. Each node is drawn in SVG at its DI size; labels of events,
// gateways and data sit under the shape, as in Bizagi and bpmn.io. Dots on the four sides start a
// connection; the editor decides the flow kind. Resizing ends in one undoable edit.
import { Handle, NodeResizer, NodeResizeControl, ResizeControlVariant, Position, type Node, type NodeProps } from '@xyflow/react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Severity } from '../../core/lint'
import type { FlowNode, LoopKind } from '../../core/metamodel'
import { rename, resizeElement, resizeLane } from '../../core/ops'
import { useEditor } from '../store'
import { ContextPad } from './ContextPad'

export type ShapeData = { el: FlowNode; issue?: Severity; token?: boolean }
/** `empty`: a pool with no steps (a black box: the contractor); its dots start message flows. */
export type PoolData = { name: string; header: number; lane?: boolean; empty?: boolean }
export type ShapeNode = Node<ShapeData, 'shape'>
export type PoolNode = Node<PoolData, 'pool'>

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left]

/** Connection dots; edges are routed between shapes, so the dot only says where a drag starts. */
const Handles = ({ connectable = true }: { connectable?: boolean }) => (
  <>
    {SIDES.map((p) => (
      <Handle key={p} id={p} type="source" position={p} className={connectable ? 'bpmn-handle' : 'hidden-handle'} isConnectable={connectable} />
    ))}
  </>
)

const resized = (id: string) => (_: unknown, p: { x: number; y: number; width: number; height: number }) =>
  useEditor.getState().apply((m) => resizeElement(m, id, p))

export function PoolShape({ id, data, width = 0, height = 0, selected }: NodeProps<PoolNode>) {
  return (
    <div className={`${data.lane ? 'bpmn-lane' : 'bpmn-pool'}${selected ? ' is-selected' : ''}`} style={{ width, height }} data-testid={data.lane ? `lane:${data.name}` : `pool:${data.name}`}>
      <div className="bpmn-pool-header" style={{ width: data.header }} title={data.lane ? 'Lane: click to select' : 'Pool: drag here to move, click to select'}>
        <span>{data.name}</span>
      </div>
      {data.lane ? (
        // Always there, so the lower edge can be grabbed without selecting the lane first.
        <NodeResizeControl
          position="bottom"
          variant={ResizeControlVariant.Line}
          resizeDirection="vertical"
          minHeight={40}
          className="bpmn-lane-resize"
          onResizeEnd={(_, p) => useEditor.getState().apply((m) => resizeLane(m, id, p.height))}
        />
      ) : (
        // Always there (edges only show on hover, corners when selected): drag any pool edge to resize.
        <NodeResizer isVisible minWidth={200} minHeight={60} lineClassName="bpmn-resize-line" handleClassName="bpmn-resize-handle" onResizeEnd={resized(id)} />
      )}
      <Handles connectable={!!data.empty && !data.lane} />
      {!data.lane && (
        // A strip along the outside of the long borders: a message flow starts (or ends) anywhere on a pool's border, not only at the dot.
        <>
          <Handle id="edge-top" type="source" position={Position.Top} className="pool-edge-handle" title="Drag from the border to send a message flow" />
          <Handle id="edge-bottom" type="source" position={Position.Bottom} className="pool-edge-handle" title="Drag from the border to send a message flow" />
        </>
      )}
    </div>
  )
}

/**
 * The name typed in place (double-click a shape): a text box over the label, the caret where the click was.
 * Typing is the same edit as in Properties (one undo step per burst); Enter or a click elsewhere ends it.
 */
function NameEditor({ id, name, caret }: { id: string; name: string; caret: number | null }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fit = () => {
    const t = ref.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${t.scrollHeight}px`
  }
  useEffect(() => {
    const t = ref.current
    if (!t) return
    const at = caret === null ? t.value.length : Math.min(caret, t.value.length)
    const place = () => {
      t.focus()
      t.setSelectionRange(at, at)
    }
    place()
    // React Flow focuses the node after the click that opened this box: take the focus back once it has.
    const frame = requestAnimationFrame(() => document.activeElement !== t && place())
    return () => cancelAnimationFrame(frame)
  }, [])
  useLayoutEffect(fit, [name])
  return (
    <textarea
      ref={ref}
      className="bpmn-name-edit nodrag nowheel nopan"
      rows={1}
      value={name}
      aria-label="Name"
      data-testid="name-inline"
      onChange={(e) => useEditor.getState().apply((m) => rename(m, id, e.target.value), { coalesce: `name:${id}` })}
      onBlur={() => useEditor.setState({ editing: null })}
      onKeyDown={(e) => {
        e.stopPropagation()
        // Enter finishes the name (Shift+Enter: a new line), as in Properties and Bizagi.
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

export function BpmnShape({ data, width = 0, height = 0, selected }: NodeProps<ShapeNode>) {
  const el = data.el
  const editing = useEditor((s) => (s.editing?.id === el.id ? s.editing : null))
  return (
    <div className={`bpmn-shape bpmn-${el.type}${selected ? ' is-selected' : ''}`} style={{ width, height }} data-testid={`${el.type}:${el.name}`}>
      {(el.type === 'task' || el.type === 'subProcess' || el.type === 'annotation') && (
        <NodeResizer isVisible={selected} minWidth={40} minHeight={30} lineClassName="bpmn-resize-line" handleClassName="bpmn-resize-handle" onResizeEnd={resized(el.id)} />
      )}
      <ContextPad el={el} />
      {data.token && <span className="token-mark" title="A case is here (Simulate → Play a case)" data-testid={`token:${el.name}`} />}
      {data.issue && (
        <span className={`issue-mark is-${data.issue}`} title={`The check found ${data.issue === 'info' ? 'a hint' : `an ${data.issue}`} here: see the Check panel`} data-testid={`mark:${el.name}`}>
          {data.issue === 'info' ? 'i' : '!'}
        </span>
      )}
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} overflow="visible">
        <Figure el={el} w={width} h={height} />
      </svg>
      {el.type === 'task' || el.type === 'subProcess' || el.type === 'annotation' ? (
        <div className={el.type === 'annotation' ? 'bpmn-annotation-text' : 'bpmn-inner-label'}>
          {editing ? <NameEditor id={el.id} name={el.name} caret={editing.caret} /> : el.name}
        </div>
      ) : editing ? (
        <div className="bpmn-outer-label is-editing">
          <NameEditor id={el.id} name={el.name} caret={editing.caret} />
        </div>
      ) : (
        el.name && <div className="bpmn-outer-label">{el.name}{el.type === 'dataObject' && el.state ? ` [${el.state}]` : ''}</div>
      )}
      <Handles />
    </div>
  )
}

/** Loop (circular arrow) or multi-instance (three bars: vertical = parallel, horizontal = sequential), bottom centre. */
function LoopMarker({ loop, x, y }: { loop: LoopKind; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} data-testid={`loop:${loop}`}>
      {loop === 'standard' ? (
        <path d="M3.5 11 A5 5 0 1 1 10.5 11 M10.5 11 l0.2 -3.4 M10.5 11 l-3.3 -0.6" className="bpmn-stroke" fill="none" />
      ) : loop === 'parallel' ? (
        <path d="M3 1v12M7 1v12M11 1v12" className="bpmn-stroke" strokeWidth={2} />
      ) : (
        <path d="M1 3h12M1 7h12M1 11h12" className="bpmn-stroke" strokeWidth={2} />
      )}
    </g>
  )
}

function Figure({ el, w, h }: { el: FlowNode; w: number; h: number }) {
  switch (el.type) {
    case 'task':
      return (
        <>
          <rect x={0.75} y={0.75} width={w - 1.5} height={h - 1.5} rx={8} className="bpmn-stroke bpmn-fill" />
          <TaskMarker kind={el.kind} />
          {el.loop && <LoopMarker loop={el.loop} x={w / 2 - 7} y={h - 16} />}
        </>
      )
    case 'subProcess':
      return (
        <>
          <rect x={0.75} y={0.75} width={w - 1.5} height={h - 1.5} rx={8} className="bpmn-stroke bpmn-fill" />
          {el.collapsed && (
            <g transform={`translate(${w / 2 - 7} ${h - 16})`}>
              <rect width={14} height={14} className="bpmn-stroke bpmn-fill" />
              <path d="M7 3v8M3 7h8" className="bpmn-stroke" />
            </g>
          )}
          {el.loop && <LoopMarker loop={el.loop} x={w / 2 - 7 - (el.collapsed ? 18 : 0)} y={h - 16} />}
        </>
      )
    case 'event': {
      const r = Math.min(w, h) / 2
      const cls = el.position === 'end' ? 'bpmn-event-end' : el.position === 'start' ? 'bpmn-event-start' : ''
      const dashed = el.interrupting === false ? '4 3' : undefined
      return (
        <g transform={`translate(${w / 2} ${h / 2})`}>
          <circle r={r - (el.position === 'end' ? 1.5 : 0.75)} className={`bpmn-stroke bpmn-fill ${cls}`} strokeDasharray={dashed} />
          {(el.position === 'intermediate' || el.position === 'boundary') && <circle r={r - 3.5} className="bpmn-stroke" fill="none" strokeDasharray={dashed} />}
          <EventMarker trigger={el.trigger} throwing={el.throwing} r={r} />
        </g>
      )
    }
    case 'gateway': {
      const c = w / 2
      return (
        <>
          <path d={`M${c} 1 L${w - 1} ${c} L${c} ${w - 1} L1 ${c} Z`} className="bpmn-stroke bpmn-fill" />
          <g transform={`translate(${c} ${c})`}>
            <GatewayMarker kind={el.kind} s={w / 4} />
          </g>
        </>
      )
    }
    case 'dataObject':
      return <path d={`M1 1 H${w - 11} L${w - 1} 11 V${h - 1} H1 Z M${w - 11} 1 V11 H${w - 1}`} className="bpmn-stroke bpmn-fill" />
    case 'dataStore': {
      const ry = Math.min(8, h / 6)
      return (
        <path
          d={`M1 ${ry} A${w / 2 - 1} ${ry} 0 0 1 ${w - 1} ${ry} V${h - ry} A${w / 2 - 1} ${ry} 0 0 1 1 ${h - ry} Z M1 ${ry} A${w / 2 - 1} ${ry} 0 0 0 ${w - 1} ${ry}`}
          className="bpmn-stroke bpmn-fill"
        />
      )
    }
    case 'annotation':
      return <path d={`M12 1 H1 V${h - 1} H12`} className="bpmn-stroke" fill="none" />
  }
}

function TaskMarker({ kind }: { kind: string }) {
  const g = (d: string, filled = false) => <path d={d} transform="translate(6 6)" className={filled ? 'bpmn-mark-fill' : 'bpmn-stroke'} fill="none" />
  switch (kind) {
    case 'user':
      return (
        <g transform="translate(6 6)" className="bpmn-stroke" fill="none">
          <circle cx={7} cy={4} r={3.2} />
          <path d="M1 14c0-4 3-6 6-6s6 2 6 6z" />
        </g>
      )
    case 'send':
      return g('M0 2h14v10H0z M0 2l7 5 7-5', true)
    case 'receive':
      return g('M0 2h14v10H0z M0 2l7 5 7-5')
    case 'manual':
      return g('M0 6h4l3-4h2l-2 4h7v2h-4v2h3v2h-3v2H0z')
    case 'service':
      return (
        <g transform="translate(13 13)" className="bpmn-stroke" fill="none">
          <circle r={5} />
          <circle r={2} />
        </g>
      )
    case 'script':
      return g('M3 0h9c-3 3 0 6-2 14H1c2-8-1-11 2-14z M4 4h5 M4 7h5 M3 10h5')
    case 'businessRule':
      return g('M0 1h15v12H0z M0 4h15 M4 4v9')
    default:
      return null
  }
}

function EventMarker({ trigger, throwing, r }: { trigger: string; throwing: boolean; r: number }) {
  const s = r / 15
  const cls = throwing ? 'bpmn-mark-fill' : 'bpmn-stroke'
  switch (trigger) {
    case 'message':
      return (
        <g transform={`scale(${s})`}>
          <path d="M-7 -5h14v10h-14z" className={cls} fill="none" />
          <path d="M-7 -5l7 5 7-5" className={throwing ? 'bpmn-mark-inverse' : 'bpmn-stroke'} fill="none" />
        </g>
      )
    case 'timer':
      return (
        <g transform={`scale(${s})`} className="bpmn-stroke" fill="none">
          <circle r={8} />
          <path d="M0 -6v6l4 2" />
        </g>
      )
    case 'terminate':
      return <circle r={r * 0.55} className="bpmn-mark-fill" />
    case 'error':
      return <path d="M-6 6l3-10 4 6 5-8-3 10-4-6z" transform={`scale(${s})`} className={cls} />
    case 'signal':
      return <path d="M0 -7l7 12h-14z" transform={`scale(${s})`} className={cls} fill="none" />
    case 'link':
      return <path d="M-6 -3h7v-4l6 7-6 7v-4h-7z" transform={`scale(${s})`} className={cls} fill="none" />
    case 'conditional':
      return <path d="M-5 -7h10v14h-10z M-3 -4h6 M-3 -1h6 M-3 2h6 M-3 5h6" transform={`scale(${s})`} className="bpmn-stroke" fill="none" />
    case 'escalation':
      return <path d="M0 -7l5 13-5-5-5 5z" transform={`scale(${s})`} className={cls} fill="none" />
    case 'compensation':
      return <path d="M0 -5v10l-7-5z M7 -5v10l-7-5z" transform={`scale(${s})`} className={cls} fill="none" />
    default:
      return null
  }
}

function GatewayMarker({ kind, s }: { kind: string; s: number }) {
  switch (kind) {
    case 'exclusive':
      return <path d={`M${-s * 0.6} ${-s * 0.6}L${s * 0.6} ${s * 0.6}M${s * 0.6} ${-s * 0.6}L${-s * 0.6} ${s * 0.6}`} className="bpmn-mark-thick" />
    case 'parallel':
      return <path d={`M0 ${-s * 0.8}V${s * 0.8}M${-s * 0.8} 0H${s * 0.8}`} className="bpmn-mark-thick" />
    case 'inclusive':
      return <circle r={s * 0.7} className="bpmn-mark-thick" fill="none" />
    case 'eventBased':
      return (
        <g className="bpmn-stroke" fill="none">
          <circle r={s * 0.85} />
          <circle r={s * 0.7} />
          <path d={`M0 ${-s * 0.45}L${s * 0.43} ${-s * 0.14}L${s * 0.27} ${s * 0.37}H${-s * 0.27}L${-s * 0.43} ${-s * 0.14}Z`} />
        </g>
      )
    case 'complex':
      return <path d={`M0 ${-s * 0.8}V${s * 0.8}M${-s * 0.8} 0H${s * 0.8}M${-s * 0.56} ${-s * 0.56}L${s * 0.56} ${s * 0.56}M${s * 0.56} ${-s * 0.56}L${-s * 0.56} ${s * 0.56}`} className="bpmn-mark-thick" />
    default:
      return null
  }
}
