// Share as file (SPEC §10.2): a story or a model travels in the URL fragment `#share=<data>`, compressed (compact JSON,
// deflate-raw, base64url). Nothing is uploaded: the fragment never reaches a server. The file `<name>.flow.html` only
// carries such a link; opening the link gives the reader a copy.
import type { FlowModel } from './metamodel'
import { parseModel } from './serialize'
import { parseStory, type Story } from './story'

/** The fragment key: `https://flow.quaera.app/#share=<data>`. */
export const SHARE_PARAM = 'share'
/** The address a shared file always points at. */
export const LIVE_ORIGIN = 'https://flow.quaera.app'
/** The payload's format number; a newer one is refused with a message to update. */
export const SHARE_VERSION = 1
/** Above this many characters of URL some browsers cut the link. */
export const SOFT_URL_LIMIT = 1_500_000
export const SHARE_EXTENSION = '.flow.html'

export class ShareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareError'
  }
}

/** What travels: a story (with its model inside), or a model (with its review, if any). */
export type SharePayload = { kind: 'story'; story: Story } | { kind: 'model'; model: FlowModel }

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** The payload as a URL-safe string. */
export async function packShare(p: SharePayload): Promise<string> {
  const body = p.kind === 'story' ? { v: SHARE_VERSION, kind: 'story', story: p.story } : { v: SHARE_VERSION, kind: 'model', model: p.model }
  return toBase64Url(await pipe(new TextEncoder().encode(JSON.stringify(body)), new CompressionStream('deflate-raw')))
}

/** The payload back from {@link packShare}; a damaged or newer link throws a ShareError with a readable message. */
export async function unpackShare(data: string): Promise<SharePayload> {
  let raw: { v?: unknown; kind?: unknown; story?: unknown; model?: unknown }
  try {
    raw = JSON.parse(new TextDecoder().decode(await pipe(fromBase64Url(data.trim()), new DecompressionStream('deflate-raw'))))
  } catch {
    throw new ShareError('The link is damaged or incomplete (it may have been cut when it was copied). Ask for the file again.')
  }
  if (!raw || typeof raw !== 'object') throw new ShareError('The link does not hold a story or a process.')
  if (typeof raw.v === 'number' && raw.v > SHARE_VERSION) throw new ShareError('This link was made by a newer version of Quaera Flow. Reload the page (or Help → Check for updates) and open it again.')
  if (raw.v !== SHARE_VERSION) throw new ShareError('The link does not hold a story or a process.')
  try {
    if (raw.kind === 'story') return { kind: 'story', story: parseStory(JSON.stringify(raw.story)) }
    if (raw.kind === 'model') return { kind: 'model', model: parseModel(JSON.stringify(raw.model)) }
  } catch (e) {
    throw new ShareError(`The shared ${String(raw.kind)} cannot be opened: ${(e as Error).message}`)
  }
  throw new ShareError('The link does not hold a story or a process.')
}

/** The full link to `origin` (the live site by default). */
export const shareUrl = (data: string, origin = LIVE_ORIGIN) => `${origin.replace(/\/+$/, '')}/#${SHARE_PARAM}=${data}`

/** The data in a `location.hash`, or null when the hash is not a share link. */
export function shareFromHash(hash: string): string | null {
  const m = new RegExp(`^#?(?:.*&)?${SHARE_PARAM}=([^&]*)`).exec(hash)
  return m ? m[1] : null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The tiny page that carries the link: redirects by script, shows a big link as the fallback. Nothing external. */
export function shareHtml(title: string, url: string): string {
  const t = esc(title.trim() || 'Shared from Quaera Flow')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.25rem;color:#1f2430}
h1{font-size:1.4rem;margin:0 0 .5rem}
a.go{display:block;margin:1.5rem 0;padding:1rem 1.25rem;background:#2563eb;color:#fff;border-radius:10px;text-align:center;font-size:1.25rem;font-weight:600;text-decoration:none}
p{color:#4a5160}
</style>
</head>
<body>
<h1>${t}</h1>
<p>Opening in Quaera Flow…</p>
<a class="go" id="go" href="${esc(url)}">Open in Quaera Flow</a>
<p>This file holds a process from Quaera Flow (BPMN modeling, part of Quaera). The whole content is inside the link after the # sign, which stays in your browser and is never sent to a server. If nothing opens, press the button.</p>
<script>location.replace(${JSON.stringify(url).replace(/</g, '\\u003c')})</script>
</body>
</html>
`
}
