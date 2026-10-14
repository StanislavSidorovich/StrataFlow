// BPMN 2.0 XML (with DI) → FlowModel. Parsing is bpmn-moddle's (MIT, bpmn.io); the mapping is ours.
// Tested on Bizagi Modeler 4.3 exports, which add two quirks handled below:
// - every diagram carries an empty "Main Process" pool drawn at 30,30 under the real one;
// - lane bounds have x relative to the pool (y is absolute): x = header width.
import { BpmnModdle } from 'bpmn-moddle'
import type { Bounds, EventTrigger, Flow, FlowModel, FlowNode, GatewayKind, Lane, Participant, TaskKind } from '../metamodel'

/** A moddle element: typed loosely on purpose, the reader checks `$type` itself. */
interface El {
  $type: string
  id: string
  name?: string
  [key: string]: any
}

export interface ReadResult {
  model: FlowModel
  /** Parser warnings plus what the reader skipped. */
  warnings: string[]
}

const TASKS: Record<string, TaskKind> = {
  'bpmn:Task': 'task',
  'bpmn:UserTask': 'user',
  'bpmn:ServiceTask': 'service',
  'bpmn:ManualTask': 'manual',
  'bpmn:SendTask': 'send',
  'bpmn:ReceiveTask': 'receive',
  'bpmn:ScriptTask': 'script',
  'bpmn:BusinessRuleTask': 'businessRule',
  // A call activity looks like a task with a thick border; stage 1 decides whether it gets its own kind.
  'bpmn:CallActivity': 'task',
}

const GATEWAYS: Record<string, GatewayKind> = {
  'bpmn:ExclusiveGateway': 'exclusive',
  'bpmn:ParallelGateway': 'parallel',
  'bpmn:InclusiveGateway': 'inclusive',
  'bpmn:EventBasedGateway': 'eventBased',
  'bpmn:ComplexGateway': 'complex',
}

const TRIGGERS: Record<string, EventTrigger> = {
  'bpmn:MessageEventDefinition': 'message',
  'bpmn:TimerEventDefinition': 'timer',
  'bpmn:ErrorEventDefinition': 'error',
  'bpmn:SignalEventDefinition': 'signal',
  'bpmn:ConditionalEventDefinition': 'conditional',
  'bpmn:EscalationEventDefinition': 'escalation',
  'bpmn:TerminateEventDefinition': 'terminate',
  'bpmn:LinkEventDefinition': 'link',
  'bpmn:CompensateEventDefinition': 'compensation',
}

const EVENTS: Record<string, { position: 'start' | 'intermediate' | 'end' | 'boundary'; throwing: boolean }> = {
  'bpmn:StartEvent': { position: 'start', throwing: false },
  'bpmn:EndEvent': { position: 'end', throwing: true },
  'bpmn:IntermediateCatchEvent': { position: 'intermediate', throwing: false },
  'bpmn:IntermediateThrowEvent': { position: 'intermediate', throwing: true },
  'bpmn:BoundaryEvent': { position: 'boundary', throwing: false },
}

