// Names of the kinds an element can be changed into, shared by Properties and the context menu.
import type { EventTrigger, GatewayKind, TaskKind } from '../core/metamodel'

export const TASK_KINDS: [TaskKind, string][] = [
  ['task', 'Task (no type)'],
  ['user', 'User task (a person, with a system)'],
  ['manual', 'Manual task (a person, no system)'],
  ['service', 'Service task (a system, automatic)'],
  ['send', 'Send task'],
  ['receive', 'Receive task'],
  ['script', 'Script task'],
  ['businessRule', 'Business rule task'],
]

export const GATEWAY_KINDS: [GatewayKind, string][] = [
  ['exclusive', 'Exclusive (XOR): exactly one way'],
  ['parallel', 'Parallel (AND): all ways'],
  ['inclusive', 'Inclusive (OR): one or more ways'],
  ['eventBased', 'Event-based: the first event to happen'],
  ['complex', 'Complex'],
]

export const triggerLabel = (t: EventTrigger) => (t === 'none' ? 'None' : t.charAt(0).toUpperCase() + t.slice(1))
