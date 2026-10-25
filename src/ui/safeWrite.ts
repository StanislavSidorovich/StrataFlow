// Writes a file that takes time to prepare (a picture) without leaving a broken one behind.
// The browser creates the empty file when the save dialog closes; if the picture never gets drawn, the file
// would stay empty (0 KB) and the writer's temporary `.crswap` copy next to it, with no word to the user.

export interface PreparedWritable {
  write: (data: string | Blob) => Promise<void>
  close: () => Promise<void>
  /** Drops what was written so far (Chrome removes the temporary copy). */
  abort?: () => Promise<void>
}

export interface PreparedFile {
  name: string
  createWritable: () => Promise<PreparedWritable>
  /** Not in every browser: deletes the file the dialog created. */
  remove?: () => Promise<void>
}

/**
 * How long a picture may take to draw before we give up. A wide diagram took 2-3 minutes on the owner's machine
 * (the file stays at 0 KB until the end), so the limit must be well above that.
 */
export const PREPARE_TIMEOUT_MS = 6 * 60_000

export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

const spell = (ms: number) => (ms >= 120_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} s`)

export const slowMessage = (name: string, ms: number) =>
  `${name} took longer than ${spell(ms)} to prepare. Close other tabs and try again; Export SVG is lighter for a big diagram.`

/** Writes what `make` prepares into `file`; on any failure the file is discarded and the error passes on. */
export async function writePrepared(file: PreparedFile, make: () => Promise<Blob>, ms = PREPARE_TIMEOUT_MS): Promise<void> {
  const out = await file.createWritable()
  try {
    await out.write(await withTimeout(make(), ms, slowMessage(file.name, ms)))
    await out.close()
  } catch (e) {
    await out.abort?.().catch(() => undefined)
    let removed = false
    try {
      await file.remove?.()
      removed = file.remove !== undefined
    } catch {
      removed = false
    }
    const why = e instanceof Error ? e.message : String(e)
    throw new Error(removed ? why : `${why} An empty file "${file.name}" may be left in the folder; delete it.`)
  }
}
