// Share as file (SPEC §10.2): the story on the screen, or the open process (with its review), as a small .flow.html
// whose link opens it in Quaera Flow; the same link can be copied. On load, `#share=` opens what it holds.
import { LIVE_ORIGIN, packShare, shareFromHash, shareHtml, shareUrl, SHARE_EXTENSION, SOFT_URL_LIMIT, unpackShare, type SharePayload } from '../core/shareLink'
import { fileBaseName, saveExport } from './files'
import { openProcess } from './docs'
import { useEditor } from './store'
import { useStory } from './story/storyStore'

/** Testing: `?sharehere` makes the file point at the page's own origin (the dev server) instead of the live site. */
const origin = () => (new URLSearchParams(location.search).has('sharehere') ? location.origin : LIVE_ORIGIN)

/** What there is to share now: the story on the screen (a review replay shares its model), else the open process. */
function current(): { payload: SharePayload; name: string } {
  const { story, frames } = useStory.getState()
  const ed = useEditor.getState()
  if (story && !frames.some((f) => f.review)) return { payload: { kind: 'story', story: story.model ? story : { ...story, model: ed.model } }, name: story.title }
  return { payload: { kind: 'model', model: ed.model }, name: ed.model.name || 'process' }
}

const kb = (n: number) => (n < 1e6 ? `${Math.round(n / 1000)} KB` : `${(n / 1e6).toFixed(1)} MB`)
const PRIVACY = 'The content stays inside the link after the #, which is never sent to a server.'

async function build() {
  const { payload, name } = current()
  if (payload.kind === 'model' && !payload.model.nodes.length) throw new Error('the process is empty, nothing to share')
  const url = shareUrl(await packShare(payload), origin())
  const warn = url.length > SOFT_URL_LIMIT ? ` The link is ${kb(url.length)}: some browsers cut links over about 1.5 MB, so test that it opens.` : ''
  return { url, name, warn, kind: payload.kind }
}

/** Share as file…: writes `<name>.flow.html`. Returns a note, or null when cancelled. */
export async function shareAsFile(): Promise<string | null> {
  const { url, name, warn, kind } = await build()
  const saved = await saveExport(`${fileBaseName(name)}${SHARE_EXTENSION}`, 'html', async () => new Blob([shareHtml(name, url)], { type: 'text/html' }))
  if (!saved) return null
  return `Saved ${saved}: send this one file. Opening it lands in Quaera Flow with the ${kind === 'story' ? 'story' : 'process'} loaded. ${PRIVACY}${warn}`
}

/** Copy share link: the raw link to the clipboard. */
export async function copyShareLink(): Promise<string> {
  const { url, warn } = await build()
  await navigator.clipboard.writeText(url)
  return `Link copied (${kb(url.length)}). A long link may look odd in a chat: Share as file is tidier. ${PRIVACY}${warn}`
}

/** At start: opens what `#share=` holds (a story at beat 1, or a process in a new tab), then drops the fragment. */
export async function openSharedFromHash(): Promise<boolean> {
  const data = shareFromHash(location.hash)
  if (data === null) return false
  history.replaceState(null, '', location.pathname + location.search)
  const { say, showError } = useEditor.getState()
  try {
    const p = await unpackShare(data)
    if (p.kind === 'story') {
      useStory.getState().open(p.story)
      say(`Opened the shared story “${p.story.title}”: ← → step through it, Present for full screen.`)
    } else {
      openProcess(p.model)
      say(`Opened the shared process “${p.model.name || 'process'}”.${p.model.review ? ' Its changes are in the Changes panel; Play review tells them fix by fix.' : ''}`)
    }
  } catch (e) {
    showError(`The shared link could not be opened: ${(e as Error).message}`)
  }
  return true
}

/** The buttons' entry: shares and tells the result in the notice. */
export async function shareNow(copy: boolean): Promise<void> {
  try {
    const note = await (copy ? copyShareLink() : shareAsFile())
    useEditor.getState().say(note ?? 'Share cancelled.')
  } catch (e) {
    useEditor.getState().showError(`Not shared: ${(e as Error).message}`)
  }
}
