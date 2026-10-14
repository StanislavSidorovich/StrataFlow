// FlowModel → BPMN 2.0 XML with diagram interchange (DI). Serialising is bpmn-moddle's `toXML`; the
// mapping is ours and mirrors read.ts, so read(write(m)) gives m back (tests/bpmn-roundtrip.test.ts).
// Choices made for Bizagi and bpmn.io:
// - pools → a collaboration; a pool with steps gets a process named after it; a black-box pool none;
// - lanes list every flow node in them (flowNodeRef), also the ones inside a sub-process;
// - lane bounds are absolute (the standard; Bizagi itself writes x relative to the pool);
// - a flow without stored waypoints is routed between the facing sides of its ends, as the canvas draws it;
// - the content of a collapsed sub-process is drawn in a diagram of its own, as bpmn.io does.
import { BpmnModdle } from 'bpmn-moddle'
import { isArtifact, type Bounds, type EventTrigger, type Flow, type FlowModel, type FlowNode, type GatewayKind, type Lane, type Point, type TaskKind } from '../metamodel'

type El = any

const TASKS: Record<TaskKind, string> = {
  task: 'bpmn:Task',
  user: 'bpmn:UserTask',
  service: 'bpmn:ServiceTask',
  manual: 'bpmn:ManualTask',
  send: 'bpmn:SendTask',
  receive: 'bpmn:ReceiveTask',
  script: 'bpmn:ScriptTask',
  businessRule: 'bpmn:BusinessRuleTask',
}

const GATEWAYS: Record<GatewayKind, string> = {
  exclusive: 'bpmn:ExclusiveGateway',
  parallel: 'bpmn:ParallelGateway',
  inclusive: 'bpmn:InclusiveGateway',
  eventBased: 'bpmn:EventBasedGateway',
  complex: 'bpmn:ComplexGateway',
}

const TRIGGERS: Record<Exclude<EventTrigger, 'none'>, string> = {
  message: 'bpmn:MessageEventDefinition',
  timer: 'bpmn:TimerEventDefinition',
  error: 'bpmn:ErrorEventDefinition',
  signal: 'bpmn:SignalEventDefinition',
  conditional: 'bpmn:ConditionalEventDefinition',
  escalation: 'bpmn:EscalationEventDefinition',
  terminate: 'bpmn:TerminateEventDefinition',
  link: 'bpmn:LinkEventDefinition',
  compensation: 'bpmn:CompensateEventDefinition',
}

