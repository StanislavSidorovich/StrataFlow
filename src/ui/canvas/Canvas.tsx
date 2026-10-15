// The editing canvas. Nodes are drawn from the model; while a drag or a resize runs they live in local
// state, and the end of it becomes one edit (one undo step). Pools and lanes let clicks through their
// body, so the empty canvas inside a pool still pans, selects and takes new elements.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNodeChanges,
  Background,
  ConnectionMode,
  ControlButton,
  Controls,
  ReactFlow,
  useReactFlow,
  type Connection,
  type FinalConnectionState,
  type NodeChange,
} from '@xyflow/react'
import { Redo2, Undo2 } from 'lucide-react'
import type { FlowModel, Point } from '../../core/metamodel'
import { POOL_HEADER } from '../../core/metamodel'
import { addNode, addPool, connect, moveElements, withDescendants } from '../../core/ops'
import { useEditor } from '../store'
import { BpmnEdge, EdgeMarkers, type FlowEdge } from './edges'
import { BpmnShape, PoolShape, type PoolNode, type ShapeNode } from './nodes'
import { Palette } from './Palette'

type AnyNode = ShapeNode | PoolNode

const nodeTypes = { shape: BpmnShape, pool: PoolShape }
const edgeTypes = { flow: BpmnEdge }

/** Content of a collapsed sub-process is not drawn (it is still in the model). */
function hiddenIn(model: FlowModel): Set<string> {
  const out = new Set<string>()
  for (const n of model.nodes) if (n.type === 'subProcess' && n.collapsed) for (const d of withDescendants(model, n.id)) if (d !== n.id && !(nodeOfAttached(model, d) === n.id)) out.add(d)
  return out
}
const nodeOfAttached = (model: FlowModel, id: string) => {
  const n = model.nodes.find((x) => x.id === id)
  return n?.type === 'event' ? n.attachedTo : undefined
}

function toNodes(model: FlowModel, selected: Set<string>): AnyNode[] {
  const { shapes } = model.diagram
  const hidden = hiddenIn(model)
  const out: AnyNode[] = []
  for (const p of model.participants) {
    const s = shapes[p.id]
    if (!s) continue
    const lanes = model.lanes.filter((l) => l.participantId === p.id && !l.parentLaneId && shapes[l.id])
    const header = lanes.length ? Math.max(POOL_HEADER, s.width - Math.max(...lanes.map((l) => shapes[l.id].width))) : POOL_HEADER
    out.push({ id: p.id, type: 'pool', position: { x: s.x, y: s.y }, width: s.width, height: s.height, data: { name: p.name, header }, dragHandle: '.bpmn-pool-header', selected: selected.has(p.id), className: 'pool-node', zIndex: 0 })
  }
  for (const l of model.lanes) {
    const s = shapes[l.id]
    if (!s) continue
    out.push({ id: l.id, type: 'pool', position: { x: s.x, y: s.y }, width: s.width, height: s.height, data: { name: l.name, header: POOL_HEADER, lane: true }, draggable: false, selected: selected.has(l.id), className: 'pool-node', zIndex: 0 })
  }
  for (const el of model.nodes) {
    const s = shapes[el.id]
    if (!s || hidden.has(el.id)) continue
    // An expanded sub-process sits under its content.
    const z = el.type === 'event' && el.position === 'boundary' ? 4 : el.type === 'subProcess' && !el.collapsed ? 1 : 2
    out.push({ id: el.id, type: 'shape', position: { x: s.x, y: s.y }, width: s.width, height: s.height, data: { el }, selected: selected.has(el.id), zIndex: z })
  }
  return out
}

