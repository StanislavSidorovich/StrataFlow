// The Kaiyo Trading example, from File → Example and from a link (`?example=kaiyo`, quaera.app's data map).
import { parseModel } from '../core/serialize'
import kaiyoOrder from '../../cases/kaiyo-order.flow.json?raw'
import { openProcess, switchTo, useDocs } from './docs'
import type { FlowModel } from '../core/metamodel'
import type { SimLevel } from '../core/simulate'
import { useSim } from './panels/Simulate'
import { useRun } from './simRun'
import { hadStoredModel, useEditor } from './store'
import { useTry } from './panels/tryQuestions'

const NOTICE = 'Kaiyo Trading: an illustrative order process. The notes show what the data keeps; the times, costs and shares in Simulate are teaching figures, not the real Kaiyo figures. Help explains each element. Simulate → Run shows the queues, with three questions to try. Your other processes stay in their tabs.'

export function openKaiyo() {
  openProcess(parseModel(kaiyoOrder))
  useEditor.getState().say(NOTICE)
}

/** The Kaiyo example is recognised by its name (what its file says), so edits to the figures do not lose it. */
export const KAIYO_NAME = parseModel(kaiyoOrder).name
export const isKaiyo = (m: FlowModel) => m.name === KAIYO_NAME

/**
 * The Kaiyo example on the Run tab at a level (the lesson's practice and the cards' Kaiyo chip). A Kaiyo tab that is
 * already open is switched to, never opened a second time; whatever the student had open stays in its tab. The
 * "Try this" questions come back if they had been dismissed.
 */
export function openKaiyoOnRun(level: SimLevel = 2) {
  showKaiyo(false)
  useTry.getState().show()
  useSim.setState({ open: true, tab: 'run', play: null })
  useRun.setState({ level })
}

let fromLink = false

/** A visit from the link came for this model: no welcome card over it this time. */
export const cameFromExampleLink = () => fromLink

function dropParam(search: string, name: string) {
  const q = new URLSearchParams(search)
  q.delete(name)
  const rest = q.toString()
  return rest ? `?${rest}` : ''
}

function showKaiyo(first: boolean) {
  const model = parseModel(kaiyoOrder)
  const { parked } = useDocs.getState()
  const open = Object.keys(parked).find((id) => parked[id].model.name === model.name)
  if (first && !hadStoredModel) useEditor.setState({ model })
  else if (useEditor.getState().model.name === model.name) return
  else if (open) switchTo(open)
  else openProcess(model)
  useEditor.getState().say(NOTICE)
}

/**
 * At start: opens the example the link names (`?example=kaiyo`, or `#example=kaiyo`), then drops the parameter so a reload keeps the student's edits.
 * Runs after App's module, so a first visit has the library example on the canvas: it gives way, not a second tab.
 * A second click on the link returns to the tab it opened instead of adding another.
 */
export function openExampleFromLink() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('example') === 'kaiyo'
  const fromQuery = new URLSearchParams(location.search).get('example') === 'kaiyo'
  if (!fromHash && !fromQuery) return
  if (fromQuery) history.replaceState(null, '', location.pathname + dropParam(location.search, 'example') + location.hash)
  if (fromHash) clearHashExample()
  fromLink = true
  showKaiyo(true)
}

function clearHashExample() {
  const h = new URLSearchParams(location.hash.slice(1))
  h.delete('example')
  const rest = h.toString()
  history.replaceState(null, '', location.pathname + location.search + (rest ? `#${rest}` : ''))
}

/**
 * An open window takes `#example=kaiyo` without reloading: quaera.app's link, which Chrome's
 * `launch_handler: navigate-existing` delivers to the installed window, and a plain hashchange in a tab.
 * The example opens as its own tab, so unsaved work in the current one is never replaced.
 */
export function followExampleLinks() {
  const take = () => {
    if (new URLSearchParams(location.hash.slice(1)).get('example') !== 'kaiyo') return
    clearHashExample()
    showKaiyo(false)
  }
  window.addEventListener('hashchange', take)
  const queue = (window as unknown as { launchQueue?: { setConsumer(f: (p: { targetURL?: string }) => void): void } }).launchQueue
  queue?.setConsumer(({ targetURL }) => {
    if (!targetURL) return
    try {
      const u = new URL(targetURL)
      // Same hash as now (already consumed or not): hashchange would not fire, so take it directly.
      if (u.origin !== location.origin || u.pathname !== location.pathname || !u.hash) return
      if (u.hash !== location.hash) location.hash = u.hash
      else take()
    } catch {
      /* not a URL: ignore */
    }
  })
}
