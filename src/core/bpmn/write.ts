// FlowModel → BPMN 2.0 XML with diagram interchange (DI). Serialising is bpmn-moddle's `toXML`; the
// mapping is ours and mirrors read.ts, so read(write(m)) gives m back (tests/bpmn-roundtrip.test.ts).
// Choices made so that both Bizagi Modeler 4.3 and bpmn.io open the file as drawn (checked by the owner):
// - pools → a collaboration; every pool gets a process named after it, empty for a black box (Bizagi drops
//   a pool without one); a process without steps reads back as a black box;
// - lanes list every flow node in them (flowNodeRef), also the ones inside a sub-process;
// - the drawing is shifted so the leftmost pool sits at x = 0: lane x is absolute for bpmn.io and relative
//   to the pool for Bizagi, and the two agree there;
// - a data object is a DataObjectReference only (Bizagi draws a bare DataObject a second time); a data
//   association also gets a plain association along the same line, which is what Bizagi draws;
// - labels of events, gateways, data and flows get bounds where the canvas shows them;
// - a flow without stored waypoints is routed between the facing sides of its ends, as the canvas draws it;
// - the content of a collapsed sub-process is drawn in a diagram of its own, as bpmn.io does.
import { BpmnModdle } from 'bpmn-moddle'
import { route } from '../routing'
import { isArtifact, type Bounds, type EventTrigger, type FlowModel, type FlowNode, type GatewayKind, type Lane, type LoopKind, type Point, type TaskKind } from '../metamodel'

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

/** Namespace of StrataFlow's analysis attributes in BPMN XML (prefix sf). */
export const SIM_NS = 'https://flow.quaera.app/ns/sim'

export async function writeBpmn(m: FlowModel): Promise<string> {
  const moddle = new BpmnModdle()
  const make = (type: string, attrs: object = {}): El => moddle.create(type, attrs)
  const loopMarker = (l: LoopKind) =>
    l === 'standard' ? make('bpmn:StandardLoopCharacteristics') : make('bpmn:MultiInstanceLoopCharacteristics', l === 'sequential' ? { isSequential: true } : {})

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
    const proc = newProcess(pool.processId ?? fresh(`Process_${pool.id}`), pool.name)
    processOf.set(pool.id, proc)
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
        if (n.loop) e.loopCharacteristics = loopMarker(n.loop)
        break
      case 'subProcess':
        e = make('bpmn:SubProcess', { ...base, flowElements: [], artifacts: [] })
        if (n.loop) e.loopCharacteristics = loopMarker(n.loop)
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
        e = make('bpmn:DataObjectReference', base)
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
  const lines = new Map<string, El>() // data flow id → the association Bizagi draws for it
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
      const line = make('bpmn:Association', { id: fresh(`${f.id}_line`), sourceRef: s, targetRef: t, associationDirection: 'One' })
      lines.set(f.id, line)
      const home = sn && !isArtifact(sn) ? homeOf(sn) : tn ? homeOf(tn) : undefined
      ;(home ?? collaboration ?? processOf.get(undefined)).artifacts.push(line)
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

  // Figures for the analysis: StrataFlow's own attributes (other tools keep or ignore them).
  const put = (e: El, key: string, v: number | string | undefined) => {
    if (v === undefined || !e) return
    e.$attrs[`sf:${key}`] = String(v)
    defs.$attrs['xmlns:sf'] = SIM_NS
  }
  for (const n of m.nodes) for (const [k, v] of Object.entries(n.sim ?? {})) put(el.get(n.id), k, v)
  for (const f of m.flows) put(el.get(f.id), 'probability', f.probability)
  for (const l of m.lanes) put(el.get(l.id), 'capacity', l.capacity)
  put(defs, 'timeUnit', m.sim?.unit)
  put(defs, 'arrivals', m.sim?.arrivals)

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
  const poolX = m.participants.flatMap((p) => (m.diagram.shapes[p.id] ? [m.diagram.shapes[p.id].x] : []))
  const shift = poolX.length ? -Math.min(...poolX) : 0
  const bounds = (b: Bounds) => make('dc:Bounds', { x: b.x + shift, y: b.y, width: b.width, height: b.height })
  const label = (b: Bounds | undefined) => (b ? { label: make('bpmndi:BPMNLabel', { bounds: bounds(b) }) } : {})
  const shape = (id: string, b: Bounds, extra: object = {}) => {
    const n = node(id)
    return make('bpmndi:BPMNShape', { id: fresh(`${id}_di`), bpmnElement: el.get(id), bounds: bounds(b), ...(n ? label(outerLabel(n, b)) : {}), ...extra })
  }

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
    const plane = planeOf(ends.find((h) => h !== undefined) && ends.every((h) => h === ends[0]) ? ends[0] : undefined)
    const waypoint = () => pts.map((p) => make('dc:Point', { x: Math.round(p.x) + shift, y: Math.round(p.y) }))
    plane.push(make('bpmndi:BPMNEdge', { id: fresh(`${f.id}_di`), bpmnElement: el.get(f.id), waypoint: waypoint(), ...label(flowLabel(f.name, pts)) }))
    const line = lines.get(f.id)
    if (line) plane.push(make('bpmndi:BPMNEdge', { id: fresh(`${line.id}_di`), bpmnElement: line, waypoint: waypoint() }))
  }
  for (const [holder, elements] of planes) {
    const owner = holder ? el.get(holder) : (collaboration ?? processOf.get(undefined))
    const plane = make('bpmndi:BPMNPlane', { id: fresh(`${owner.id}_plane`), bpmnElement: owner, planeElement: elements })
    defs.diagrams.push(make('bpmndi:BPMNDiagram', { id: fresh(holder ? `${holder}_diagram` : 'Diagram_1'), name: holder ? undefined : m.name || undefined, plane }))
  }

  const { xml } = await moddle.toXML(defs, { format: true })
  return xml
}

const CHAR = 6 // average width of a character at the canvas's 11px label font
const LINE = 14

/** Where the canvas shows a name outside the shape: above a gateway, below an event or a data shape. */
function outerLabel(n: FlowNode, b: Bounds): Bounds | undefined {
  if (!n.name || !(n.type === 'event' || n.type === 'gateway' || n.type === 'dataObject' || n.type === 'dataStore')) return undefined
  const text = n.type === 'dataObject' && n.state ? `${n.name} [${n.state}]` : n.name
  const width = Math.min(110, Math.max(20, text.length * CHAR))
  const height = Math.ceil((text.length * CHAR) / 110) * LINE
  const x = Math.round(b.x + b.width / 2 - width / 2)
  return { x, y: n.type === 'gateway' ? b.y - 3 - height : b.y + b.height + 3, width, height }
}

/** A flow's name sits on the middle of its longest segment, as on the canvas. */
function flowLabel(name: string, pts: Point[]): Bounds | undefined {
  if (!name || pts.length < 2) return undefined
  let best = 0
  const len = (i: number) => Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
  for (let i = 1; i < pts.length - 1; i++) if (len(i) > len(best)) best = i
  const width = Math.min(110, Math.max(16, name.length * CHAR))
  const height = Math.ceil((name.length * CHAR) / 110) * LINE
  const cx = (pts[best].x + pts[best + 1].x) / 2
  const cy = (pts[best].y + pts[best + 1].y) / 2
  return { x: Math.round(cx - width / 2), y: Math.round(cy - height / 2), width, height }
}

export { route }
