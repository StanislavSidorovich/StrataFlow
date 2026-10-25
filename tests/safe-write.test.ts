import { describe, expect, it, vi } from 'vitest'
import { slowMessage, withTimeout, writePrepared, type PreparedFile } from '../src/ui/safeWrite'

function fakeFile(opts: { remove?: boolean } = {}) {
  const calls: string[] = []
  const file: PreparedFile = {
    name: 'insurance.png',
    createWritable: async () => ({
      write: async (d) => void calls.push(`write ${typeof d === 'string' ? d : (d as Blob).size}`),
      close: async () => void calls.push('close'),
      abort: async () => void calls.push('abort'),
    }),
    ...(opts.remove ? { remove: async () => void calls.push('remove') } : {}),
  }
  return { file, calls }
}

describe('writePrepared', () => {
  it('writes and closes when the picture is ready', async () => {
    const { file, calls } = fakeFile()
    await writePrepared(file, async () => new Blob(['abc']))
    expect(calls).toEqual(['write 3', 'close'])
  })

  it('aborts the writer and passes the error on when drawing fails', async () => {
    const { file, calls } = fakeFile({ remove: true })
    await expect(
      writePrepared(file, async () => {
        throw new Error('Image failed to load')
      }),
    ).rejects.toThrow('Image failed to load')
    expect(calls).toEqual(['abort', 'remove'])
  })

  it('tells the user about an empty file the browser could not delete', async () => {
    const { file } = fakeFile()
    await expect(
      writePrepared(file, async () => {
        throw new Error('Image failed to load')
      }),
    ).rejects.toThrow(/empty file "insurance\.png"/)
  })

  it('gives up with a clear message when drawing never finishes', async () => {
    vi.useFakeTimers()
    try {
      const { file, calls } = fakeFile({ remove: true })
      const result = writePrepared(file, () => new Promise<Blob>(() => undefined), 1000)
      const caught = result.catch((e: Error) => e)
      await vi.advanceTimersByTimeAsync(1000)
      const err = await caught
      expect((err as Error).message).toBe(slowMessage('insurance.png', 1000))
      expect(calls).toEqual(['abort', 'remove'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('withTimeout', () => {
  it('returns the value and clears the timer when work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, 'late')).resolves.toBe(7)
  })
})
