// Queueing formulas (stage 6b): M/M/c, random arrivals, random service times, c people, one queue.
// Erlang C is the chance that an arriving case finds all c people busy and has to wait.

export interface Mmc {
  /** Utilisation ρ = λ / (c·μ). */
  rho: number
  /** False when ρ ≥ 1: the queue grows without end and every other figure is infinite. */
  stable: boolean
  /** Erlang C: the chance that a case has to wait. */
  pWait: number
  /** Mean wait in the queue, in the unit of 1/μ (Infinity when unstable). */
  wq: number
  /** Mean time in the system: wait + service. */
  w: number
  /** Mean number waiting, and in the system. */
  lq: number
  l: number
}

/**
 * M/M/c from the arrival rate λ, the service time 1/μ (`meanService`, same time unit as 1/λ) and c people.
 * Erlang B by its stable recursion, then Erlang C from it, so a large c does not overflow a factorial.
 */
export function mmc(lambda: number, meanService: number, c: number): Mmc {
  const servers = Math.max(1, Math.round(c))
  if (!(lambda > 0) || !(meanService > 0)) return { rho: 0, stable: true, pWait: 0, wq: 0, w: Math.max(0, meanService || 0), lq: 0, l: 0 }
  const a = lambda * meanService // offered load: people busy on average
  const rho = a / servers
  if (rho >= 1) return { rho, stable: false, pWait: 1, wq: Infinity, w: Infinity, lq: Infinity, l: Infinity }
  let b = 1
  for (let k = 1; k <= servers; k++) b = (a * b) / (k + a * b)
  const pWait = b / (1 - rho * (1 - b))
  const wq = (pWait * meanService) / (servers * (1 - rho))
  return { rho, stable: true, pWait, wq, w: wq + meanService, lq: lambda * wq, l: lambda * (wq + meanService) }
}
