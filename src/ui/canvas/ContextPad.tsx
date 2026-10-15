// The context pad (as in bpmn.io): next to the one selected shape, append the next step, add a
// boundary event, connect to another shape (the arrow, then a tap on it: dragging from a small dot is hard
// with a finger) or change the type (the wrench opens the "change type" part of the right-click menu, for
// touch screens and for people who do not know about right-click). A new step is selected with its name
// field focused.
import { NodeToolbar, Position } from '@xyflow/react'
import { MoveUpRight, Trash2, Wrench } from 'lucide-react'
import type { FlowNode } from '../../core/metamodel'
import { addBoundaryEvent, appendNode, deleteElements, type NodeSpec } from '../../core/ops'
import { useEditor } from '../store'
import { BpmnIcon, type IconName } from './icons'

const APPEND: { icon: IconName; spec: NodeSpec; title: string }[] = [
  { icon: 'task', spec: { type: 'task' }, title: 'Append a task' },
  { icon: 'gateway', spec: { type: 'gateway', kind: 'exclusive' }, title: 'Append an exclusive gateway (XOR: one way)' },
  { icon: 'parallel', spec: { type: 'gateway', kind: 'parallel' }, title: 'Append a parallel gateway (AND: all ways)' },
  { icon: 'intermediate', spec: { type: 'event', position: 'intermediate' }, title: 'Append an intermediate event' },
  { icon: 'end', spec: { type: 'event', position: 'end' }, title: 'Append an end event' },
]

export function ContextPad({ el }: { el: FlowNode }) {
  const only = useEditor((s) => s.selection.length === 1 && s.selection[0] === el.id)
  const linking = useEditor((s) => s.linkFrom === el.id)
  if (!only) return null
  const canAppend = !(el.type === 'event' && el.position === 'end') && el.type !== 'dataObject' && el.type !== 'dataStore' && el.type !== 'annotation'
  const canCarry = el.type === 'task' || el.type === 'subProcess'

  const run = (edit: Parameters<ReturnType<typeof useEditor.getState>['apply']>[0], created: () => string | null) => {
    const { apply } = useEditor.getState()
    if (apply(edit)) {
      const id = created()
      if (id) useEditor.setState({ selection: [id], focusName: id })
    }
  }

  return (
    <NodeToolbar isVisible position={Position.Right} offset={10} align="start" className="context-pad">
      {canAppend &&
        APPEND.map((a) => (
          <button
            key={a.icon}
            className="pad-btn"
            title={a.title}
            data-testid={`pad-${a.icon}`}
            onClick={() => {
              let id: string | null = null
              run((m) => void (id = appendNode(m, el.id, a.spec).id), () => id)
            }}
          >
            <BpmnIcon name={a.icon} />
          </button>
        ))}
      {canCarry && (
        <button
          className="pad-btn"
          title="Add a boundary event (a timer: the deadline on this activity; change the trigger in Properties)"
          data-testid="pad-boundary"
          onClick={() => {
            let id: string | null = null
            run((m) => void (id = addBoundaryEvent(m, el.id).id), () => id)
          }}
        >
          <BpmnIcon name="boundary" />
        </button>
      )}
      <button
        className={`pad-btn${linking ? ' is-active' : ''}`}
        title="Connect: then click or tap the shape (or pool) to connect to"
        aria-pressed={linking}
        data-testid="pad-connect"
        onClick={() =>
          useEditor.setState(
            linking ? { linkFrom: null, message: null } : { linkFrom: el.id, tool: { id: 'select' }, error: null, message: 'Connect: tap the shape to connect to (the empty canvas cancels).' },
          )
        }
      >
        <MoveUpRight size={16} />
      </button>
      {['task', 'subProcess', 'event', 'gateway'].includes(el.type) && (
        <button
          className="pad-btn"
          title="Change type (also on right-click)"
          aria-haspopup="menu"
          data-testid="pad-change-type"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            useEditor.getState().openMenu({ x: r.right + 4, y: r.top, ids: [el.id], at: { x: 0, y: 0 }, kind: 'type' })
          }}
        >
          <Wrench size={16} />
        </button>
      )}
      <button className="pad-btn" title="Delete (Del)" data-testid="pad-delete" onClick={() => useEditor.getState().apply((m) => deleteElements(m, [el.id]))}>
        <Trash2 size={16} />
      </button>
    </NodeToolbar>
  )
}
