// Stage 0 spike: shows a FlowModel on React Flow at its DI coordinates. Shapes can be moved;
// flows touching a moved shape drop their waypoints and route orthogonally.
import { useEffect, useMemo, useState } from 'react'
import { applyNodeChanges, Background, Controls, ReactFlow, type NodeChange } from '@xyflow/react'
import type { FlowModel } from '../../core/metamodel'
import { BpmnShape, PoolShape, type PoolNode, type ShapeNode } from './nodes'
import { BpmnEdge, EdgeMarkers, type FlowEdge } from './edges'

type AnyNode = ShapeNode | PoolNode

const nodeTypes = { shape: BpmnShape, pool: PoolShape }
const edgeTypes = { flow: BpmnEdge }
const HEADER = 30

function toNodes(model: FlowModel): AnyNode[] {
  const { shapes } = model.diagram
  const out: AnyNode[] = []
  for (const p of model.participants) {
    const s = shapes[p.id]
    if (!s) continue
    const lanes = model.lanes.filter((l) => l.participantId === p.id && !l.parentLaneId && shapes[l.id])
    const header = lanes.length ? Math.max(HEADER, s.width - Math.max(...lanes.map((l) => shapes[l.id].width))) : HEADER
    out.push({ id: p.id, type: 'pool', position: { x: s.x, y: s.y }, width: s.width, height: s.height, data: { name: p.name, header }, draggable: false, selectable: false, className: 'pool-node', zIndex: 0 })
  }
  for (const l of model.lanes) {
    const s = shapes[l.id]
    if (!s) continue
    out.push({ id: l.id, type: 'pool', position: { x: s.x, y: s.y }, width: s.width, height: s.height, data: { name: l.name, header: HEADER, lane: true }, draggable: false, selectable: false, className: 'pool-node', zIndex: 0 })
  }
  for (const el of model.nodes) {
    const s = shapes[el.id]
    if (!s) continue
    out.push({ id: el.id, type: 'shape', position: { x: s.x, y: s.y }, width: s.width, height: s.height, data: { el }, zIndex: el.type === 'event' && el.position === 'boundary' ? 3 : 2 })
  }
  return out
}

function toEdges(model: FlowModel, moved: Set<string>): FlowEdge[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  return model.flows.map((f) => {
    const src = byId.get(f.source)
    return {
      id: f.id,
      type: 'flow',
      source: f.source,
      target: f.target,
      zIndex: 1,
      data: {
        kind: f.kind,
        name: f.name,
        points: moved.has(f.source) || moved.has(f.target) ? undefined : model.diagram.edges[f.id],
        isDefault: src?.type === 'gateway' && src.defaultFlow === f.id,
        conditional: !!f.condition && src?.type !== 'gateway',
      },
    }
  })
}

export function Canvas({ model }: { model: FlowModel }) {
  const [nodes, setNodes] = useState<AnyNode[]>(() => toNodes(model))
  const [moved, setMoved] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setNodes(toNodes(model))
    setMoved(new Set())
  }, [model])
  const edges = useMemo(() => toEdges(model, moved), [model, moved])

  const onNodesChange = (changes: NodeChange<AnyNode>[]) => {
    const dragged = changes.flatMap((c) => (c.type === 'position' && c.dragging ? [c.id] : []))
    if (dragged.length) setMoved((m) => (dragged.every((id) => m.has(id)) ? m : new Set([...m, ...dragged])))
    setNodes((ns) => applyNodeChanges(changes, ns))
  }

  return (
    <div className="canvas-wrap">
      <EdgeMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.08 }}
        minZoom={0.1}
        proOptions={{ hideAttribution: false }}
        nodesConnectable={false}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
