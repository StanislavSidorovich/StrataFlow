// Plain-language notes next to the Run results (v0.20.0): which lanes are overloaded, and why the run can sit above the
// formula. Pure functions, no React; they only say what the model really has.
import type { Analysis } from './analysis'
import type { FlowModel } from './metamodel'
import type { SimResult } from './simulate'

/** Lanes whose load is 100 % or more, in the run or in the formula (names, with the load that was seen, as a share). */
export function overloadedLanes(r: SimResult, f?: Analysis): { laneId: string; name: string; load: number }[] {
  const out: { laneId: string; name: string; load: number }[] = []
  for (const l of r.lanes) {
    const fu = f?.resources.find((x) => x.laneId === l.laneId)?.utilisation
    const load = Math.max(l.utilisation.mean, fu !== undefined && Number.isFinite(fu) ? fu : 0)
    if (load >= 1) out.push({ laneId: l.laneId, name: l.name, load })
  }
  return out
}

/** Does the model have an AND join (a parallel gateway with two or more ways in)? */
export function hasParallelJoin(m: FlowModel): boolean {
  return m.nodes.some((n) => n.type === 'gateway' && n.kind === 'parallel' && m.flows.filter((f) => f.kind === 'sequence' && f.target === n.id).length > 1)
}

/** One line on why the run's cycle time is clearly above the formula's, or undefined when it is not. */
export function whyRunHigher(r: SimResult, f: Analysis | undefined, m: FlowModel): string | undefined {
  const iv = r.kpis.cycleTime
  const fc = f?.cycleTime
  if (!iv || fc === undefined || !Number.isFinite(fc) || fc <= 0 || r.completed === 0) return undefined
  const gap = iv.mean - fc
  if (gap <= Math.max(iv.half ?? 0, fc * 0.03)) return undefined
  const why: string[] = []
  if (hasParallelJoin(m)) why.push('an AND join waits for the slowest of its branches, while the formula averages them')
  if (r.level === 3 && (r.kpis.resourceWait?.mean ?? 0) > fc * 0.005) why.push('people queue for each other (level 3), and the formula has no queues')
  why.push('the run is random: a short run can sit above the average, and more cases or runs bring it closer')
  return `Run is ${Math.round((gap / fc) * 100)} % above the formula: ${why.join('; ')}.`
}
