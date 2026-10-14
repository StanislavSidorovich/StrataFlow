// The process model (SPEC §5): semantic model and layout kept apart, like BPMN's model vs DI.
// Stage 0 draft: enough to show a BPMN file on the canvas. Stage 1 refines it into the editor's model.

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
