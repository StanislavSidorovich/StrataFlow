// The right column: what the selected element is and what it can be changed into. Typing in a field
// is one undo step per field (coalesced), every other change is one step.
import { useEffect, useRef } from 'react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown, ArrowLeftRight, ArrowUp, FolderOpen, Group, Plus, Route, Trash2, Ungroup } from 'lucide-react'
import type { EventPosition, EventTrigger, FlowModel, FlowNode, GatewayKind, LoopKind, TaskKind } from '../../core/metamodel'
import { GATEWAY_KINDS, LOOP_KINDS, TASK_KINDS, triggerLabel } from '../choices'
import {
  addBoundaryEvent,
  addLane,
  alignElements,
  arrangeable,
  canMoveLane,
  distributeElements,
  moveLane,
  canInterrupt,
  convertActivity,
  deleteElements,
  flowOf,
  laneOf,
  nodeOf,
  poolOf,
  rename,
  setCollapsed,
  resetFlowRoute,
  reverseFlow,
  setDefaultFlow,
  setFlow,
  setModelName,
  triggersFor,
  updateNode,
  type NodePatch,
} from '../../core/ops'
import { canGroup, groupSelection, ungroupSelection } from '../actions'
import { cardForElement } from '../../data/help'
import { ALIGN, DISTRIBUTE } from '../canvas/menu'
import { useEditor } from '../store'
import { HelpQ } from './Help'
import { AuthorLinks } from '../AuthorLinks'

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function Properties() {
  const model = useEditor((s) => s.model)
  const selection = useEditor((s) => s.selection)
  const ids = selection
  return (
    <aside className="side-panel" aria-label="Properties">
      {ids.length === 0 && <ProcessProps model={model} />}
      {ids.length === 1 && <ElementProps model={model} id={ids[0]} />}
      {ids.length > 1 && (
        <section>
          <h2>{ids.length} selected</h2>
          <p className="muted">Drag one of them to move them all.</p>
          <ArrangeButtons model={model} ids={ids} />
          {canGroup(ids) && <GroupButton />}
          <DeleteButton ids={ids} />
        </section>
      )}
      <AuthorLinks className="side-author" />
    </aside>
  )
}

function ProcessProps({ model }: { model: FlowModel }) {
  const apply = useEditor((s) => s.apply)
  return (
    <section>
      <Title text="Process" card="process" />
      <Field label="Name" help="naming">
        <input value={model.name} onChange={(e) => apply((m) => setModelName(m, e.target.value), { coalesce: 'model-name' })} data-testid="model-name" />
      </Field>
      <p className="muted">
        {model.participants.length} pools · {model.lanes.length} lanes · {model.nodes.length} elements · {model.flows.length} flows
      </p>
      <h3>How to draw</h3>
      <ul className="tips">
        <li>Pick a shape on the left bar (or press its key), then click on the canvas. Shift+click keeps the tool.</li>
        <li>Double-click the empty canvas: a new task.</li>
        <li>Select a shape: the pad next to it appends the next step.</li>
        <li>Drag from the dots on a shape to another shape to connect, or press the arrow on the pad and tap the other shape (easier with a finger). Between pools it becomes a message flow.</li>
        <li>Del deletes, Ctrl+Z undoes, Ctrl+S saves a file. The model is also kept in this browser.</li>
        <li>Check (top bar) lists what may be wrong; ? next to a field, or F1, opens the help cards.</li>
      </ul>
    </section>
  )
}

