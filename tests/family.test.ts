import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// src/family/ is a copy of quaera/family/ (the family kit, laid out by quaera/scripts/family-sync.mjs).
// Do not edit it here: a hash that differs from MANIFEST.json means the copy was changed or is stale.
const dir = 'src/family'
const manifest = JSON.parse(readFileSync(`${dir}/MANIFEST.json`, 'utf8')) as { files: Record<string, string> }

// Same rule as family-sync.mjs: text files are hashed with LF endings (git may check them out as CRLF).
const TEXT = new Set(['.css', '.js', '.json', '.svg', '.txt', '.html', '.ts'])
function hashOf(file: string): string {
  let buf = readFileSync(`${dir}/${file}`)
  if (TEXT.has(path.extname(file))) buf = Buffer.from(buf.toString('utf8').replaceAll('\r\n', '\n'), 'utf8')
  return createHash('sha256').update(buf).digest('hex')
}

describe('family kit', () => {
  it('lists the files it ships', () => {
    expect(Object.keys(manifest.files).length).toBeGreaterThan(10)
  })
  it.each(Object.entries(manifest.files))('%s matches MANIFEST.json', (file, hash) => {
    expect(hashOf(file)).toBe(hash)
  })
})
