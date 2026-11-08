// Line jumps: where flows cross, the horizontal one hops; never at junctions or corners.
import { describe, expect, it } from 'vitest'
import { findJumps, pathWithJumps } from '../src/core/jumps'

const P = (x: number, y: number) => ({ x, y })

describe('findJumps', () => {
  it('a horizontal flow hops over a vertical one it crosses', () => {
    const j = findJumps(new Map([['h', [P(0, 50), P(100, 50)]], ['v', [P(50, 0), P(50, 100)]]]))
    expect(j.get('h')).toEqual([P(50, 50)])
    expect(j.has('v')).toBe(false)
  })
  it('no hop at a T junction, a corner or a shared end', () => {
    expect(findJumps(new Map([['h', [P(0, 50), P(100, 50)]], ['v', [P(50, 0), P(50, 50)]]])).size).toBe(0)
    expect(findJumps(new Map([['h', [P(0, 50), P(100, 50)]], ['v', [P(100, 0), P(100, 100)]]])).size).toBe(0)
    expect(findJumps(new Map([['a', [P(0, 50), P(50, 50), P(50, 100)]]])).size).toBe(0)
  })
  it('is the same whatever the order of the flows', () => {
    const a = findJumps(new Map([['h', [P(0, 50), P(100, 50)]], ['v', [P(50, 0), P(50, 100)]]]))
    const b = findJumps(new Map([['v', [P(50, 0), P(50, 100)]], ['h', [P(0, 50), P(100, 50)]]]))
    expect(a).toEqual(b)
  })
})

describe('pathWithJumps', () => {
  it('draws a semicircle over the crossing in the direction of travel', () => {
    expect(pathWithJumps([P(0, 50), P(100, 50)], [P(50, 50)])).toBe('M0 50 L45 50 A5 5 0 0 1 55 50 L100 50')
    expect(pathWithJumps([P(100, 50), P(0, 50)], [P(50, 50)])).toBe('M100 50 L55 50 A5 5 0 0 0 45 50 L0 50')
  })
  it('is the plain path without jumps', () => {
    expect(pathWithJumps([P(0, 0), P(0, 10), P(5, 10)], undefined)).toBe('M0 0 L0 10 L5 10')
  })
})
