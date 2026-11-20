// The shape of a duration or a wait: a picker (constant, exponential, normal, uniform, triangular) and the numbers
// the shape needs. The typed figure stays the mean; uniform and triangular carry their own mean and write it back.
import type { FlowNode, Shape } from '../../core/metamodel'
import { setShape } from '../../core/ops'
import { defaultShape, SHAPE_KINDS, SHAPE_LABELS, shapeMean, validateShape } from '../../core/random'
import { useEditor } from '../store'
import { NumField } from './NumField'
import { ShapeChart } from './ShapeChart'

type Param = 'sd' | 'min' | 'mode' | 'max'
const PARAMS: Record<Shape['kind'], { key: Param; label: string; title: string; optional?: boolean }[]> = {
  exp: [],
  normal: [
    { key: 'sd', label: 'σ', title: 'Spread (standard deviation); 0 = constant' },
    { key: 'min', label: 'min', title: 'Cut below this (blank = 0)', optional: true },
    { key: 'max', label: 'max', title: 'Cut above this (blank = no limit)', optional: true },
  ],
  uniform: [
    { key: 'min', label: 'min', title: 'Shortest time' },
    { key: 'max', label: 'max', title: 'Longest time' },
  ],
  triangular: [
    { key: 'min', label: 'min', title: 'Best case' },
    { key: 'mode', label: 'likely', title: 'Most likely time' },
    { key: 'max', label: 'max', title: 'Worst case' },
  ],
}

export function ShapeCell({ node, which, unit }: { node: FlowNode; which: 'duration' | 'wait'; unit: string }) {
  const apply = useEditor((s) => s.apply)
  const figure = node.sim?.[which]
  const shape = node.sim?.[`${which}Shape` as const]
  const id = node.id
  const name = node.name || id

  /** Applies a shape; returns why it was refused (and keeps the global error banner quiet). */
  const commit = (next: Shape | undefined, key: string): string | void => {
    if (next) {
      const why = validateShape(next)
      if (why) return why
    }
    const ok = apply((m) => setShape(m, id, which, next), { coalesce: `shape:${id}:${which}:${key}` })
    if (ok) return
    const message = useEditor.getState().error ?? 'Not accepted'
    useEditor.getState().showError(null)
    return message
  }

  const pick = (kind: Shape['kind'] | 'const') => {
    if (kind === 'const') return commit(undefined, 'kind')
    if (figure === undefined) return
    commit(defaultShape(kind, figure), 'kind')
  }
  const needsFigure = figure === undefined && !shape
  const cutMean = shape?.kind === 'normal' && figure !== undefined ? shapeMean(shape, figure) : undefined
  const moved = cutMean !== undefined && Math.abs(cutMean - figure!) > 0.02 * Math.abs(figure!)

  return (
    <div className="sim-shape">
      <select
        value={shape?.kind ?? 'const'}
        disabled={needsFigure}
        title={needsFigure ? `Type the average ${which} first: the shape spreads around it` : `How the ${which} varies around its average`}
        aria-label={`${which} shape of ${name}`}
        onChange={(e) => pick(e.target.value as Shape['kind'] | 'const')}
        data-testid={`${which}-shape:${name}`}
      >
        <option value="const">{SHAPE_LABELS.const}</option>
        {SHAPE_KINDS.map((k) => (
          <option key={k} value={k}>
            {SHAPE_LABELS[k]}
          </option>
        ))}
      </select>
      {needsFigure && (
        <span className="sim-shape-hint" data-testid={`${which}-hint:${name}`}>
          enter {which === 'duration' ? 'Duration' : 'Waiting'} first
        </span>
      )}
      {shape &&
        PARAMS[shape.kind].map((p) => (
          <NumField
            key={p.key}
            small
            label={`${which} ${p.label} of ${name}`}
            title={`${p.title}, in ${unit}`}
            placeholder={p.label}
            testid={`${which}-${p.key}:${name}`}
            value={(shape as unknown as Record<string, number | undefined>)[p.key]}
            onCommit={(v) => {
              if (v === undefined && !p.optional) return `Type the ${p.label}`
              const next = { ...shape } as unknown as Record<string, number | undefined>
              if (v === undefined) delete next[p.key]
              else next[p.key] = v
              return commit(next as unknown as Shape, p.key)
            }}
          />
        ))}
      <ShapeChart shape={shape} figure={figure} unit={unit} name={name} />
      {moved && (
        <span className="sim-shape-note" title={`The cut at 0 makes the real average ${Math.round(cutMean! * 100) / 100} ${unit}; the analysis uses the typed ${figure}`}>
          cut at 0: real average {Math.round(cutMean! * 100) / 100}
        </span>
      )}
    </div>
  )
}
