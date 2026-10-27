// Share as file (core/shareLink.ts): pack and unpack a story and a reviewed model, refuse damaged and newer data, the HTML file.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeFix, reviewDiff, startReview } from '../src/core/diff'
import { reviewReplay } from '../src/core/reviewReplay'
import { rename } from '../src/core/ops'
import { parseModel } from '../src/core/serialize'
import { packShare, ShareError, shareFromHash, shareHtml, shareUrl, SOFT_URL_LIMIT, unpackShare } from '../src/core/shareLink'
import { parseStory } from '../src/core/story'

const shopModel = () => parseModel(readFileSync('cases/shop-order.flow.json', 'utf8'))
const shopStory = () => parseStory(readFileSync('cases/shop-order.flow-story.json', 'utf8'), shopModel())

describe('share data', () => {
  it('round-trips the shop-order story with its model', async () => {
    const story = shopStory()
    const data = await packShare({ kind: 'story', story })
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(data.length).toBeLessThan(SOFT_URL_LIMIT)
    const back = await unpackShare(data)
    expect(back.kind).toBe('story')
    if (back.kind !== 'story') return
    expect(back.story.title).toBe(story.title)
    expect(back.story.beats).toEqual(story.beats)
    expect(back.story.model).toEqual(story.model)
  })

  it('round-trips a model with its review, which still plays', async () => {
    const base = parseModel(readFileSync('cases/library-lend.flow.json', 'utf8'))
    const m = structuredClone(base)
    const task = m.nodes.find((n) => n.type === 'task')!
    rename(m, task.id, 'Renamed step')
    startReview(m, base)
    const d = reviewDiff(m)!
    expect(makeFix(m, [d.changes[0].key])).toBeTruthy()
    m.review!.fixes!.forEach((f) => (f.text = 'A note'))
    const back = await unpackShare(await packShare({ kind: 'model', model: m }))
    expect(back.kind).toBe('model')
    if (back.kind !== 'model') return
    expect(back.model).toEqual(m)
    expect(reviewReplay(back.model)).not.toBeNull()
  })

  it('refuses damaged data', async () => {
    await expect(unpackShare('not-a-link')).rejects.toThrow(ShareError)
    const data = await packShare({ kind: 'model', model: shopModel() })
    await expect(unpackShare(data.slice(0, 40))).rejects.toThrow(/damaged or incomplete/)
  })

  it('refuses a newer format with a hint to update', async () => {
    const stream = new Blob([JSON.stringify({ v: 99, kind: 'model' })]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    await expect(unpackShare(Buffer.from(bytes).toString('base64url'))).rejects.toThrow(/newer version/)
  })
})

describe('link and file', () => {
  it('reads the data from the hash', () => {
    expect(shareFromHash('#share=abc_-1')).toBe('abc_-1')
    expect(shareFromHash('#x=1&share=zz')).toBe('zz')
    expect(shareFromHash('#ds=quaera')).toBeNull()
    expect(shareFromHash('')).toBeNull()
  })
  it('builds the url for live or another origin', () => {
    expect(shareUrl('abc')).toBe('https://flow.quaera.app/#share=abc')
    expect(shareUrl('abc', 'http://localhost:5174/')).toBe('http://localhost:5174/#share=abc')
  })
  it('writes a self-contained page with the link twice and no external resource', () => {
    const url = shareUrl('abc')
    const html = shareHtml('Shop <order> & co', url)
    expect(html).toContain('<title>Shop &lt;order&gt; &amp; co</title>')
    expect(html).toContain(`location.replace("${url}")`)
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('Open in Quaera Flow')
    expect(html).toContain('never sent to a server')
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html.match(/https?:\/\/[^"'\s)]+/g)!.every((u) => u.startsWith('https://flow.quaera.app'))).toBe(true)
  })
})