export async function writeBpmn(m: FlowModel): Promise<string> {
  const moddle = new BpmnModdle()
  const make = (type: string, attrs: object = {}): El => moddle.create(type, attrs)

  // Ids we add must not clash with the model's.
  const used = new Set<string>([...m.participants.flatMap((p) => [p.id, p.processId ?? '']), ...m.lanes.map((l) => l.id), ...m.nodes.map((n) => n.id), ...m.flows.map((f) => f.id)])
  const fresh = (base: string) => {
    let id = base
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`
    used.add(id)
    return id
  }

  const defs = make('bpmn:Definitions', { id: fresh('Definitions_1'), targetNamespace: 'http://quaera.app/strataflow', exporter: 'StrataFlow', exporterVersion: '0.2', rootElements: [], diagrams: [] })
  const el = new Map<string, El>() // model id → semantic element
  const node = (id: string) => m.nodes.find((n) => n.id === id)

  // ---------------------------------------------------------------- processes and pools
  const processOf = new Map<string | undefined, El>() // participant id (undefined = no pool) → process
  const collaboration = m.participants.length ? make('bpmn:Collaboration', { id: fresh('Collaboration_1'), name: m.name || undefined, participants: [], messageFlows: [], artifacts: [] }) : undefined
  const newProcess = (id: string, name: string) => {
    const p = make('bpmn:Process', { id, name: name || undefined, isExecutable: false, flowElements: [], artifacts: [], laneSets: [] })
    defs.rootElements.push(p)
    return p
  }
  for (const pool of m.participants) {
    const holdsSteps = m.nodes.some((n) => n.participantId === pool.id && !isArtifact(n))
    const procId = pool.processId ?? (holdsSteps ? fresh(`Process_${pool.id}`) : undefined)
    const proc = procId ? newProcess(procId, pool.name) : undefined
    if (proc) processOf.set(pool.id, proc)
    const p = make('bpmn:Participant', { id: pool.id, name: pool.name || undefined, processRef: proc })
    collaboration.participants.push(p)
    el.set(pool.id, p)
  }
  const free = m.nodes.filter((n) => !n.participantId || !processOf.has(n.participantId))
  // Steps outside every pool go into a process of their own; a loose annotation can sit in the collaboration.
  if (!m.participants.length || free.some((n) => n.type !== 'annotation'))
    processOf.set(undefined, newProcess(fresh('Process_1'), m.participants.length ? '' : m.name))
  if (collaboration) defs.rootElements.push(collaboration)

  /** The list a node goes into: its sub-process, else its pool's process, else the free one. */
  const homeOf = (n: FlowNode): { flowElements: El[]; artifacts: El[] } | undefined => {
    if (n.parentId && el.has(n.parentId)) return el.get(n.parentId)
    const proc = processOf.get(n.participantId && processOf.has(n.participantId) ? n.participantId : undefined)
    return proc ?? (n.type === 'annotation' ? collaboration : processOf.get(undefined))
  }

  // ---------------------------------------------------------------- lanes
  for (const [poolId, proc] of processOf) {
    if (!poolId) continue
    const own = m.lanes.filter((l) => l.participantId === poolId)
    if (!own.length) continue
    const byY = (a: Lane, b: Lane) => (m.diagram.shapes[a.id]?.y ?? 0) - (m.diagram.shapes[b.id]?.y ?? 0)
    const laneSet = (parent: string | undefined, id: string): El =>
      make('bpmn:LaneSet', {
        id: fresh(id),
        lanes: own
          .filter((l) => l.parentLaneId === parent)
          .sort(byY)
          .map((l) => {
            const lane = make('bpmn:Lane', { id: l.id, name: l.name || undefined, flowNodeRef: [] })
            el.set(l.id, lane)
            if (own.some((c) => c.parentLaneId === l.id)) lane.childLaneSet = laneSet(l.id, `LaneSet_${l.id}`)
            return lane
          }),
      })
    proc.laneSets.push(laneSet(undefined, `LaneSet_${proc.id}`))
  }

  // ---------------------------------------------------------------- nodes (containers before their content)
  const depth = (n: FlowNode): number => (n.parentId && node(n.parentId) ? 1 + depth(node(n.parentId)!) : 0)
  const ordered = [...m.nodes].sort((a, b) => depth(a) - depth(b))
  for (const n of ordered) {
    const base = { id: n.id, name: n.name || undefined }
    let e: El
    switch (n.type) {
      case 'task':
        e = make(TASKS[n.kind], base)
        break
      case 'subProcess':
        e = make('bpmn:SubProcess', { ...base, flowElements: [], artifacts: [] })
        break
      case 'gateway':
        e = make(GATEWAYS[n.kind], base)
        break
      case 'event': {
        const type =
          n.position === 'start' ? 'bpmn:StartEvent'
          : n.position === 'end' ? 'bpmn:EndEvent'
          : n.position === 'boundary' ? 'bpmn:BoundaryEvent'
          : n.throwing ? 'bpmn:IntermediateThrowEvent'
          : 'bpmn:IntermediateCatchEvent'
        e = make(type, base)
        if (n.trigger !== 'none') e.eventDefinitions = [make(TRIGGERS[n.trigger], { id: fresh(`${n.id}_def`) })]
        if (n.position === 'boundary') e.cancelActivity = n.interrupting !== false
        if (n.position === 'start' && n.interrupting === false) e.isInterrupting = false
        break
      }
      case 'dataObject': {
        const obj = make('bpmn:DataObject', { id: fresh(`${n.id}_object`), name: base.name })
        homeOf(n)?.flowElements.push(obj)
        e = make('bpmn:DataObjectReference', { ...base, dataObjectRef: obj })
        if (n.state) e.dataState = make('bpmn:DataState', { id: fresh(`${n.id}_state`), name: n.state })
        break
      }
      case 'dataStore': {
        const store = make('bpmn:DataStore', { id: fresh(`${n.id}_store`), name: base.name })
        defs.rootElements.push(store)
        e = make('bpmn:DataStoreReference', { ...base, dataStoreRef: store })
        break
      }
      case 'annotation':
        e = make('bpmn:TextAnnotation', { id: n.id, text: n.name || undefined })
        break
    }
    el.set(n.id, e)
    const home = homeOf(n)
    if (n.type === 'annotation') home?.artifacts.push(e)
    else home?.flowElements.push(e)
    if (!isArtifact(n) && n.laneId) el.get(n.laneId)?.flowNodeRef.push(e)
  }
  for (const n of m.nodes) {
    if (n.type === 'event' && n.attachedTo) el.get(n.id).attachedToRef = el.get(n.attachedTo)
  }

  // ---------------------------------------------------------------- flows
  const link = (from: El, to: El, f: El) => {
    ;(from.outgoing ??= []).push(f)
    ;(to.incoming ??= []).push(f)
  }
  for (const f of m.flows) {
    const s = el.get(f.source)
    const t = el.get(f.target)
    if (!s || !t) continue
    const sn = node(f.source)
    const tn = node(f.target)
    const base = { id: f.id, name: f.name || undefined, sourceRef: s, targetRef: t }
    if (f.kind === 'sequence') {
      const e = make('bpmn:SequenceFlow', base)
      if (f.condition) e.conditionExpression = make('bpmn:FormalExpression', { body: f.condition })
      el.set(f.id, e)
      homeOf(sn!)?.flowElements.push(e)
      link(s, t, e)
    } else if (f.kind === 'message') {
      const e = make('bpmn:MessageFlow', base)
      el.set(f.id, e)
      collaboration?.messageFlows.push(e)
    } else if (f.kind === 'data') {
      // Data → step is an input of the step; step → data an output of it.
      const input = sn && isArtifact(sn) && !(tn && isArtifact(tn))
      if (input) {
        const e = make('bpmn:DataInputAssociation', { id: f.id, sourceRef: [s] })
        ;(t.dataInputAssociations ??= []).push(e)
        el.set(f.id, e)
      } else {
        const e = make('bpmn:DataOutputAssociation', { id: f.id, targetRef: t })
        ;(s.dataOutputAssociations ??= []).push(e)
        el.set(f.id, e)
      }
    } else {
      const e = make('bpmn:Association', { id: f.id, sourceRef: s, targetRef: t })
      el.set(f.id, e)
      const holder = sn?.type === 'annotation' ? homeOf(sn) : tn?.type === 'annotation' ? homeOf(tn) : sn ? homeOf(sn) : collaboration
      ;(holder ?? collaboration ?? processOf.get(undefined)).artifacts.push(e)
    }
  }
  for (const n of m.nodes) {
    if (n.type === 'gateway' && n.defaultFlow && el.has(n.defaultFlow)) el.get(n.id).default = el.get(n.defaultFlow)
  }

  // Empty lists make empty tags in some tools: drop them.
  for (const e of [...el.values(), ...processOf.values(), collaboration, defs].filter(Boolean))
    for (const key of ['flowElements', 'artifacts', 'laneSets', 'messageFlows', 'flowNodeRef'])
      if (Array.isArray(e[key]) && !e[key].length) delete e[key]

  // ---------------------------------------------------------------- diagram interchange
  const hidden = (n: FlowNode): string | undefined => {
    // The outermost collapsed sub-process that hides the node, if any.
    let found: string | undefined
    for (let p = n.parentId ? node(n.parentId) : undefined; p; p = p.parentId ? node(p.parentId) : undefined) if (p.type === 'subProcess' && p.collapsed) found = p.id
    return found
  }
  const planes = new Map<string | undefined, El[]>([[undefined, []]]) // collapsed sub-process id → its diagram's elements
  const planeOf = (id?: string) => {
    if (!planes.has(id)) planes.set(id, [])
    return planes.get(id)!
  }
  const bounds = (b: Bounds) => make('dc:Bounds', { x: b.x, y: b.y, width: b.width, height: b.height })
  const shape = (id: string, b: Bounds, extra: object = {}) => make('bpmndi:BPMNShape', { id: fresh(`${id}_di`), bpmnElement: el.get(id), bounds: bounds(b), ...extra })

  for (const p of m.participants) if (m.diagram.shapes[p.id]) planeOf().push(shape(p.id, m.diagram.shapes[p.id], { isHorizontal: true }))
  const laneDepth = (l: Lane): number => (l.parentLaneId ? 1 + laneDepth(m.lanes.find((x) => x.id === l.parentLaneId)!) : 0)
  for (const l of [...m.lanes].sort((a, b) => laneDepth(a) - laneDepth(b)))
    if (m.diagram.shapes[l.id] && el.has(l.id)) planeOf().push(shape(l.id, m.diagram.shapes[l.id], { isHorizontal: true }))
  for (const n of ordered) {
    const b = m.diagram.shapes[n.id]
    if (!b) continue
    planeOf(hidden(n)).push(shape(n.id, b, n.type === 'subProcess' ? { isExpanded: !n.collapsed } : {}))
  }
  const boxOf = (id: string): Bounds | undefined => m.diagram.shapes[id]
  for (const f of m.flows) {
    if (!el.has(f.id)) continue
    const pts = m.diagram.edges[f.id]?.length >= 2 ? m.diagram.edges[f.id] : route(f, boxOf(f.source), boxOf(f.target), !!m.participants.find((p) => p.id === f.target), !!m.participants.find((p) => p.id === f.source))
    if (!pts) continue
    const ends = [node(f.source), node(f.target)].filter(Boolean).map((n) => hidden(n!))
    planeOf(ends.find((h) => h !== undefined) && ends.every((h) => h === ends[0]) ? ends[0] : undefined).push(
      make('bpmndi:BPMNEdge', { id: fresh(`${f.id}_di`), bpmnElement: el.get(f.id), waypoint: pts.map((p) => make('dc:Point', { x: Math.round(p.x), y: Math.round(p.y) })) }),
    )
  }
  for (const [holder, elements] of planes) {
    const owner = holder ? el.get(holder) : (collaboration ?? processOf.get(undefined))
    const plane = make('bpmndi:BPMNPlane', { id: fresh(`${owner.id}_plane`), bpmnElement: owner, planeElement: elements })
    defs.diagrams.push(make('bpmndi:BPMNDiagram', { id: fresh(holder ? `${holder}_diagram` : 'Diagram_1'), name: holder ? undefined : m.name || undefined, plane }))
  }

  const { xml } = await moddle.toXML(defs, { format: true })
  return xml
}

/** An orthogonal path between the sides of two shapes that face each other (as edges.tsx draws it). */
export function route(f: Pick<Flow, 'kind'>, s: Bounds | undefined, t: Bounds | undefined, toPool = false, fromPool = false): Point[] | undefined {
  if (!s || !t) return undefined
  const apartX = t.x >= s.x + s.width + 10 ? 1 : t.x + t.width <= s.x - 10 ? -1 : 0
  const apartY = t.y >= s.y + s.height + 10 ? 1 : t.y + t.height <= s.y - 10 ? -1 : 0
  const cy = (b: Bounds) => b.y + b.height / 2
  const cx = (b: Bounds) => b.x + b.width / 2
  if (apartX && !(f.kind === 'message' && apartY)) {
    const a = { x: apartX > 0 ? s.x + s.width : s.x, y: cy(s) }
    const b = { x: apartX > 0 ? t.x : t.x + t.width, y: cy(t) }
    const mid = Math.round((a.x + b.x) / 2)
    return a.y === b.y ? [a, b] : [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b]
  }
  const down = apartY >= 0
  const a = { x: cx(s), y: down ? s.y + s.height : s.y }
  const b = { x: cx(t), y: down ? t.y : t.y + t.height }
  // A message to or from a pool meets the pool's border straight above or below the other end.
  if (toPool) b.x = Math.min(Math.max(a.x, t.x + 40), t.x + t.width - 10)
  if (fromPool) a.x = Math.min(Math.max(b.x, s.x + 40), s.x + s.width - 10)
  const mid = Math.round((a.y + b.y) / 2)
  return a.x === b.x ? [a, b] : [a, { x: a.x, y: mid }, { x: b.x, y: mid }, b]
}
