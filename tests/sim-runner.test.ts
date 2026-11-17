// Stage 6b phase 3: the worker protocol and the runner (run id, Cancel, fallback) with a fake worker.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseModel } from '../src/core/serialize'
import { emptyModel } from '../src/core/metamodel'
import { simulate, type SimResult } from '../src/core/simulate'
import { SimRunner, type RunHandlers, type WorkerLike } from '../src/ui/simRunner'
import { runJob } from '../src/ui/simWorkerCore'
import type { FromWorker, ToWorker } from '../src/ui/simProtocol'

const kaiyo = parseModel(readFileSync('cases/kaiyo-order.flow.json', 'utf8'))
const opts = { level: 3 as const, cases: 100, runs: 2, seed: 1 }

/** A worker that does its job when told to `flush()`, so a test decides when messages arrive. */
class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: FromWorker }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onmessageerror: ((e: unknown) => void) | null = null
  terminated = false
  jobs: ToWorker[] = []
  out: FromWorker[] = []
  postMessage(m: ToWorker) {
    this.jobs.push(m)
  }
  terminate() {
    this.terminated = true
  }
  /** Runs the queued jobs; their messages are held until `deliver()`. */
  flush() {
    for (const j of this.jobs.splice(0)) runJob(j, (m) => this.out.push(m), () => 0)
  }
  deliver() {
    for (const m of this.out.splice(0)) this.onmessage?.({ data: m })
  }
}

function collect() {
  const got = { progress: [] as number[], results: [] as SimResult[], errors: [] as string[], fallback: 0 }
  const h: RunHandlers = {
    onProgress: (d) => got.progress.push(d),
    onResult: (r) => got.results.push(r),
    onError: (m) => got.errors.push(m),
    onFallback: () => got.fallback++,
  }
  return { got, h }
}

describe('worker job', () => {
  it('posts the result with the run id, equal to simulate()', () => {
    const out: FromWorker[] = []
    runJob({ type: 'run', id: 7, model: kaiyo, options: opts }, (m) => out.push(m))
    const last = out[out.length - 1]
    expect(last.type).toBe('result')
    expect(last.id).toBe(7)
    expect((last as { result: SimResult }).result).toEqual(simulate(kaiyo, opts))
  })
  it('reports a SimError as text, never throws', () => {
    const out: FromWorker[] = []
    runJob({ type: 'run', id: 1, model: emptyModel('Empty'), options: { level: 2 } }, (m) => out.push(m))
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('error')
    expect((out[0] as { message: string }).message.length).toBeGreaterThan(5)
  })
  it('reports progress about every 100 ms', () => {
    let t = 0
    const out: FromWorker[] = []
    runJob({ type: 'run', id: 1, model: kaiyo, options: { level: 3, cases: 2000, runs: 1 } }, (m) => out.push(m), () => (t += 150))
    expect(out.filter((m) => m.type === 'progress').length).toBeGreaterThan(0)
  })
})

describe('runner with a worker', () => {
  it('delivers the result of the current run', () => {
    const w = new FakeWorker()
    const r = new SimRunner(() => w)
    const { got, h } = collect()
    const id = r.run(kaiyo, opts, h)
    expect(w.jobs[0].id).toBe(id)
    w.flush()
    w.deliver()
    expect(got.results).toHaveLength(1)
    expect(got.results[0].completed).toBe(200)
    expect(r.running).toBe(false)
  })
  it('Cancel terminates the worker, reports nothing, and a late message is dropped', () => {
    const w = new FakeWorker()
    const r = new SimRunner(() => w)
    const { got, h } = collect()
    r.run(kaiyo, opts, h)
    w.flush()
    r.cancel()
    expect(w.terminated).toBe(true)
    w.deliver()
    expect(got.results).toHaveLength(0)
    expect(r.running).toBe(false)
  })
  it('after Cancel a new run gets a new worker and the old run id is ignored', () => {
    const made: FakeWorker[] = []
    const r = new SimRunner(() => {
      const w = new FakeWorker()
      made.push(w)
      return w
    })
    const a = collect()
    const b = collect()
    r.run(kaiyo, opts, a.h)
    made[0].flush()
    r.cancel()
    const id2 = r.run(kaiyo, { ...opts, seed: 2 }, b.h)
    expect(made).toHaveLength(2)
    // a stray message of the first run reaches the second worker's handler: dropped by its id
    made[1].onmessage?.({ data: made[0].out[made[0].out.length - 1] })
    expect(b.got.results).toHaveLength(0)
    made[1].flush()
    made[1].deliver()
    expect(b.got.results).toHaveLength(1)
    expect(b.got.results[0].seed).toBe(2)
    expect(made[1].jobs.length + made[1].out.length).toBeGreaterThanOrEqual(0)
    expect(id2).toBe(2)
    expect(a.got.results).toHaveLength(0)
  })
  it('a second run() while one is going replaces it: one result only', () => {
    const w = new FakeWorker()
    const r = new SimRunner(() => w)
    const { got, h } = collect()
    r.run(kaiyo, opts, h)
    r.run(kaiyo, opts, h)
    w.flush()
    w.deliver()
    expect(got.results).toHaveLength(1)
  })
  it('passes the SimError text on', () => {
    const w = new FakeWorker()
    const r = new SimRunner(() => w)
    const { got, h } = collect()
    r.run(emptyModel('Empty'), { level: 3 }, h)
    w.flush()
    w.deliver()
    expect(got.errors).toHaveLength(1)
    expect(got.results).toHaveLength(0)
  })
})

describe('runner without a worker', () => {
  const queue: (() => void)[] = []
  const schedule = (fn: () => void) => void queue.push(fn)
  const drain = () => {
    let n = 0
    while (queue.length) {
      queue.shift()!()
      n++
    }
    return n
  }

  it('worker constructor throws: runs on the main thread in slices with progress, and says so', () => {
    const r = new SimRunner(() => {
      throw new Error('no worker')
    }, schedule)
    const { got, h } = collect()
    r.run(kaiyo, { level: 3, cases: 5000, runs: 1 }, h)
    expect(got.fallback).toBe(1)
    expect(got.results).toHaveLength(0)
    const slices = drain()
    expect(slices).toBeGreaterThan(1)
    expect(got.progress.length).toBe(slices)
    expect(got.results).toHaveLength(1)
    expect(got.results[0]).toEqual(simulate(kaiyo, { level: 3, cases: 5000, runs: 1 }))
  })
  it('worker that fails to load (error event) hands the run to the main thread', () => {
    const w = new FakeWorker()
    const r = new SimRunner(() => w, schedule)
    const { got, h } = collect()
    r.run(kaiyo, opts, h)
    w.onerror?.(new Error('404'))
    expect(got.fallback).toBe(1)
    drain()
    expect(got.results).toHaveLength(1)
    expect(r.usesWorker).toBe(false)
  })
  it('Cancel stops the slices', () => {
    const r = new SimRunner(null, schedule)
    const { got, h } = collect()
    r.run(kaiyo, { level: 3, cases: 5000, runs: 1 }, h)
    queue.shift()!()
    r.cancel()
    drain()
    expect(got.results).toHaveLength(0)
    expect(got.progress.length).toBe(1)
  })
  it('SimError on the main thread is text, not a throw', () => {
    const r = new SimRunner(null, schedule)
    const { got, h } = collect()
    expect(() => r.run(emptyModel('Empty'), { level: 2 }, h)).not.toThrow()
    expect(got.errors).toHaveLength(1)
  })
})
