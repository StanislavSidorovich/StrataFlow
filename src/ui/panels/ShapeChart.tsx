// A small picture of a time distribution (v0.20.0): triangular, uniform, normal, exponential. Drawn from the same
// numbers the simulation uses; larger on hover or focus. Nothing is drawn when the shape has no numbers yet.
import type { Shape } from '../../core/metamodel'
import { shapeCurve } from '../../core/random'
import './shapeChart.css'

export function ShapeChart({ shape, figure, unit, name }: { shape: Shape | undefined; figure: number | undefined; unit: string; name: string }) {
  const c = shapeCurve(shape, figure)
  if (!shape || !c) return null
  const W = 60
  const H = 22
  const sx = (x: number) => 2 + ((x - c.x0) / (c.x1 - c.x0)) * (W - 4)
  const sy = (y: number) => H - 2 - y * (H - 6)
  const line = c.pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')
  const area = `${sx(c.x0).toFixed(1)},${sy(0).toFixed(1)} ${line} ${sx(c.x1).toFixed(1)},${sy(0).toFixed(1)}`
  const r = (v: number) => String(Math.round(v * 100) / 100)
  const label = `${shape.kind} shape of ${name}, from ${r(c.x0)} to ${r(c.x1)} ${unit}`
  return (
    <span className="shape-chart" tabIndex={0} role="img" aria-label={label} title={label} data-testid={`shape-chart:${name}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
        <polygon points={area} className="sc-area" />
        <polyline points={line} className="sc-line" />
        <line x1={2} x2={W - 2} y1={H - 2} y2={H - 2} className="sc-axis" />
      </svg>
      <span className="sc-ends" aria-hidden>
        <span>{r(c.x0)}</span>
        <span>
          {r(c.x1)} {unit}
        </span>
      </span>
    </span>
  )
}
