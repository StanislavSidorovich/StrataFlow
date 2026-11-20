// Names for lists where two entries may read the same (the open tabs): the second one is "Name (2)", the third "(3)".
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  const taken = new Set(names)
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1
    seen.set(n, k)
    if (k === 1) return n
    let i = k
    while (taken.has(`${n} (${i})`)) i++
    return `${n} (${i})`
  })
}
