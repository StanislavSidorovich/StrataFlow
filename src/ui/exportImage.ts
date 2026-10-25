// PNG / SVG export of the diagram on screen, cropped to its content (same approach as Quaera Model).
// The canvas registers how to read the nodes' bounds, because the File menu lives outside the React Flow provider.
import type { Rect } from '@xyflow/react'
import { fileBaseName, saveExport } from './files'
import { useEditor } from './store'

const PADDING = 32
const MAX_SIDE = 6000

// The shapes and flows are styled by CSS classes and variables; inside the exported picture those do not apply
// to SVG parts, which then come out black or invisible. So while exporting, each SVG part carries its look inline.
const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'visibility']

function inlineSvgStyles(root: HTMLElement): () => void {
  // The arrowheads are defined in a sibling <svg> outside the viewport; a copy goes inside so they are drawn.
  const markers = document.querySelector('.bpmn-markers')?.cloneNode(true)
  if (markers) root.appendChild(markers)
  const saved: [Element, string | null][] = []
  for (const el of root.querySelectorAll('svg *')) {
    if (!(el instanceof SVGElement)) continue
    saved.push([el, el.getAttribute('style')])
    const cs = getComputedStyle(el)
    for (const p of SVG_PROPS) el.style.setProperty(p, cs.getPropertyValue(p))
  }
  return () => {
    markers?.parentNode?.removeChild(markers)
    for (const [el, style] of saved) style === null ? el.removeAttribute('style') : el.setAttribute('style', style)
  }
}

let bounds: (() => Rect) | null = null

/** Called by the canvas: how to measure the drawing (null on unmount). */
export function registerBounds(fn: (() => Rect) | null) {
  bounds = fn
}

/** Draws the diagram as it is on the canvas (cropped, current theme) and gives back the picture's maker. */
export async function prepareImage(format: 'png' | 'svg'): Promise<() => Promise<Blob>> {
  const b = bounds?.()
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!b || !viewport || b.width === 0) throw new Error('Nothing to export: draw something first')
  const { toPng, toSvg } = await import('html-to-image')
  const width = Math.ceil(b.width + PADDING * 2)
  const height = Math.ceil(b.height + PADDING * 2)
  // Sharp enough for slides and chat (2x), but a very wide diagram is capped at about 6000 px on its long side:
  // an 8000 px picture can stall the browser while it draws.
  const pixelRatio = Math.min(2, Math.max(1, MAX_SIDE / Math.max(width, height)))
  const options = {
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#ffffff',
    width,
    height,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${PADDING - b.x}px, ${PADDING - b.y}px) scale(1)` },
  }
  return async () => {
    const restore = inlineSvgStyles(viewport)
    try {
      const url = format === 'png' ? await toPng(viewport, { ...options, pixelRatio }) : await toSvg(viewport, options)
      return await (await fetch(url)).blob()
    } finally {
      restore()
    }
  }
}

/** Saves the drawing as an image. Returns the file name, or null when cancelled. */
export async function exportImage(format: 'png' | 'svg'): Promise<string | null> {
  const make = await prepareImage(format)
  const name = `${fileBaseName(useEditor.getState().model.name)}.${format}`
  return saveExport(name, format, make)
}
