// One parser for every number the user types in the simulation fields (stage 6b).
// `1.5` and `1,5` are the same; spaces are ignored (`1 000`); a `%` is accepted in a percent field; a number with
// both a comma and a dot (`1.000,5`) is refused rather than guessed.

export interface Parsed {
  /** Undefined for an empty field (clears the value). */
  value?: number
  /** Why the text is not a number; when set, nothing should be stored. */
  error?: string
}

export function parseNum(text: string, opts: { percent?: boolean } = {}): Parsed {
  let t = text.replace(/[\s  ]/g, '')
  if (t === '') return {}
  if (t.endsWith('%')) {
    if (!opts.percent) return { error: 'No % sign here: type the number' }
    t = t.slice(0, -1)
  }
  if (t.includes(',') && t.includes('.')) return { error: 'Use one decimal mark: 1.5 or 1,5' }
  if (/^[+-]?(\d+[.,]?\d*|[.,]\d+)$/.test(t)) {
    const x = Number(t.replace(',', '.'))
    return Number.isFinite(x) ? { value: x } : { error: 'Too large' }
  }
  return { error: 'Not a number' }
}
