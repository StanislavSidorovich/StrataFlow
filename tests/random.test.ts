// Seeded generator, the shapes of times and Erlang C (stage 6b, phase 1).
import { describe, expect, it } from 'vitest'
import { cleanShape, defaultShape, hashSeed, makeRng, sample, shapeMean, shapeSd, shiftShape, streamFor, validateShape } from '../src/core/random'
import { mmc } from '../src/core/queue'
import { parseNum } from '../src/core/number'
import type { Shape } from '../src/core/metamodel'

const N = 200_000
function moments(shape: Shape | undefined, figure: number, seed = 7) {
  const rng = makeRng(seed)
  let s = 0
  let s2 = 0
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < N; i++) {
    const x = sample(shape, figure, rng)
    s += x
    s2 += x * x
    lo = Math.min(lo, x)
    hi = Math.max(hi, x)
  }
  const mean = s / N
  return { mean, sd: Math.sqrt(s2 / N - mean * mean), lo, hi }
}
const near = (got: number, want: number, tol = 0.01) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol * Math.abs(want))

describe('seeded generator', () => {
  it('repeats for the same seed and differs for another', () => {
    const a = makeRng(42)
    const b = makeRng(42)
    const c = makeRng(43)
    const xs = Array.from({ length: 20 }, () => a())
    expect(Array.from({ length: 20 }, () => b())).toEqual(xs)
    expect(Array.from({ length: 20 }, () => c())).not.toEqual(xs)
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
  })
  it('gives every element its own stream, stable for a seed', () => {
    expect(hashSeed(1, 'Task_1', 'duration')).toBe(hashSeed(1, 'Task_1', 'duration'))
    expect(hashSeed(1, 'Task_1', 'duration')).not.toBe(hashSeed(1, 'Task_2', 'duration'))
    expect(hashSeed(1, 'Task_1', 'duration')).not.toBe(hashSeed(1, 'Task_1', 'wait'))
    expect(hashSeed(1, 'Task_1', 'duration')).not.toBe(hashSeed(2, 'Task_1', 'duration'))
    expect(streamFor(1, 'A', 'x')()).toBe(streamFor(1, 'A', 'x')())
  })
  it('is uniform: mean 1/2 and variance 1/12', () => {
    const { mean, sd } = moments(undefined, 0.5)
    expect(mean).toBe(0.5) // no shape: the figure, no draw
    expect(sd).toBe(0)
    const rng = makeRng(3)
    let s = 0
    let s2 = 0
    for (let i = 0; i < N; i++) {
      const u = rng()
      s += u
      s2 += u * u
    }
    near(s / N, 0.5)
    near(s2 / N - (s / N) ** 2, 1 / 12)
  })
})

