// The Kaiyo Trading example, from File → Example and from a link (`?example=kaiyo`, quaera.app's data map).
import { parseModel } from '../core/serialize'
import kaiyoOrder from '../../cases/kaiyo-order.flow.json?raw'
import { openProcess, switchTo, useDocs } from './docs'
import { hadStoredModel, useEditor } from './store'

const NOTICE = 'Kaiyo Trading: an illustrative order process. The notes show what the data keeps, Help explains each element. Your other processes stay in their tabs.'

export function openKaiyo() {
  openProcess(parseModel(kaiyoOrder))
  useEditor.getState().say(NOTICE)
}

let fromLink = false

/** A visit from the link came for this model: no welcome card over it this time. */
export const cameFromExampleLink = () => fromLink

/**
 * At start: opens the example the link names, then drops the parameter so a reload keeps the student's edits.
 * Runs after App's module, so a first visit has the library example on the canvas: it gives way, not a second tab.
 * A second click on the link returns to the tab it opened instead of adding another.
 */
export function openExampleFromLink() {
  const params = new URLSearchParams(location.search)
  if (params.get('example') !== 'kaiyo') return
  params.delete('example')
  const rest = params.toString()
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash)
  fromLink = true
  const model = parseModel(kaiyoOrder)
  const { parked } = useDocs.getState()
  const open = Object.keys(parked).find((id) => parked[id].model.name === model.name)
  if (!hadStoredModel) useEditor.setState({ model })
  else if (useEditor.getState().model.name === model.name) return
  else if (open) switchTo(open)
  else openProcess(model)
  useEditor.getState().say(NOTICE)
}