export async function readBpmn(xml: string): Promise<ReadResult> {
  const moddle = new BpmnModdle()
  const { rootElement, warnings: parseWarnings } = await moddle.fromXML(xml)
  const defs = rootElement as unknown as El
  const warnings: string[] = parseWarnings.map((w: { message: string }) => w.message)

  const participants: Participant[] = []
  const lanes: Lane[] = []
  const nodes: FlowNode[] = []
  const flows: Flow[] = []
  const known = new Set<string>()

  const roots: El[] = defs.rootElements ?? []
  const collaboration = roots.find((r) => r.$type === 'bpmn:Collaboration')
  const processes = roots.filter((r) => r.$type === 'bpmn:Process')
  const messageFlows: El[] = collaboration?.messageFlows ?? []

  // Pools. Bizagi's empty "Main Process" pool is dropped unless something points at it.
  const poolOf = new Map<string, string>() // process id → participant id
  const referenced = new Set(messageFlows.flatMap((m) => [m.sourceRef?.id, m.targetRef?.id]))
  for (const p of (collaboration?.participants ?? []) as El[]) {
    const proc = p.processRef as El | undefined
    const empty = proc && !(proc.flowElements?.length || proc.artifacts?.length)
    if (empty && !referenced.has(p.id)) continue
    participants.push({ id: p.id, name: p.name ?? '', processId: empty ? undefined : proc?.id })
    known.add(p.id)
    if (proc && !empty) poolOf.set(proc.id, p.id)
  }

  for (const proc of processes) {
    const participantId = poolOf.get(proc.id)
    if (!participantId && !proc.flowElements?.length) continue

    const laneOf = new Map<string, string>()
    const walkLanes = (laneSets: El[] | undefined, parentLaneId?: string) => {
      for (const set of laneSets ?? [])
        for (const lane of (set.lanes ?? []) as El[]) {
          lanes.push({ id: lane.id, name: lane.name ?? '', participantId, parentLaneId })
          known.add(lane.id)
          for (const ref of (lane.flowNodeRef ?? []) as El[]) laneOf.set(ref.id, lane.id)
          walkLanes(lane.childLaneSet ? [lane.childLaneSet] : undefined, lane.id)
        }
    }
    walkLanes(proc.laneSets)

    const walk = (elements: El[], parentId?: string) => {
      for (const el of elements) {
        const base = { id: el.id, name: (el.name ?? '').trim(), participantId, laneId: laneOf.get(el.id), parentId }
        const t = el.$type
        if (t in TASKS) nodes.push({ ...base, type: 'task', kind: TASKS[t] })
        else if (t in GATEWAYS) nodes.push({ ...base, type: 'gateway', kind: GATEWAYS[t], defaultFlow: el.default?.id })
        else if (t in EVENTS) {
          const defsOf = (el.eventDefinitions ?? []) as El[]
          // Several definitions = a multiple event; stage 0 shows the first one.
          const trigger = defsOf.length ? (TRIGGERS[defsOf[0].$type] ?? 'none') : 'none'
          const { position, throwing } = EVENTS[t]
          nodes.push({
            ...base,
            type: 'event',
            position,
            trigger,
            throwing,
            interrupting: t === 'bpmn:BoundaryEvent' ? el.cancelActivity !== false : t === 'bpmn:StartEvent' ? el.isInterrupting !== false : undefined,
            attachedTo: el.attachedToRef?.id,
          })
        } else if (t === 'bpmn:SubProcess' || t === 'bpmn:Transaction' || t === 'bpmn:AdHocSubProcess') {
          nodes.push({ ...base, type: 'subProcess', collapsed: true })
          walk(el.flowElements ?? [], el.id)
          walk(el.artifacts ?? [], el.id)
        } else if (t === 'bpmn:DataObjectReference') nodes.push({ ...base, name: base.name || (el.dataObjectRef?.name ?? ''), type: 'dataObject', state: el.dataState?.name || undefined })
        else if (t === 'bpmn:DataStoreReference') nodes.push({ ...base, name: base.name || (el.dataStoreRef?.name ?? ''), type: 'dataStore' })
        else if (t === 'bpmn:TextAnnotation') nodes.push({ ...base, name: (el.text ?? '').trim(), type: 'annotation' })
        else if (t === 'bpmn:SequenceFlow') {
          flows.push({ id: el.id, kind: 'sequence', source: el.sourceRef?.id, target: el.targetRef?.id, name: base.name, condition: el.conditionExpression?.body?.trim() || undefined })
          continue
        } else if (t === 'bpmn:Association') {
          flows.push({ id: el.id, kind: 'association', source: el.sourceRef?.id, target: el.targetRef?.id, name: '' })
          continue
        } else if (t === 'bpmn:DataObject' || t === 'bpmn:Group') continue // the reference carries the shape; groups come later
        else {
          warnings.push(`Skipped ${t.replace('bpmn:', '')} "${base.name || el.id}"`)
          continue
        }
        known.add(el.id)
        // Data associations hang on the activity, not in the flow element list.
        for (const a of (el.dataInputAssociations ?? []) as El[])
          for (const src of (a.sourceRef ?? []) as El[]) flows.push({ id: a.id, kind: 'data', source: src.id, target: el.id, name: '' })
        for (const a of (el.dataOutputAssociations ?? []) as El[])
          if (a.targetRef) flows.push({ id: a.id, kind: 'data', source: el.id, target: a.targetRef.id, name: '' })
      }
    }
    walk(proc.flowElements ?? [])
    walk(proc.artifacts ?? [])
  }

  for (const m of messageFlows) flows.push({ id: m.id, kind: 'message', source: m.sourceRef?.id, target: m.targetRef?.id, name: (m.name ?? '').trim() })
  for (const a of (collaboration?.artifacts ?? []) as El[]) {
    if (a.$type === 'bpmn:TextAnnotation') {
      nodes.push({ id: a.id, name: (a.text ?? '').trim(), type: 'annotation' })
      known.add(a.id)
    } else if (a.$type === 'bpmn:Association') flows.push({ id: a.id, kind: 'association', source: a.sourceRef?.id, target: a.targetRef?.id, name: '' })
  }

  const kept = flows.filter((f) => known.has(f.source) && known.has(f.target))
  for (const f of flows) if (!kept.includes(f)) warnings.push(`Skipped ${f.kind} flow ${f.id}: an end is not in the model`)

  // Diagram interchange: the first diagram only (Bizagi writes one file per diagram).
  const shapes: FlowModel['diagram']['shapes'] = {}
  const edges: FlowModel['diagram']['edges'] = {}
  const keptIds = new Set(kept.map((f) => f.id))
  const plane = (defs.diagrams?.[0] as El | undefined)?.plane as El | undefined
  for (const d of (plane?.planeElement ?? []) as El[]) {
    const ref = (d.bpmnElement as El | undefined)?.id
    if (!ref || !(known.has(ref) || keptIds.has(ref))) continue
    if (d.$type === 'bpmndi:BPMNShape' && d.bounds) {
      const { x, y, width, height } = d.bounds as Bounds
      shapes[ref] = { x, y, width, height, ...(d.isExpanded ? { expanded: true } : {}) }
    } else if (d.$type === 'bpmndi:BPMNEdge') edges[ref] = ((d.waypoint ?? []) as El[]).map((p) => ({ x: p.x, y: p.y }))
  }
  for (const lane of lanes) {
    const pool = lane.participantId ? shapes[lane.participantId] : undefined
    const s = shapes[lane.id]
    // Lanes are flush with the pool's right edge in every tool; this also undoes Bizagi's relative x.
    if (pool && s && s.width <= pool.width) s.x = pool.x + pool.width - s.width
  }
  for (const n of nodes) if (n.type === 'subProcess' && shapes[n.id]?.expanded) n.collapsed = false

  const name = (collaboration?.name || processes.find((p) => poolOf.has(p.id))?.name || '').trim()
  return {
    model: { format: 'strata-flow', version: 1, name, participants, lanes, nodes, flows: kept, diagram: { shapes, edges } },
    warnings,
  }
}
