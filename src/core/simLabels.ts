// Readable labels for the rows of the Simulate tables and the what-if lists (v0.19.0).
// A name used twice gets its lane (and a number when the lane is the same too); an unnamed gateway reads
// "XOR before Ship order" instead of "Gateway_11". Pure functions, no React.
import type { FlowModel, FlowNode } from './metamodel'

const GATEWAY_WORDS: Record<string, string> = { exclusive: 'XOR', parallel: 'AND', inclusive: 'OR', eventBased: 'Event gateway', complex: 'Complex gateway' }

const nodeById = (m: FlowModel, id: string) => m.nodes.find((n) => n.id === id)

/** The name as drawn, or for an unnamed element what it is (and for a gateway what comes after it). */
export function plainLabel(m: FlowModel, id: string, depth = 0): string {
  const n = nodeById(m, id)
  if (!n) return id
  const name = n.name?.trim().replace(/\s+/g, ' ')
  if (name) return name
  if (n.type === 'gateway') {
    const word = GATEWAY_WORDS[n.kind] ?? 'Gateway'
    const out = m.flows.find((f) => f.kind === 'sequence' && f.source === n.id)
    const target = out && nodeById(m, out.target)
    if (!target) return n.kind === 'exclusive' || n.kind === 'parallel' || n.kind === 'inclusive' ? `${word} gateway` : word
    // A chain of unnamed gateways: look through at most two of them, then give up with the type.
    const after = target.type === 'gateway' && !target.name?.trim() && depth >= 2 ? 'gateway' : plainLabel(m, target.id, depth + 1)
    return `${word} before ${after}`
  }
  if (n.type === 'event') return n.position === 'boundary' ? 'Boundary event' : n.position === 'start' ? 'Start event' : n.position === 'end' ? 'End event' : 'Event'
  if (n.type === 'subProcess') return 'Sub-process'
  return n.type
}

const laneName = (m: FlowModel, n: FlowNode) => {
  const lane = n.laneId ? m.lanes.find((l) => l.id === n.laneId) : undefined
  if (lane?.name?.trim()) return lane.name.trim()
  const pool = n.participantId ? m.participants.find((p) => p.id === n.participantId) : undefined
  return pool?.name?.trim() || undefined
}

const cache = new WeakMap<FlowModel, Map<string, string>>()

/** Every element's label, unique inside the model: `Pack order · Warehouse A`, and `(2)` when the lane repeats too. */
export function labelMap(m: FlowModel): Map<string, string> {
  const hit = cache.get(m)
  if (hit) return hit
  const base = new Map<string, string>()
  const groups = new Map<string, FlowNode[]>()
  for (const n of m.nodes) {
    if (n.type === 'annotation' || n.type === 'dataObject' || n.type === 'dataStore') continue
    const b = plainLabel(m, n.id)
    base.set(n.id, b)
    groups.set(b, [...(groups.get(b) ?? []), n])
  }
  const out = new Map<string, string>()
  for (const [b, nodes] of groups) {
    if (nodes.length === 1) {
      out.set(nodes[0].id, b)
      continue
    }
    const withLane = new Map<string, FlowNode[]>()
    for (const n of nodes) {
      const l = laneName(m, n)
      const text = l ? `${b} · ${l}` : b
      withLane.set(text, [...(withLane.get(text) ?? []), n])
    }
    for (const [text, same] of withLane) same.forEach((n, i) => out.set(n.id, same.length === 1 ? text : `${text} (${i + 1})`))
  }
  cache.set(m, out)
  return out
}

/** The label of an element (unique in the model); the id when it is not there. */
export function labelOf(m: FlowModel, id: string): string {
  return labelMap(m).get(id) ?? plainLabel(m, id)
}

/** Whether any task cost or lane rate is typed: without one, a cost column would only show a misleading 0. */
export function hasRates(m: FlowModel): boolean {
  return m.lanes.some((l) => (l.useCost ?? 0) > 0 || (l.hourlyCost ?? 0) > 0) || m.nodes.some((n) => (n.sim?.cost ?? 0) > 0)
}

/** A small number with its significant digits: 0.006 stays 0.006 (not 0.01); from 0.1 up two decimals as usual. */
export function sig(x: number | undefined, digits = 2): string {
  if (x === undefined || !Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 0.1) return String(Math.round(x * 10 ** digits) / 10 ** digits)
  return String(Number(x.toPrecision(digits)))
}

/** "Scenario 1", "Scenario 2": the first number no variant uses yet. */
export function defaultScenarioName(used: string[]): string {
  let k = 1
  while (used.includes(`Scenario ${k}`)) k++
  return `Scenario ${k}`
}

/** Repeated lines are folded: three identical ones read "text ×3". Order of first appearance stays. */
export function foldRepeats(lines: string[]): string[] {
  const counts = new Map<string, number>()
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1)
  return [...counts].map(([l, n]) => (n > 1 ? `${l} ×${n}` : l))
}