function toEdges(model: FlowModel, selected: Set<string>): FlowEdge[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const hidden = hiddenIn(model)
  return model.flows.filter((f) => !hidden.has(f.source) && !hidden.has(f.target)).map((f) => {
    const src = byId.get(f.source)
    return {
      id: f.id,
      type: 'flow',
      source: f.source,
      target: f.target,
      selected: selected.has(f.id),
      zIndex: 3,
      data: {
        kind: f.kind,
        name: f.name,
        points: model.diagram.edges[f.id],
        isDefault: src?.type === 'gateway' && src.defaultFlow === f.id,
        conditional: !!f.condition && src?.type !== 'gateway',
      },
    }
  })
}

/** What moves along with a dragged element: a pool's lanes and content, a task's boundary events, a sub-process's content. */
function followersOf(model: FlowModel, id: string): string[] {
  if (model.participants.some((p) => p.id === id))
    return [...model.lanes.filter((l) => l.participantId === id), ...model.nodes.filter((n) => n.participantId === id)].map((x) => x.id)
  return [...withDescendants(model, id)].filter((x) => x !== id)
}

/** The element under a point: the smallest shape, then a pool (a message flow can end on a pool). */
function elementAt(model: FlowModel, p: Point): string | undefined {
  const hit = (id: string) => {
    const s = model.diagram.shapes[id]
    return s && p.x >= s.x && p.x <= s.x + s.width && p.y >= s.y && p.y <= s.y + s.height
  }
  const area = (id: string) => model.diagram.shapes[id].width * model.diagram.shapes[id].height
  const nodes = model.nodes.filter((n) => hit(n.id)).sort((a, b) => area(a.id) - area(b.id))
  return nodes[0]?.id ?? model.participants.find((x) => hit(x.id))?.id
}

