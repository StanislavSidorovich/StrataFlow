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

/** One way of staffing a queue: `servers` servers, each taking `service` on average (same time unit as 1/λ). */
export interface QueueOption extends Mmc {
  servers: number
  service: number
}

/**
 * The course's way: a team of c people is ONE server with the summed speed μ = c·μ1 (M/M/1). It is simple and
 * understates the wait: a real team can serve c cases at once but each takes the full 1/μ1.
 * `meanService` is the time one person needs for one case, 1/μ1.
 */
export function monolith(lambda: number, meanService: number, c: number): QueueOption {
  const service = meanService / Math.max(1, c)
  return { ...mmc(lambda, service, 1), servers: 1, service }
}

/** The more exact way: c people in parallel (M/M/c, Erlang C). */
export function exact(lambda: number, meanService: number, c: number): QueueOption {
  const servers = Math.max(1, Math.round(c))
  return { ...mmc(lambda, meanService, servers), servers, service: meanService }
}

export interface StaffingOption {
  id: 'now' | 'person' | 'team'
  label: string
  note: string
  /** As the course counts it (one server with the summed speed) and the exact M/M/c of the same staffing. */
  course: QueueOption
  exact: QueueOption
}

/**
 * Today's staffing and the two usual ways to improve it (chapter 6): "add a person" (the team's speed μ goes up, still one
 * server: c → c + 1 people in the monolith) against "a second team" (two servers, each as fast as today's team).
 */
export function staffingOptions(lambda: number, meanService: number, c: number): StaffingOption[] {
  const n = Math.max(1, Math.round(c))
  const team = meanService / n
  return [
    { id: 'now', label: `Now (${n} ${n === 1 ? 'person' : 'people'})`, note: 'as modelled', course: monolith(lambda, meanService, n), exact: exact(lambda, meanService, n) },
    { id: 'person', label: `Add a person (${n + 1})`, note: 'the team is faster: μ goes up, still one server', course: monolith(lambda, meanService, n + 1), exact: exact(lambda, meanService, n + 1) },
    { id: 'team', label: 'A second team (c = 2)', note: 'two servers, each as fast as today\'s team', course: { ...mmc(lambda, team, 2), servers: 2, service: team }, exact: exact(lambda, meanService, 2 * n) },
  ]
}