describe('samplers: mean and spread over a large sample', () => {
  const cases: [string, Shape, number][] = [
    ['exponential', { kind: 'exp' }, 2],
    ['normal far from the cut', { kind: 'normal', sd: 0.5 }, 10],
    ['normal cut at 0 (σ = mean)', { kind: 'normal', sd: 1 }, 1],
    ['normal with min and max', { kind: 'normal', sd: 1, min: 0.5, max: 2 }, 1],
    ['uniform', { kind: 'uniform', min: 2, max: 4 }, 3],
    ['triangular', { kind: 'triangular', min: 0.5, mode: 1, max: 3 }, 1.5],
    ['triangular, mode at the end', { kind: 'triangular', min: 1, mode: 3, max: 3 }, 7 / 3],
  ]
  for (const [name, shape, figure] of cases)
    it(name, () => {
      const m = moments(shape, figure)
      near(m.mean, shapeMean(shape, figure))
      near(m.sd, shapeSd(shape, figure), 0.02)
    })

  it('a normal is never drawn outside its cut', () => {
    const m = moments({ kind: 'normal', sd: 1 }, 1)
    expect(m.lo).toBeGreaterThanOrEqual(0)
    const c = moments({ kind: 'normal', sd: 2, min: 1, max: 3 }, 2)
    expect(c.lo).toBeGreaterThanOrEqual(1)
    expect(c.hi).toBeLessThanOrEqual(3)
  })
  it('the cut at 0 moves the mean up: μ = 1, σ = 1 gives about 1.29', () => {
    expect(shapeMean({ kind: 'normal', sd: 1 }, 1)).toBeCloseTo(1.2876, 3)
    expect(shapeMean({ kind: 'normal', sd: 0.2 }, 10)).toBeCloseTo(10, 6)
  })
  it('uniform and triangular carry their own mean', () => {
    expect(shapeMean({ kind: 'uniform', min: 2, max: 4 }, 99)).toBe(3)
    expect(shapeMean({ kind: 'triangular', min: 0.25, mode: 0.5, max: 0.75 }, 99)).toBe(0.5)
  })
  it('falls back to a uniform value inside the cut when almost nothing of the bell is left, and says so', () => {
    let cut = 0
    const rng = makeRng(1)
    const x = sample({ kind: 'normal', sd: 0.01, min: 50, max: 60 }, 1, rng, () => cut++)
    expect(cut).toBe(1)
    expect(x).toBeGreaterThanOrEqual(50)
    expect(x).toBeLessThanOrEqual(60)
  })
  it('σ = 0 and a degenerate triangular are constants', () => {
    expect(sample({ kind: 'normal', sd: 0 }, 5, makeRng(1))).toBe(5)
    expect(sample({ kind: 'triangular', min: 2, mode: 2, max: 2 }, 2, makeRng(1))).toBe(2)
  })
  it('a mean of 0 stays 0 for an exponential', () => {
    expect(sample({ kind: 'exp' }, 0, makeRng(1))).toBeCloseTo(0, 12)
  })
})

describe('validation of shapes', () => {
  it('refuses σ < 0, min above max, a mode outside the range, a negative min', () => {
    expect(validateShape({ kind: 'normal', sd: -1 })).toMatch(/spread/)
    expect(validateShape({ kind: 'normal', sd: 1, min: 3, max: 2 })).toMatch(/min/)
    expect(validateShape({ kind: 'normal', sd: 1, min: -1 })).toMatch(/below 0/)
    expect(validateShape({ kind: 'uniform', min: 4, max: 2 })).toMatch(/min/)
    expect(validateShape({ kind: 'uniform', min: -1, max: 2 })).toMatch(/below 0/)
    expect(validateShape({ kind: 'triangular', min: 1, mode: 5, max: 3 })).toMatch(/most likely/)
    expect(validateShape({ kind: 'triangular', min: 1, mode: 0.5, max: 3 })).toMatch(/most likely/)
    expect(validateShape({ kind: 'weibull' } as unknown as Shape)).toBe('Unknown shape')
    expect(validateShape({ kind: 'uniform', min: 1, max: 3 })).toBeUndefined()
  })
  it('cleans a shape read from a file: unknown or invalid ones are dropped, σ = 0 is a constant', () => {
    expect(cleanShape({ kind: 'weibull', k: 2 })).toBeUndefined()
    expect(cleanShape({ kind: 'uniform', min: 'a', max: 3 })).toBeUndefined()
    expect(cleanShape({ kind: 'uniform', min: 4, max: 3 })).toBeUndefined()
    expect(cleanShape({ kind: 'normal', sd: 0 })).toBeUndefined()
    expect(cleanShape(null)).toBeUndefined()
    expect(cleanShape({ kind: 'normal', sd: 2, min: 1, junk: true })).toEqual({ kind: 'normal', sd: 2, min: 1 })
  })
  it('picker defaults keep the mean', () => {
    for (const kind of ['exp', 'normal', 'uniform', 'triangular'] as const) {
      const s = defaultShape(kind, 4)!
      expect(validateShape(s)).toBeUndefined()
      near(shapeMean(s, 4), 4, 0.02)
    }
    expect(defaultShape('const', 4)).toBeUndefined()
    expect(shiftShape({ kind: 'uniform', min: 1, max: 3 }, 2)).toEqual({ kind: 'uniform', min: 3, max: 5 })
    expect(shiftShape({ kind: 'exp' }, 2)).toEqual({ kind: 'exp' })
  })
})

