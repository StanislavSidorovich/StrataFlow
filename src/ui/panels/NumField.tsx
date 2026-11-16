// A number field for the simulation tables (stage 6b): one shared parser (core/number), the text kept as typed while
// it is being edited, red with the reason when the text is not a number or the edit is refused (nothing is stored then).
import { useState } from 'react'
import { parseNum } from '../../core/number'
import './figures.css'

const show = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '' : String(Math.round(v * 1e6) / 1e6))

interface Props {
  /** The stored value, in the units the field shows (a percent field shows 30 for 0.3). */
  value: number | undefined
  /** Gets the parsed value (undefined = blank). Returns why it was refused, or nothing when it was taken. */
  onCommit: (v: number | undefined) => string | void
  percent?: boolean
  placeholder?: string
  title?: string
  testid?: string
  /** A narrower box for parameters next to a picker. */
  small?: boolean
  label?: string
}

export function NumField({ value, onCommit, percent, placeholder, title, testid, small, label }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const change = (text: string) => {
    setDraft(text)
    const p = parseNum(text, { percent })
    setError(p.error ?? onCommit(p.value) ?? undefined)
  }
  return (
    <span className="num-field">
      <input
        className={`sim-num${small ? ' is-small' : ''}${error ? ' is-invalid' : ''}`}
        inputMode="decimal"
        value={draft ?? show(value)}
        placeholder={placeholder}
        title={error ?? title}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        onChange={(e) => change(e.target.value)}
        onBlur={() => {
          setDraft(null)
          setError(undefined)
        }}
        data-testid={testid}
      />
      {error && (
        <span className="num-error" role="alert" data-testid={testid ? `${testid}:error` : undefined}>
          {error}
        </span>
      )}
    </span>
  )
}