function ElementProps({ model, id }: { model: FlowModel; id: string }) {
  const node = nodeOf(model, id)
  if (node) return <NodeProps model={model} n={node} />
  const pool = poolOf(model, id)
  if (pool)
    return (
      <section>
        <Title text="Pool" card={pool.processId ? 'pool' : 'black-box-pool'} />
        <NameField id={id} value={pool.name} />
        <p className="muted">{pool.processId ? 'Holds a process: put its steps inside.' : 'Black box: its process is not shown; message flows go to its border.'}</p>
        <button className="btn" data-testid="add-lane" onClick={() => addLaneTo(id)}>
          <Plus size={14} /> Add lane
        </button>
        <DeleteButton ids={[id]} note="Deletes the pool with its lanes and everything in it." />
      </section>
    )
  const lane = laneOf(model, id)
  if (lane)
    return (
      <section>
        <Title text="Lane" card="lane" />
        <NameField id={id} value={lane.name} placeholder="A role, e.g. Clerk" />
        <p className="muted">Drag the line under a selected lane to change its height.</p>
        <div className="row">
          <button className="btn" data-testid="lane-up" disabled={!canMoveLane(model, id, 'up')} onClick={() => useEditor.getState().apply((m) => moveLane(m, id, 'up'))}>
            <ArrowUp size={14} /> Move up
          </button>
          <button className="btn" data-testid="lane-down" disabled={!canMoveLane(model, id, 'down')} onClick={() => useEditor.getState().apply((m) => moveLane(m, id, 'down'))}>
            <ArrowDown size={14} /> Move down
          </button>
        </div>
        {lane.participantId && (
          <button className="btn" data-testid="add-lane" onClick={() => addLaneTo(lane.participantId!)}>
            <Plus size={14} /> Add lane
          </button>
        )}
        <DeleteButton ids={[id]} note="Its room and its steps go to the lane next to it." />
      </section>
    )
  const flow = flowOf(model, id)
  if (flow) return <FlowProps model={model} id={id} />
  return null
}

function addLaneTo(poolId: string) {
  let lane: string | null = null
  if (useEditor.getState().apply((m) => void (lane = addLane(m, poolId).id)) && lane) useEditor.setState({ selection: [lane], focusName: lane })
}