describe('Erlang C (M/M/c)', () => {
  it('M/M/1: λ = 1.5, 1/μ = 0.5 h gives ρ 0.75, Wq 1.5 h, W 2 h', () => {
    const q = mmc(1.5, 0.5, 1)
    expect(q.stable).toBe(true)
    expect(q.rho).toBeCloseTo(0.75, 10)
    expect(q.pWait).toBeCloseTo(0.75, 10)
    expect(q.wq).toBeCloseTo(1.5, 10)
    expect(q.w).toBeCloseTo(2, 10)
    expect(q.lq).toBeCloseTo(2.25, 10)
    expect(q.l).toBeCloseTo(3, 10)
  })
  it('M/M/2 with the same λ and μ: Wq 0.0818 h, W 0.5818 h, ρ 0.375', () => {
    const q = mmc(1.5, 0.5, 2)
    expect(q.rho).toBeCloseTo(0.375, 10)
    expect(q.pWait).toBeCloseTo(0.204545, 5)
    expect(q.wq).toBeCloseTo(0.0818, 4)
    expect(q.w).toBeCloseTo(0.5818, 4)
  })
  it('the knee of M/M/1: the wait is 3, 9 and 19 times the work at ρ 0.75, 0.9, 0.95', () => {
    for (const [rho, k] of [[0.75, 3], [0.9, 9], [0.95, 19]] as const) expect(mmc(rho, 1, 1).wq).toBeCloseTo(k, 8)
  })
  it('a known M/M/3 value: a = 2 Erlangs gives Erlang C = 4/9', () => {
    const q = mmc(2, 1, 3)
    expect(q.pWait).toBeCloseTo(4 / 9, 10)
    expect(q.wq).toBeCloseTo(4 / 9 / (3 - 2), 10)
  })
  it('ρ ≥ 1: an honest infinite queue, not NaN', () => {
    for (const [l, s, c] of [[2, 0.5, 1], [3, 1, 2], [5, 1, 2]] as const) {
      const q = mmc(l, s, c)
      expect(q.stable).toBe(false)
      expect(q.wq).toBe(Infinity)
      expect(Number.isNaN(q.rho)).toBe(false)
    }
  })
  it('no work or no arrivals: no queue; a large c does not overflow', () => {
    expect(mmc(0, 1, 2).wq).toBe(0)
    expect(mmc(1, 0, 2).wq).toBe(0)
    const big = mmc(150, 1, 200)
    expect(Number.isFinite(big.wq)).toBe(true)
    expect(big.wq).toBeGreaterThanOrEqual(0)
  })
  it('a fractional capacity is rounded, never below 1', () => {
    expect(mmc(0.3, 1, 0.2).rho).toBeCloseTo(0.3, 10)
    expect(mmc(1.5, 0.5, 1.6).rho).toBeCloseTo(0.375, 10)
  })
})

describe('shared number parser', () => {
  it('reads dot or comma as the decimal mark, ignores spaces, accepts % in a percent field', () => {
    expect(parseNum('1.5')).toEqual({ value: 1.5 })
    expect(parseNum('0,5')).toEqual({ value: 0.5 })
    expect(parseNum(' 1 000 ')).toEqual({ value: 1000 })
    expect(parseNum('1 000,5')).toEqual({ value: 1000.5 })
    expect(parseNum('90%', { percent: true })).toEqual({ value: 90 })
    expect(parseNum('.5')).toEqual({ value: 0.5 })
    expect(parseNum('1.')).toEqual({ value: 1 }) // while typing
    expect(parseNum('-2')).toEqual({ value: -2 })
  })
  it('an empty field clears; the rest is refused, never guessed', () => {
    expect(parseNum('')).toEqual({})
    expect(parseNum('   ')).toEqual({})
    expect(parseNum('1.000,5').error).toBeDefined()
    expect(parseNum('1,000.5').error).toBeDefined()
    expect(parseNum('90%').error).toBeDefined()
    expect(parseNum('abc').error).toBeDefined()
    expect(parseNum('1,2,3').error).toBeDefined()
    expect(parseNum('1e5').error).toBeDefined()
    expect(parseNum('-').error).toBeDefined()
  })
})