export function Canvas() {
  const model = useEditor((s) => s.model)
  const selection = useEditor((s) => s.selection)
  const tool = useEditor((s) => s.tool)
  const selected = useMemo(() => new Set(selection), [selection])
  const [nodes, setNodes] = useState<AnyNode[]>(() => toNodes(model, selected))
  useEffect(() => setNodes(toNodes(model, selected)), [model, selected])
  const edges = useMemo(() => toEdges(model, selected), [model, selected])
  const flow = useReactFlow()
  const fit = useEditor((s) => s.fit)
  useEffect(() => {
    if (fit) requestAnimationFrame(() => void flow.fitView({ maxZoom: 1, padding: 0.08, duration: 300 }))
  }, [fit, flow])
  // Start positions of what a drag moves, so followers move by the same delta.
  const drag = useRef<Map<string, Point> | null>(null)

  const onNodesChange = (changes: NodeChange<AnyNode>[]) => {
    setNodes((ns) => {
      let next = applyNodeChanges(changes.filter((c) => c.type !== 'select'), ns)
      const start = drag.current
      if (start) {
        const leaders = changes.flatMap((c) => (c.type === 'position' && c.position ? [c] : []))
        const moveTo = new Map<string, Point>()
        for (const c of leaders) {
          const from = start.get(c.id)
          if (!from) continue
          const d = { x: c.position!.x - from.x, y: c.position!.y - from.y }
          for (const f of followersOf(model, c.id)) if (!leaders.some((l) => l.id === f) && start.has(f)) moveTo.set(f, { x: start.get(f)!.x + d.x, y: start.get(f)!.y + d.y })
        }
        if (moveTo.size) next = next.map((n) => (moveTo.has(n.id) ? { ...n, position: moveTo.get(n.id)! } : n))
      }
      return next
    })
    const sel = changes.filter((c) => c.type === 'select')
    if (sel.length) {
      const s = new Set(useEditor.getState().selection)
      for (const c of sel) c.selected ? s.add(c.id) : s.delete(c.id)
      useEditor.getState().select([...s])
    }
  }

  const place = (clientX: number, clientY: number, keep: boolean) => {
    const at = flow.screenToFlowPosition({ x: clientX, y: clientY })
    const { apply } = useEditor.getState()
    let id: string | null = null
    const ok = apply((m) => {
      if (tool.id === 'pool') id = addPool(m, { x: at.x - POOL_HEADER / 2, y: at.y - 20 }).id
      else if ('spec' in tool) id = addNode(m, tool.spec, at).id
    })
    if (ok && id) useEditor.setState({ selection: [id], focusName: id, ...(keep ? {} : { tool: { id: 'select' } }) })
  }

  const onConnect = (c: Connection) => {
    let id: string | null = null
    if (useEditor.getState().apply((m) => void (id = connect(m, c.source, c.target).id)) && id) useEditor.getState().select([id])
  }

  // Dropped on a shape but not on one of its dots, or on a pool: connect to what is under the pointer.
  const onConnectEnd = (e: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode) return
    const pt = 'changedTouches' in e ? e.changedTouches[0] : e
    const target = elementAt(model, flow.screenToFlowPosition({ x: pt.clientX, y: pt.clientY }))
    if (target && target !== state.fromNode.id) onConnect({ source: state.fromNode.id, target, sourceHandle: null, targetHandle: null })
  }

  return (
    <div
      className={`canvas-wrap${tool.id !== 'select' ? ' is-placing' : ''}`}
      onDoubleClick={(e) => {
        // Double-click on the empty canvas adds a task there.
        if (tool.id === 'select' && (e.target as HTMLElement).classList.contains('react-flow__pane')) {
          const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
          let id: string | null = null
          if (useEditor.getState().apply((m) => void (id = addNode(m, { type: 'task' }, at).id)) && id) useEditor.setState({ selection: [id], focusName: id })
        }
      }}
    >
      <EdgeMarkers />
      <Palette />
      {model.nodes.length === 0 && model.participants.length === 0 && (
        <div className="canvas-hint">Pick a shape on the left (or press its key), then click here. Double-click adds a task. Or open an example.</div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={(changes) => {
          const sel = changes.filter((c) => c.type === 'select')
          if (!sel.length) return
          const s = new Set(useEditor.getState().selection)
          for (const c of sel) c.selected ? s.add(c.id) : s.delete(c.id)
          useEditor.getState().select([...s])
        }}
        onNodeDragStart={(_, __, dragged) => {
          const start = new Map<string, Point>()
          for (const n of nodes) start.set(n.id, n.position)
          drag.current = new Map([...start].filter(([id]) => dragged.some((d) => d.id === id || followersOf(model, d.id).includes(id))))
        }}
        onNodeDragStop={(_, __, dragged) => {
          const start = drag.current
          drag.current = null
          const to: Record<string, Point> = {}
          for (const d of dragged) {
            const from = start?.get(d.id)
            if (from && (from.x !== d.position.x || from.y !== d.position.y)) to[d.id] = d.position
          }
          if (Object.keys(to).length) useEditor.getState().apply((m) => moveElements(m, to))
          else setNodes(toNodes(model, selected))
        }}
        onPaneClick={(e) => {
          if (tool.id !== 'select') place(e.clientX, e.clientY, e.shiftKey)
        }}
        onNodeClick={(e) => {
          // Pools and lanes are clicked by their header: placing there still drops the element at the pointer.
          if (tool.id !== 'select') place(e.clientX, e.clientY, e.shiftKey)
        }}
        onNodeDoubleClick={(_, n) => useEditor.setState({ focusName: n.id })}
        onEdgeDoubleClick={(_, ed) => useEditor.setState({ selection: [ed.id], focusName: ed.id })}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={24}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Control', 'Meta']}
        // A selected expanded sub-process must stay under its steps.
        elevateNodesOnSelect={false}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.08 }}
        minZoom={0.1}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false}>
          <UndoRedo />
        </Controls>
      </ReactFlow>
    </div>
  )
}

function UndoRedo() {
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  return (
    <>
      <ControlButton onClick={() => useEditor.getState().undo()} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
        <Undo2 size={14} />
      </ControlButton>
      <ControlButton onClick={() => useEditor.getState().redo()} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
        <Redo2 size={14} />
      </ControlButton>
    </>
  )
}