function NodeProps({ model, n }: { model: FlowModel; n: FlowNode }) {
  const apply = useEditor((s) => s.apply)
  const patch = (p: NodePatch) => apply((m) => updateNode(m, n.id, p))
  const title = n.type === 'event' ? `${label(n.position)} event` : n.type === 'subProcess' ? 'Sub-process' : n.type === 'dataObject' ? 'Data object' : n.type === 'dataStore' ? 'Data store' : n.type === 'annotation' ? 'Text annotation' : label(n.type)
  const where = [n.participantId && poolOf(model, n.participantId)?.name, n.laneId && laneOf(model, n.laneId)?.name].filter(Boolean).join(' · ')
  return (
    <section>
      <Title text={title} card={cardForElement(n)} />
      {where && <p className="muted">In {where}</p>}
      <NameField id={n.id} value={n.name} multiline placeholder={n.type === 'task' ? 'Verb + object, e.g. Check invoice' : n.type === 'gateway' ? 'A question, e.g. Invoice OK?' : undefined} />

      {n.type === 'task' && (
        <>
          <Field label="Type" help="task-types">
            <select value={n.kind} onChange={(e) => patch({ kind: e.target.value as TaskKind })} data-testid="task-kind">
              {TASK_KINDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Repeats" help="loop">
            <select value={n.loop ?? 'none'} onChange={(e) => patch({ loop: e.target.value as LoopKind | 'none' })} data-testid="loop-kind">
              {LOOP_KINDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <button className="btn" onClick={() => apply((m) => convertActivity(m, n.id, 'subProcess'))}>
              To sub-process
            </button>
            <BoundaryButton id={n.id} />
          </div>
          <GroupButton />
        </>
      )}

      {n.type === 'subProcess' && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={!n.collapsed}
              onChange={(e) => apply((m) => setCollapsed(m, n.id, !e.target.checked))}
              data-testid="expanded"
            />
            Expanded (shows its steps inside)
            <HelpQ card="sub-process" />
          </label>
          {n.collapsed && (
            <button className="btn" onClick={() => useEditor.getState().openPage(n.id)} title="Show its steps on a page of their own (double-click it does the same)" data-testid="open-page">
              <FolderOpen size={14} /> Open sub-process
            </button>
          )}
          <Field label="Repeats" help="loop">
            <select value={n.loop ?? 'none'} onChange={(e) => patch({ loop: e.target.value as LoopKind | 'none' })} data-testid="loop-kind">
              {LOOP_KINDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <button className="btn" onClick={() => apply((m) => convertActivity(m, n.id, 'task'))}>
              To task
            </button>
            <BoundaryButton id={n.id} />
          </div>
          <div className="row">
            <button className="btn" onClick={ungroupSelection} title="Put its steps back in the process, without the sub-process (Ctrl+Shift+G)" data-testid="ungroup">
              <Ungroup size={14} /> Ungroup
            </button>
            <GroupButton />
          </div>
        </>
      )}

      {n.type === 'event' && (
        <>
          {n.position !== 'boundary' && (
            <Field label="Position" help={n.position === 'start' ? 'start-event' : n.position === 'end' ? 'end-event' : 'intermediate-event'}>
              <select
                value={n.position}
                onChange={(e) => {
                  // A trigger not allowed in the new place falls back to none (updateNode).
                  patch({ position: e.target.value as Exclude<EventPosition, 'boundary'> })
                }}
                data-testid="event-position"
              >
                <option value="start">Start: the process begins</option>
                <option value="intermediate">Intermediate: something happens on the way</option>
                <option value="end">End: the process ends</option>
              </select>
            </Field>
          )}
          {n.position === 'intermediate' && (
            <Field label="Direction" help="intermediate-event">
              <select
                value={n.throwing ? 'throw' : 'catch'}
                onChange={(e) => {
                  patch({ throwing: e.target.value === 'throw' })
                }}
                data-testid="event-direction"
              >
                <option value="catch">Catching: waits for it</option>
                <option value="throw">Throwing: makes it happen</option>
              </select>
            </Field>
          )}
          <Field label="Trigger" help={cardForElement(n)}>
            <select value={n.trigger} onChange={(e) => patch({ trigger: e.target.value as EventTrigger })} data-testid="event-trigger">
              {triggersFor(n).map((t) => (
                <option key={t} value={t}>
                  {triggerLabel(t)}
                </option>
              ))}
            </select>
          </Field>
          {canInterrupt(model, n.id) && (
            <label className="check">
              <input type="checkbox" checked={n.interrupting !== false} onChange={(e) => patch({ interrupting: e.target.checked })} data-testid="interrupting" />
              {n.position === 'boundary' ? 'Interrupting (stops the activity)' : 'Interrupting (stops the sub-process)'}
              <HelpQ card="boundary-event" />
            </label>
          )}
        </>
      )}

      {n.type === 'gateway' && (
        <Field label="Kind" help={cardForElement(n)}>
          <select value={n.kind} onChange={(e) => patch({ kind: e.target.value as GatewayKind })} data-testid="gateway-kind">
            {GATEWAY_KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      )}

      {n.type === 'dataObject' && (
        <Field label="State" help="data-object">
          <input value={n.state ?? ''} placeholder="e.g. approved" onChange={(e) => apply((m) => updateNode(m, n.id, { state: e.target.value }), { coalesce: `state:${n.id}` })} />
        </Field>
      )}

      <DeleteButton ids={[n.id]} />
    </section>
  )
}

function BoundaryButton({ id }: { id: string }) {
  return (
    <button
      className="btn"
      title="An event on the border: a deadline, an error or a message while the activity runs"
      onClick={() => {
        let ev: string | null = null
        if (useEditor.getState().apply((m) => void (ev = addBoundaryEvent(m, id).id)) && ev) useEditor.setState({ selection: [ev] })
      }}
    >
      <Plus size={14} /> Boundary event
    </button>
  )
}

function FlowProps({ model, id }: { model: FlowModel; id: string }) {
  const apply = useEditor((s) => s.apply)
  const f = flowOf(model, id)!
  const src = nodeOf(model, f.source)
  const name = (x: string) => nodeOf(model, x)?.name || poolOf(model, x)?.name || x
  const decides = src?.type === 'gateway' && ['exclusive', 'inclusive', 'complex'].includes(src.kind)
  const isDefault = src?.type === 'gateway' && src.defaultFlow === id
  const title = { sequence: 'Sequence flow', message: 'Message flow', association: 'Association', data: 'Data association' }[f.kind]
  return (
    <section>
      <Title text={title} card={cardForElement({ type: f.kind })} />
      <p className="muted">
        {name(f.source)} → {name(f.target)}
      </p>
      {f.kind !== 'association' && f.kind !== 'data' && <NameField id={id} value={f.name} placeholder={decides ? 'The answer, e.g. Yes' : f.kind === 'message' ? 'What is sent, e.g. Invoice' : undefined} />}
      {decides && (
        <>
          <Field label="Condition" help="exclusive-gateway">
            <input value={f.condition ?? ''} disabled={isDefault} placeholder={isDefault ? 'Default: taken when no other holds' : 'e.g. amount > 1000'} onChange={(e) => apply((m) => setFlow(m, id, { condition: e.target.value }), { coalesce: `cond:${id}` })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={isDefault} onChange={(e) => apply((m) => setDefaultFlow(m, id, e.target.checked))} data-testid="default-flow" />
            Default flow (taken when no condition holds)
            <HelpQ card="default-flow" />
          </label>
        </>
      )}
      <div className="row">
        <button className="btn" onClick={() => apply((m) => reverseFlow(m, id))} title="Swap source and target">
          <ArrowLeftRight size={14} /> Reverse
        </button>
        {(model.diagram.edges[id] || f.sourceSide || f.targetSide) && (
          <button className="btn" onClick={() => apply((m) => resetFlowRoute(m, id))} title="Forget the bends and sides you chose: the line is routed by itself again" data-testid="auto-route">
            <Route size={14} /> Auto route
          </button>
        )}
      </div>
      <DeleteButton ids={[id]} />
    </section>
  )
}

function NameField({ id, value, multiline, placeholder, help = 'naming' }: { id: string; value: string; multiline?: boolean; placeholder?: string; help?: string }) {
  const apply = useEditor((s) => s.apply)
  const focus = useEditor((s) => s.focusName === id)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!focus || !ref.current) return
    ref.current.focus()
    ref.current.select()
    useEditor.setState({ focusName: null })
  }, [focus])
  const props = {
    ref,
    value,
    placeholder,
    'data-testid': 'name',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => apply((m) => rename(m, id, e.target.value), { coalesce: `name:${id}` }),
    // Enter finishes the name (Shift+Enter: a new line), as in Bizagi.
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
        e.preventDefault()
        ;(e.target as HTMLElement).blur()
      }
    },
  }
  return (
    <Field label="Name" help={help}>
      {multiline ? <textarea rows={2} {...props} /> : <input {...props} />}
    </Field>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>
        {label}
        {help && <HelpQ card={help} label={label} />}
      </span>
      {children}
    </label>
  )
}

