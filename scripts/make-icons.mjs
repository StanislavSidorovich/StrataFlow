// Generates the PWA icons in public/ (the Flow mark from the family kit, same as the favicon).
// Pure Node, no dependencies: run `node scripts/make-icons.mjs` after changing the design.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [255, 255, 255]
const ACCENT = [0x0f, 0x76, 0x6e] // Flow's family accent, as in src/family/marks/flow.svg

// Rounded rect test: x0..x1, y0..y1, corner radius r.
function inRound(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
// The white process sign on the 32-unit tile (marks/flow.svg): start event (ring), task, two
// sequence-flow stubs, gateway (diamond outline).
function inSign(x, y) {
  const d = Math.hypot(x - 7, y - 16)
  if (d >= 3.2 - 0.9 && d <= 3.2 + 0.9) return true
  if (inRound(x, y, 12, 11.5, 21, 20.5, 2)) return true
  if (y >= 15.2 && y <= 16.8 && ((x >= 10.2 && x <= 12) || (x >= 21 && x <= 22.6))) return true
  const l1 = Math.abs(x - 26) + Math.abs(y - 16)
  return l1 >= 3.5 - 0.8 * Math.SQRT2 && l1 <= 3.5 + 0.8 * Math.SQRT2
}

// In a 32-unit box like the mark; `pad` shrinks the art; `full` fills the whole square with the tile
// colour (maskable and Apple icons are masked by the system), otherwise the tile is rounded (rx 7) on white.
function pixel(x, y, size, pad, full) {
  const u = 32 / (size * (1 - 2 * pad))
  const px = (x + 0.5 - size * pad) * u
  const py = (y + 0.5 - size * pad) * u
  let tile = 0
  let sign = 0
  for (let sy = 0; sy < 4; sy++)
    for (let sx = 0; sx < 4; sx++) {
      const qx = px + ((sx + 0.5) / 4 - 0.5) * u
      const qy = py + ((sy + 0.5) / 4 - 0.5) * u
      if (full || inRound(qx, qy, 0, 0, 32, 32, 7)) tile++
      if (inSign(qx, qy)) sign++
    }
  const base = BG.map((b, k) => Math.round(b + ((ACCENT[k] - b) * tile) / 16))
  return base.map((b, k) => Math.round(b + ((255 - b) * sign) / 16))
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, pad, full) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) raw.set(pixel(x, y, size, pad, full), y * (size * 3 + 1) + 1 + x * 3)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync('public/icon-192.png', png(192, 0, false))
writeFileSync('public/icon-512.png', png(512, 0, false))
writeFileSync('public/icon-maskable-512.png', png(512, 0.14, true)) // safe zone for round/squircle masks
writeFileSync('public/apple-touch-icon.png', png(180, 0.08, true))
console.log('icons written to public/')
