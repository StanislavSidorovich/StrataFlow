// What the context menu offers (right-click, as in Bizagi) and the "Change type" popup of the context pad
// (the wrench, as in bpmn.io). Plain data, no React: each entry runs one op on the model (one undo step)
// or names a command the UI carries out. The menu lists only what the ops allow where the element is.
import type { EventPosition, FlowModel, FlowNode, Point } from '../../core/metamodel'
import { POOL_HEADER, isArtifact } from '../../core/metamodel'
import {
  addBoundaryEvent,
  addNode,
  addPool,
  canInterrupt,
  convertActivity,
  deleteElements,
  flowOf,
  laneOf,
  nodeOf,
  poolOf,
  reverseFlow,
  setCollapsed,
  setDefaultFlow,
  triggersFor,
  updateNode,
  type NodeSpec,
} from '../../core/ops'
import { cardForElement } from '../../data/help'
import { GATEWAY_KINDS, TASK_KINDS, triggerLabel } from '../choices'

/** What the UI does itself: type a name, open a help card, group, ungroup, open a page, lay out, check. */
export type Command = 'rename' | 'help' | 'group' | 'ungroup' | 'open-page' | 'layout' | 'check'

export interface MenuEntry {
  /** Stable key, also the test id (`cm-<id>`). */
  id: string
  label: string
  title?: string
  /** Shortcut shown on the right. */
  keys?: string
  /** A chosen option (radio) or a switch that is on. */
  checked?: boolean
  danger?: boolean
  /** A submenu. */
  items?: MenuItem[]
  /** One undo step; a returned id is selected afterwards. */
  edit?: (m: FlowModel) => string | void
  /** After the edit, the new element's name field takes the focus. */
  focusName?: boolean
  command?: Command
}
export type MenuItem = MenuEntry | 'sep'

const POSITIONS: [Exclude<EventPosition, 'boundary'>, string][] = [
  ['start', 'Start: the process begins'],
  ['intermediate', 'Intermediate: on the way'],
  ['end', 'End: the process ends'],
]

/** The "change type" entries of one node: what the wrench shows and the top of its right-click menu. */
export function typeEntries(m: FlowModel, id: string): MenuItem[] {
  const n = nodeOf(m, id)
  if (!n) return []
  const set = (patch: Parameters<typeof updateNode>[2]) => (d: FlowModel) => updateNode(d, id, patch)
  switch (n.type) {
    case 'event':
      return eventEntries(m, n, set)
    case 'task':
      return [
        { id: 'kind', label: 'Task type', items: TASK_KINDS.map(([k, l]) => ({ id: `kind-${k}`, label: l, checked: n.kind === k, edit: set({ kind: k }) })) },
        { id: 'to-subprocess', label: 'Convert to sub-process', edit: (d) => convertActivity(d, id, 'subProcess') },
        { id: 'boundary', label: 'Add boundary event', title: 'A deadline, an error or a message while the task runs', edit: (d) => addBoundaryEvent(d, id).id },
      ]
    case 'subProcess':
      return [
        ...(n.collapsed ? [{ id: 'open-page', label: 'Open sub-process', title: 'Its steps on a page of their own (double-click does the same)', command: 'open-page' as const }] : []),
        { id: 'expanded', label: 'Expanded', title: 'Shows its steps inside', checked: !n.collapsed, edit: (d) => setCollapsed(d, id, !n.collapsed) },
        { id: 'to-task', label: 'Convert to task', edit: (d) => convertActivity(d, id, 'task') },
        { id: 'ungroup', label: 'Ungroup', keys: 'Ctrl+Shift+G', title: 'Put its steps back in the process', command: 'ungroup' },
        { id: 'boundary', label: 'Add boundary event', edit: (d) => addBoundaryEvent(d, id).id },
      ]
    case 'gateway':
      return [{ id: 'kind', label: 'Gateway kind', items: GATEWAY_KINDS.map(([k, l]) => ({ id: `kind-${k}`, label: l, checked: n.kind === k, edit: set({ kind: k }) })) }]
    default:
      return []
  }
}

function eventEntries(m: FlowModel, n: Extract<FlowNode, { type: 'event' }>, set: (p: Parameters<typeof updateNode>[2]) => (d: FlowModel) => void): MenuItem[] {
  const out: MenuItem[] = [
    { id: 'trigger', label: 'Trigger', items: triggersFor(n).map((t) => ({ id: `trigger-${t}`, label: triggerLabel(t), checked: n.trigger === t, edit: set({ trigger: t }) })) },
  ]
  if (n.position !== 'boundary')
    out.push({ id: 'position', label: 'Position', items: POSITIONS.map(([p, l]) => ({ id: `position-${p}`, label: l, checked: n.position === p, edit: set({ position: p }) })) })
  if (n.position === 'intermediate')
    out.push({
      id: 'direction',
      label: 'Direction',
      items: [
        { id: 'direction-catch', label: 'Catching: waits for it', checked: !n.throwing, edit: set({ throwing: false }) },
        { id: 'direction-throw', label: 'Throwing: makes it happen', checked: n.throwing, edit: set({ throwing: true }) },
      ],
    })
  if (canInterrupt(m, n.id))
    out.push({ id: 'interrupting', label: 'Interrupting', title: n.position === 'boundary' ? 'Stops the activity' : 'Stops the sub-process', checked: n.interrupting !== false, edit: set({ interrupting: n.interrupting === false }) })
  return out
}

