// A small ZIP reader and writer, enough for a Bizagi project of several .bpmn files (no dependency).
// Writing stores the files uncompressed; reading takes stored and deflated entries (DecompressionStream,
// in every current browser and in Node 18+). No ZIP64, no encryption: a project is a few small XML files.

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A ZIP archive of the entries, stored without compression; names are UTF-8. */
export function writeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = enc.encode(e.name)
    const crc = crc32(e.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint32(14, crc, true)
    local.setUint32(18, e.data.length, true)
    local.setUint32(22, e.data.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, e.data)
    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(8, 0x0800, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, e.data.length, true)
    dir.setUint32(24, e.data.length, true)
    dir.setUint16(28, name.length, true)
    dir.setUint32(42, offset, true)
    central.push(new Uint8Array(dir.buffer), name)
    offset += 30 + name.length + e.data.length
  }
  const size = central.reduce((s, p) => s + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of all) (out.set(p, at), (at += p.length))
  return out
}

/** True when the bytes start like a ZIP archive. */
export const isZip = (data: Uint8Array) => data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 3 && data[3] === 4

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The files of a ZIP archive (folders skipped), read from its central directory. */
export async function readZip(data: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0) throw new Error('not a ZIP archive')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const utf8 = new TextDecoder()
  const latin = new TextDecoder('latin1')
  const out: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('broken ZIP directory')
    const flags = view.getUint16(at + 8, true)
    const method = view.getUint16(at + 10, true)
    const packed = view.getUint32(at + 20, true)
    const nameLen = view.getUint16(at + 28, true)
    const extra = view.getUint16(at + 30, true)
    const comment = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = (flags & 0x0800 ? utf8 : latin).decode(data.subarray(at + 46, at + 46 + nameLen))
    at += 46 + nameLen + extra + comment
    if (name.endsWith('/')) continue
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = data.subarray(start, start + packed)
    if (method === 0) out.push({ name, data: raw.slice() })
    else if (method === 8) out.push({ name, data: await inflate(raw) })
    else throw new Error(`${name}: compression method ${method} is not supported`)
  }
  return out
}