/** A panel title with the help card for what is selected. */
function Title({ text, card }: { text: string; card: string }) {
  return (
    <h2 className="with-help">
      {text}
      <HelpQ card={card} />
    </h2>
  )
}

const ARRANGE_ICONS = {
  left: AlignStartVertical,
  center: AlignCenterVertical,
  right: AlignEndVertical,
  top: AlignStartHorizontal,
  middle: AlignCenterHorizontal,
  bottom: AlignEndHorizontal,
  horizontal: AlignHorizontalDistributeCenter,
  vertical: AlignVerticalDistributeCenter,
}

/** Align (two or more shapes) and distribute (three or more), each one undo step; pools, lanes and flows stay. */
function ArrangeButtons({ model, ids }: { model: FlowModel; ids: string[] }) {
  const n = arrangeable(model, ids).length
  if (n < 2) return null
  const apply = useEditor.getState().apply
  return (
    <div className="arrange-row" role="group" aria-label="Align and distribute">
      {ALIGN.map(([h, l]) => {
        const Icon = ARRANGE_ICONS[h]
        return (
          <button key={h} className="btn icon" title={`Align ${l.toLowerCase()}`} aria-label={`Align ${l.toLowerCase()}`} data-testid={`align-${h}`} onClick={() => apply((m) => alignElements(m, ids, h))}>
            <Icon size={16} />
          </button>
        )
      })}
      {DISTRIBUTE.map(([a, l]) => {
        const Icon = ARRANGE_ICONS[a]
        return (
          <button key={a} className="btn icon" disabled={n < 3} title={n < 3 ? 'Distribute: select three or more shapes' : `Distribute ${l.toLowerCase()} (equal gaps)`} aria-label={`Distribute ${l.toLowerCase()}`} data-testid={`distribute-${a}`} onClick={() => apply((m) => distributeElements(m, ids, a))}>
            <Icon size={16} />
          </button>
        )
      })}
    </div>
  )
}

function GroupButton() {
  return (
    <button className="btn" onClick={groupSelection} title="Turn the selected steps into a sub-process (Ctrl+G). Shift+click or drag a box to select several." data-testid="group">
      <Group size={14} /> Group into sub-process
    </button>
  )
}

function DeleteButton({ ids, note }: { ids: string[]; note?: string }) {
  return (
    <div className="delete-row">
      <button className="btn danger" onClick={() => useEditor.getState().apply((m) => deleteElements(m, ids))} data-testid="delete">
        <Trash2 size={14} /> Delete
      </button>
      {note && <p className="muted">{note}</p>}
    </div>
  )
}
