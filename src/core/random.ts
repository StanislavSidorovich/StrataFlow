// Seeded random numbers and the shapes of times (stage 6b). Pure TypeScript, no dependency.
// A generator is a function returning numbers in [0, 1). Each element of a simulation gets its own stream,
// seeded from `hashSeed(seed, elementId, purpose)`, so adding a task does not change the arrivals.
import type { Shape, ShapeKind } from './metamodel'

export type Rng = () => number

/** mulberry32: a small, fast, public-domain generator (32 bits of state). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One 32-bit seed from the run's seed, an element id and a purpose ("duration", "arrival"…): FNV-1a with a final mix. */
export function hashSeed(seed: number, id: string, purpose: string): number {
  let h = 0x811c9dc5 ^ (Math.trunc(seed) | 0)
  for (const c of `${id}\u0000${purpose}`) {
    h ^= c.codePointAt(0)!
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

export const streamFor = (seed: number, id: string, purpose: string): Rng => makeRng(hashSeed(seed, id, purpose))

export const SHAPE_KINDS: ShapeKind[] = ['exp', 'normal', 'uniform', 'triangular']
export const SHAPE_LABELS: Record<ShapeKind | 'const', string> = { const: 'Constant', exp: 'Exponential', normal: 'Normal', uniform: 'Uniform', triangular: 'Triangular' }

// ---------------------------------------------------------------- the normal distribution

const SQRT2PI = Math.sqrt(2 * Math.PI)
const pdf = (x: number) => Math.exp(-0.5 * x * x) / SQRT2PI
/** Standard normal CDF (Abramowitz and Stegun 7.1.26 through erf, error below 1.5e-7). */
function cdf(x: number): number {
  if (x === Infinity) return 1
  if (x === -Infinity) return 0
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * z)
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - poly * Math.exp(-z * z)
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

/** The cut of a normal: lower and upper end (the lower end is 0 unless `min` says more). */
const cutOf = (s: { min?: number; max?: number }) => ({ lo: s.min ?? 0, hi: s.max ?? Infinity })

/** Mean and standard deviation of a normal cut to [lo, hi] (the cut at 0 moves the mean up when the spread is wide). */
function truncated(mu: number, sd: number, lo: number, hi: number): { mean: number; sd: number } {
  if (sd <= 0) return { mean: Math.min(hi, Math.max(lo, mu)), sd: 0 }
  const a = (lo - mu) / sd
  const b = (hi - mu) / sd
  const z = cdf(b) - cdf(a)
  if (!(z > 1e-9)) return { mean: Math.min(hi, Math.max(lo, mu)), sd: 0 } // nothing left of the bell
  const pa = a === -Infinity ? 0 : pdf(a)
  const pb = b === Infinity ? 0 : pdf(b)
  const apa = a === -Infinity ? 0 : a * pa
  const bpb = b === Infinity ? 0 : b * pb
  const d = (pa - pb) / z
  return { mean: mu + sd * d, sd: sd * Math.sqrt(Math.max(0, 1 + (apa - bpb) / z - d * d)) }
}

// ---------------------------------------------------------------- shapes

/** The real mean of a time with this shape. Equals `figure` except for a normal cut at 0 (and for uniform and triangular, whose mean is their own). */
export function shapeMean(shape: Shape | undefined, figure: number): number {
  if (!shape) return figure
  switch (shape.kind) {
    case 'exp':
      return figure
    case 'normal': {
      const { lo, hi } = cutOf(shape)
      return truncated(figure, shape.sd, lo, hi).mean
    }
    case 'uniform':
      return (shape.min + shape.max) / 2
    case 'triangular':
      return (shape.min + shape.mode + shape.max) / 3
  }
}

/** The standard deviation of a time with this shape. */
export function shapeSd(shape: Shape | undefined, figure: number): number {
  if (!shape) return 0
  switch (shape.kind) {
    case 'exp':
      return figure
    case 'normal': {
      const { lo, hi } = cutOf(shape)
      return truncated(figure, shape.sd, lo, hi).sd
    }
    case 'uniform':
      return (shape.max - shape.min) / Math.sqrt(12)
    case 'triangular': {
      const { min: a, mode: c, max: b } = shape
      return Math.sqrt((a * a + b * b + c * c - a * b - a * c - b * c) / 18)
    }
  }
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** Why a shape cannot be used, or undefined when it is fine. σ = 0 is allowed here (it is read as a constant). */
export function validateShape(s: Shape): string | undefined {
  switch (s.kind) {
    case 'exp':
      return undefined
    case 'normal':
      if (!finite(s.sd) || s.sd < 0) return 'The spread (σ) must be 0 or more'
      for (const [k, v] of [['min', s.min], ['max', s.max]] as const) if (v !== undefined && (!finite(v) || v < 0)) return `The ${k} cannot be below 0`
      if (s.min !== undefined && s.max !== undefined && s.min > s.max) return 'The min must not be above the max'
      return undefined
    case 'uniform':
      if (![s.min, s.max].every(finite) || s.min < 0) return 'The min cannot be below 0'
      return s.min > s.max ? 'The min must not be above the max' : undefined
    case 'triangular':
      if (![s.min, s.mode, s.max].every(finite) || s.min < 0) return 'The min cannot be below 0'
      if (s.min > s.max) return 'The min must not be above the max'
      return s.mode < s.min || s.mode > s.max ? 'The most likely value must lie between the min and the max' : undefined
    default:
      return 'Unknown shape'
  }
}

/** A shape read from a file: a valid one comes back cleaned; anything else (unknown kind, bad numbers) is undefined. σ = 0 is a constant. */
export function cleanShape(raw: unknown): Shape | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  let s: Shape
  switch (r.kind) {
    case 'exp':
      s = { kind: 'exp' }
      break
    case 'normal':
      s = { kind: 'normal', sd: r.sd as number, ...(r.min !== undefined && { min: r.min as number }), ...(r.max !== undefined && { max: r.max as number }) }
      break
    case 'uniform':
      s = { kind: 'uniform', min: r.min as number, max: r.max as number }
      break
    case 'triangular':
      s = { kind: 'triangular', min: r.min as number, mode: r.mode as number, max: r.max as number }
      break
    default:
      return undefined
  }
  if (validateShape(s)) return undefined
  return s.kind === 'normal' && s.sd === 0 ? undefined : s
}

/** A first shape of a kind around a mean, the way a picker offers it: the mean stays the mean. */
export function defaultShape(kind: ShapeKind | 'const', mean: number): Shape | undefined {
  const r = (x: number) => Math.round(x * 1e6) / 1e6
  switch (kind) {
    case 'const':
      return undefined
    case 'exp':
      return { kind: 'exp' }
    case 'normal':
      return { kind: 'normal', sd: r(mean * 0.2) }
    case 'uniform':
      return { kind: 'uniform', min: r(mean * 0.5), max: r(mean * 1.5) }
    case 'triangular':
      return { kind: 'triangular', min: r(mean * 0.5), mode: r(mean), max: r(mean * 1.5) }
  }
}

/** The same shape moved by `delta` (a uniform or triangular follows a mean typed by hand); others stay. */
export function shiftShape(s: Shape, delta: number): Shape {
  if (s.kind === 'uniform') return { ...s, min: s.min + delta, max: s.max + delta }
  if (s.kind === 'triangular') return { ...s, min: s.min + delta, mode: s.mode + delta, max: s.max + delta }
  return s
}

// ---------------------------------------------------------------- sampling

/**
 * One time with this shape around `figure` (the mean). No shape = the figure itself, and no random number is drawn.
 * A normal is cut by redrawing (at most 100 tries); if almost nothing of it is left it falls back to a uniform
 * value inside the cut and calls `onCut`.
 */
export function sample(shape: Shape | undefined, figure: number, rng: Rng, onCut?: () => void): number {
  if (!shape) return figure
  switch (shape.kind) {
    case 'exp':
      return -figure * Math.log(1 - rng())
    case 'normal': {
      if (shape.sd <= 0) return figure
      const { lo, hi } = cutOf(shape)
      for (let i = 0; i < 100; i++) {
        const x = figure + shape.sd * Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng())
        if (x >= lo && x <= hi) return x
      }
      onCut?.()
      const top = Number.isFinite(hi) ? hi : Math.max(lo, figure) * 2
      return lo + (top - lo) * rng()
    }
    case 'uniform':
      return shape.min + (shape.max - shape.min) * rng()
    case 'triangular': {
      const { min: a, mode: c, max: b } = shape
      if (b <= a) return a
      const u = rng()
      const f = (c - a) / (b - a)
      return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c))
    }
  }
}