/** The help card for any element: node, pool, lane or flow. */
export function helpCardFor(m: FlowModel, id: string): string | undefined {
  const n = nodeOf(m, id)
  if (n) return cardForElement(n)
  const p = poolOf(m, id)
  if (p) return p.processId ? 'pool' : 'black-box-pool'
  if (laneOf(m, id)) return 'lane'
  const f = flowOf(m, id)
  return f && cardForElement({ type: f.kind })
}

const ADD: { id: string; label: string; spec: NodeSpec }[] = [
  { id: 'add-task', label: 'Task', spec: { type: 'task' } },
  { id: 'add-exclusive', label: 'Exclusive gateway (XOR)', spec: { type: 'gateway', kind: 'exclusive' } },
  { id: 'add-parallel', label: 'Parallel gateway (AND)', spec: { type: 'gateway', kind: 'parallel' } },
  { id: 'add-start', label: 'Start event', spec: { type: 'event', position: 'start' } },
  { id: 'add-intermediate', label: 'Intermediate event', spec: { type: 'event', position: 'intermediate' } },
  { id: 'add-end', label: 'End event', spec: { type: 'event', position: 'end' } },
  { id: 'add-data', label: 'Data object', spec: { type: 'dataObject' } },
  { id: 'add-annotation', label: 'Text annotation', spec: { type: 'annotation' } },
]

/**
 * The right-click menu. `ids` = what was clicked (the selection when the click was on a selected element);
 * none = the empty canvas, where `at` is the point in model coordinates and `page` the page shown.
 */
export function menuFor(m: FlowModel, ids: string[], at: Point, page: string | null): MenuItem[] {
  if (!ids.length)
    return [
      {
        id: 'add',
        label: 'Add here',
        items: [
          ...ADD.map((a) => ({ id: a.id, label: a.label, focusName: true, edit: (d: FlowModel) => addNode(d, a.spec, at, '', page ?? undefined).id })),
          ...(page ? [] : ['sep' as const, { id: 'add-pool', label: 'Pool', focusName: true, edit: (d: FlowModel) => addPool(d, { x: at.x - POOL_HEADER / 2, y: at.y - 20 }).id }]),
        ],
      },
      'sep',
      { id: 'layout', label: 'Auto layout', title: 'Steps left to right, each in its own lane (Undo puts everything back)', command: 'layout' },
      { id: 'check', label: 'Check', title: 'What may be wrong in the model (course rules P01–P17)', command: 'check' },
    ]
  const del: MenuEntry = { id: 'delete', label: 'Delete', keys: 'Del', danger: true, edit: (d) => deleteElements(d, ids) }
  if (ids.length > 1) {
    const steps = ids.some((x) => {
      const n = nodeOf(m, x)
      return n && !isArtifact(n)
    })
    return [...(steps ? [{ id: 'group', label: 'Group into sub-process', keys: 'Ctrl+G', command: 'group' as const }, 'sep' as const] : []), del]
  }
  const id = ids[0]
  const out: MenuItem[] = [...typeEntries(m, id)]
  const f = flowOf(m, id)
  if (f) {
    const g = nodeOf(m, f.source)
    if (f.kind === 'sequence' && g?.type === 'gateway' && ['exclusive', 'inclusive', 'complex'].includes(g.kind))
      out.push({ id: 'default', label: 'Default flow', title: 'Taken when no condition holds', checked: g.defaultFlow === id, edit: (d) => setDefaultFlow(d, id, g.defaultFlow !== id) })
    out.push({ id: 'reverse', label: 'Reverse', title: 'Swap source and target', edit: (d) => reverseFlow(d, id) })
  }
  if (out.length) out.push('sep')
  const named = !f || f.kind === 'sequence' || f.kind === 'message'
  if (named) out.push({ id: 'rename', label: 'Rename', keys: 'F2', command: 'rename' })
  if (helpCardFor(m, id)) out.push({ id: 'help', label: 'Help card', command: 'help' })
  out.push('sep', del)
  return out
}

/** Every entry, submenus flattened (tests and lookups by id). */
export function flatEntries(items: MenuItem[]): MenuEntry[] {
  return items.flatMap((it) => (it === 'sep' ? [] : [it, ...flatEntries(it.items ?? [])]))
}
