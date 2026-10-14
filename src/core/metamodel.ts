// The process model (SPEC §5): semantic model and layout kept apart, like BPMN's model vs DI.
// Coordinates are absolute (as in BPMN DI); a node's pool, lane and sub-process follow from where it sits.

export type TaskKind = 'task' | 'user' | 'service' | 'manual' | 'send' | 'receive' | 'script' | 'businessRule'
export type EventPosition = 'start' | 'intermediate' | 'end' | 'boundary'
export type EventTrigger =
  | 'none'
  | 'message'
  | 'timer'
  | 'error'
  | 'signal'
  | 'conditional'
  | 'escalation'
  | 'terminate'
  | 'link'
  | 'compensation'
export type GatewayKind = 'exclusive' | 'parallel' | 'inclusive' | 'eventBased' | 'complex'

interface NodeBase {
  id: string
  name: string
  /** Pool the node belongs to (undefined for a process without a pool). */
  participantId?: string
  laneId?: string
  /** Enclosing sub-process, when nested. */
  parentId?: string
}

export type FlowNode = NodeBase &
  (
    | { type: 'task'; kind: TaskKind }
    | { type: 'subProcess'; collapsed: boolean }
    | { type: 'event'; position: EventPosition; trigger: EventTrigger; throwing: boolean; interrupting?: boolean; attachedTo?: string }
    | { type: 'gateway'; kind: GatewayKind; defaultFlow?: string }
    | { type: 'dataObject'; state?: string }
    | { type: 'dataStore' }
    | { type: 'annotation' }
  )

export interface Participant {
  id: string
  name: string
  /** Undefined for a black-box pool. */
  processId?: string
}

export interface Lane {
  id: string
  name: string
  participantId?: string
  parentLaneId?: string
}

export type FlowKind = 'sequence' | 'message' | 'association' | 'data'

export interface Flow {
  id: string
  kind: FlowKind
  source: string
  target: string
  name: string
  condition?: string
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Diagram {
  shapes: Record<string, Bounds & { expanded?: boolean }>
  edges: Record<string, { x: number; y: number }[]>
}

export interface FlowModel {
  format: 'strata-flow'
  version: 1
  name: string
  participants: Participant[]
  lanes: Lane[]
  nodes: FlowNode[]
  flows: Flow[]
  diagram: Diagram
}

export type ElementType = FlowNode['type']
export type Point = { x: number; y: number }

/** Default shape sizes, as in bpmn.io (Bizagi draws a little smaller). */
export const SIZES: Record<ElementType, { width: number; height: number }> = {
  task: { width: 100, height: 80 },
  subProcess: { width: 100, height: 80 },
  event: { width: 36, height: 36 },
  gateway: { width: 50, height: 50 },
  dataObject: { width: 36, height: 50 },
  dataStore: { width: 50, height: 50 },
  annotation: { width: 100, height: 50 },
}
/** Width of the vertical name strip on the left of a pool and of a lane. */
export const POOL_HEADER = 30
export const POOL_SIZE = { width: 800, height: 250 }
export const LANE_HEIGHT = 150

export function emptyModel(name = 'New process'): FlowModel {
  return { format: 'strata-flow', version: 1, name, participants: [], lanes: [], nodes: [], flows: [], diagram: { shapes: {}, edges: {} } }
}

/** Data and annotations are artifacts: they sit on the canvas but are not steps of the process. */
export const isArtifact = (n: FlowNode) => n.type === 'dataObject' || n.type === 'dataStore' || n.type === 'annotation'
