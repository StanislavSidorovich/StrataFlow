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
import { ArrowLeft, Redo2, Undo2 } from 'lucide-react'
import type { FlowModel, Point } from '../../core/metamodel'
import { POOL_HEADER } from '../../core/metamodel'
import { addNode, addPool, connect, ModelError, moveElements, nodeOf, pageOf, withDescendants } from '../../core/ops'
import type { Severity } from '../../core/lint'
import { useIssues } from '../panels/Check'
import { useSim } from '../panels/Simulate'
import { useEditor } from '../store'
import { ContextMenu } from './ContextMenu'
import { BpmnEdge, EdgeMarkers, type FlowEdge } from './edges'
import { BpmnShape, PoolShape, type PoolNode, type ShapeNode } from './nodes'
import { Palette } from './Palette'

type AnyNode = ShapeNode | PoolNode

const nodeTypes = { shape: BpmnShape, pool: PoolShape }
const edgeTypes = { flow: BpmnEdge }

/** What is drawn on a page: the main process (page null) or a collapsed sub-process's steps, as in Bizagi. */
function shownOn(model: FlowModel, page: string | null): Set<string> {
  const out = new Set<string>()
  for (const n of model.nodes) {
    // A boundary event is drawn with its host.
    const at = n.type === 'event' && n.attachedTo ? pageOf(model, n.attachedTo) : pageOf(model, n.id)
    if ((at ?? null) === page) out.add(n.id)
  }
  if (!page) for (const x of [...model.participants, ...model.lanes]) out.add(x.id)
  return out
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

function toNodes(model: FlowModel, selected: Set<string>, page: string | null, marks: Map<string, Severity> = new Map(), tokens: Set<string> = new Set()): AnyNode[] {
  const { shapes } = model.diagram
  const shown = shownOn(model, page)
  const out: AnyNode[] = []
  // An issue inside a collapsed sub-process marks the sub-process on this page.
  const mark = new Map<string, Severity>()
  for (const [id, sev] of marks) {
    let at: string | undefined = id
    while (at && !shown.has(at)) at = pageOf(model, at)
    if (at && (!mark.has(at) || RANK[sev] < RANK[mark.get(at)!])) mark.set(at, sev)
  }
  // A token inside a collapsed sub-process shows on the sub-process.
  const token = new Set<string>()
  for (const id of tokens) {
    let at: string | undefined = id
    while (at && !shown.has(at)) at = pageOf(model, at)
    if (at) token.add(at)
  }
  for (const p of model.participants) {
    if (!shown.has(p.id)) continue
    const s = shapes[p.id]
    if (!s) continue
    const lanes = model.lanes.filter((l) => l.participantId === p.id && !l.parentLaneId && shapes[l.id])
    const header = lanes.length ? Math.max(POOL_HEADER, s.width - Math.max(...lanes.map((l) => shapes[l.id].width))) : POOL_HEADER
    out.push({ id: p.id, type: 'pool', position: { x: s.x, y: s.y }, width: s.width, height: s.height, data: { name: p.name, header }, dragHandle: '.bpmn-pool-header', selected: selected.has(p.id), className: 'pool-node', zIndex: 0 })
  }
  for (const l of model.lanes) {
    const s = shapes[l.id]
    if (!s || !shown.has(l.id)) continue
    out.push({ id: l.id, type: 'pool', position: { x: s.x, y: s.y }, width: s.width, height: s.height, data: { name: l.name, header: POOL_HEADER, lane: true }, draggable: false, selected: selected.has(l.id), className: 'pool-node', zIndex: 0 })
  }
  for (const el of model.nodes) {
    const s = shapes[el.id]
    if (!s || !shown.has(el.id)) continue
    // An expanded sub-process sits under its content.
    const z = el.type === 'event' && el.position === 'boundary' ? 4 : el.type === 'subProcess' && !el.collapsed ? 1 : 2
    out.push({ id: el.id, type: 'shape', position: { x: s.x, y: s.y }, width: s.width, height: s.height, data: { el, issue: mark.get(el.id), token: token.has(el.id) }, selected: selected.has(el.id), zIndex: z })
  }
  return out
}

function toEdges(model: FlowModel, selected: Set<string>, page: string | null, passed: Set<string> = new Set()): FlowEdge[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  const shown = shownOn(model, page)
  return model.flows.filter((f) => shown.has(f.source) && shown.has(f.target)).map((f) => {
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
        passed: passed.has(f.id),
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
// Fit view leaves room for the draw bar on the left and the zoom buttons at the bottom, so neither covers the process.
const FIT = { maxZoom: 1, padding: { top: '24px', right: '24px', bottom: '56px', left: '76px' } } as const

function elementAt(model: FlowModel, p: Point, page: string | null): string | undefined {
  const shown = shownOn(model, page)
  const hit = (id: string) => {
    const s = shown.has(id) && model.diagram.shapes[id]
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
  const linkFrom = useEditor((s) => s.linkFrom)
  const selected = useMemo(() => new Set(selection), [selection])
  const page = useEditor((s) => s.page)
  const checkOpen = useEditor((s) => s.checkOpen)
  const issues = useIssues()
  // With the Check panel open, shapes with an issue carry a mark (worst severity first).
  const marks = useMemo(() => {
    const out = new Map<string, Severity>()
    if (checkOpen)
      for (const i of issues) for (const id of i.elements) if (!out.has(id) || RANK[i.severity] < RANK[out.get(id)!]) out.set(id, i.severity)
    return out
  }, [checkOpen, issues])
  const play = useSim((s) => (s.open ? s.play : null))
  const tokens = useMemo(() => new Set(play ? [...play.tokens.map((t) => t.at), ...Object.keys(play.waiting)] : []), [play])
  const passed = useMemo(() => new Set(play?.passed ?? []), [play])
  const [nodes, setNodes] = useState<AnyNode[]>(() => toNodes(model, selected, page, marks, tokens))
  useEffect(() => setNodes(toNodes(model, selected, page, marks, tokens)), [model, selected, page, marks, tokens])
  const edges = useMemo(() => toEdges(model, selected, page, passed), [model, selected, page, passed])
  const flow = useReactFlow()
  const fit = useEditor((s) => s.fit)
  useEffect(() => {
    if (fit) requestAnimationFrame(() => void flow.fitView({ ...FIT, duration: 300 }))
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
      if (tool.id === 'pool') {
        if (page) throw new ModelError('A sub-process has no pools: go back to the process to add one')
        id = addPool(m, { x: at.x - POOL_HEADER / 2, y: at.y - 20 }).id
      } else if ('spec' in tool) id = addNode(m, tool.spec, at, '', page ?? undefined).id
    })
    if (ok && id) useEditor.setState({ selection: [id], focusName: id, ...(keep ? {} : { tool: { id: 'select' } }) })
  }

  const onConnect = (c: Connection) => {
    // A tap on two dots of one shape (touch screens: a tap on a dot starts a connection) is not a flow.
    if (c.source === c.target) return
    let id: string | null = null
    if (useEditor.getState().apply((m) => void (id = connect(m, c.source, c.target).id)) && id) useEditor.getState().select([id])
  }

  // Connect mode: the shape (or pool) tapped ends the flow; a tap on the empty canvas or on the start shape cancels.
  const linkTo = (clientX: number, clientY: number) => {
    const from = useEditor.getState().linkFrom
    useEditor.setState({ linkFrom: null, message: null })
    const target = elementAt(model, flow.screenToFlowPosition({ x: clientX, y: clientY }), page)
    if (from && target && target !== from) onConnect({ source: from, target, sourceHandle: null, targetHandle: null })
  }

  // Dropped on a shape but not on one of its dots, or on a pool: connect to what is under the pointer.
  const onConnectEnd = (e: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode) return
    const pt = 'changedTouches' in e ? e.changedTouches[0] : e
    const target = elementAt(model, flow.screenToFlowPosition({ x: pt.clientX, y: pt.clientY }), page)
    if (target && target !== state.fromNode.id) onConnect({ source: state.fromNode.id, target, sourceHandle: null, targetHandle: null })
  }

  // Right-click (as in Bizagi): on a selected element the menu is for the whole selection, on another one
  // for that one (it gets selected), on the empty canvas for the point clicked.
  const openMenu = (e: React.MouseEvent | MouseEvent, id: string | null) => {
    e.preventDefault()
    const s = useEditor.getState()
    let ids: string[] = []
    if (id) {
      ids = s.selection.includes(id) ? s.selection : [id]
      if (!s.selection.includes(id)) s.select([id])
    }
    s.openMenu({ x: e.clientX, y: e.clientY, ids, at: flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }), kind: 'full' })
  }

  return (
    <div
      // No browser menu anywhere on the canvas: ours opens instead (or nothing, on the controls).
      onContextMenu={(e) => e.preventDefault()}
      className={`canvas-wrap${tool.id !== 'select' || linkFrom ? ' is-placing' : ''}`}
      onDoubleClick={(e) => {
        // Double-click on the empty canvas adds a task there.
        if (tool.id === 'select' && (e.target as HTMLElement).classList.contains('react-flow__pane')) {
          const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
          let id: string | null = null
          if (useEditor.getState().apply((m) => void (id = addNode(m, { type: 'task' }, at, '', page ?? undefined).id)) && id) useEditor.setState({ selection: [id], focusName: id })
        }
      }}
    >
      <EdgeMarkers />
      <Palette />
      {page && <PagePath model={model} page={page} />}
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
          else setNodes(toNodes(model, selected, page, marks))
        }}
        onPaneClick={(e) => {
          if (linkFrom) linkTo(e.clientX, e.clientY)
          else if (tool.id !== 'select') place(e.clientX, e.clientY, e.shiftKey)
        }}
        onNodeClick={(e) => {
          if (linkFrom) linkTo(e.clientX, e.clientY)
          // Pools and lanes are clicked by their header: placing there still drops the element at the pointer.
          else if (tool.id !== 'select') place(e.clientX, e.clientY, e.shiftKey)
        }}
        onNodeDoubleClick={(_, n) => {
          // A collapsed sub-process opens its page (Bizagi: Edit Sub-Process); anything else: type its name.
          const el = nodeOf(model, n.id)
          if (el?.type === 'subProcess' && el.collapsed) useEditor.getState().openPage(el.id)
          else useEditor.setState({ focusName: n.id })
        }}
        onEdgeDoubleClick={(_, ed) => useEditor.setState({ selection: [ed.id], focusName: ed.id })}
        onNodeContextMenu={(e, n) => openMenu(e, n.id)}
        onEdgeContextMenu={(e, ed) => openMenu(e, ed.id)}
        onPaneContextMenu={(e) => openMenu(e, null)}
        onSelectionContextMenu={(e) => openMenu(e, useEditor.getState().selection[0] ?? null)}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={24}
        // A tap on a dot must not start a connection (touch): the pad's arrow does that.
        connectOnClick={false}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Control', 'Meta']}
        // A selected expanded sub-process must stay under its steps.
        elevateNodesOnSelect={false}
        fitView
        fitViewOptions={FIT}
        minZoom={0.1}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false}>
          <UndoRedo />
        </Controls>
      </ReactFlow>
      <ContextMenu />
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

/** Where the page sits: the process, then each collapsed sub-process down to this one (Bizagi shows tabs). */
function PagePath({ model, page }: { model: FlowModel; page: string }) {
  const chain: string[] = []
  for (let p: string | undefined = page; p; p = pageOf(model, p)) chain.unshift(p)
  const open = useEditor((s) => s.openPage)
  return (
    <nav className="page-path" aria-label="Sub-process pages" data-testid="page-path">
      <button className="btn" onClick={() => open(null)} title="Back to the process">
        <ArrowLeft size={14} /> {model.name || 'Process'}
      </button>
      {chain.map((id) => (
        <span key={id}>
          <span className="muted"> › </span>
          <button className="btn" onClick={() => open(id)} disabled={id === page}>
            {nodeOf(model, id)?.name || 'Sub-process'}
          </button>
        </span>
      ))}
    </nav>
  )
}
