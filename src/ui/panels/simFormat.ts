// Number formats of the Run tab, the canvas badges and Properties.
export const fmt = (x: number | undefined, digits = 2) => (x === undefined || !Number.isFinite(x) ? '—' : String(Math.round(x * 10 ** digits) / 10 ** digits))
export const pct = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? '—' : `${x < 0.1 ? Math.round(x * 1000) / 10 : Math.round(x * 100)} %`)
/** A count with a thin gap for thousands: 1 000. */
export const count = (x: number) => Math.round(x).toLocaleString('en').replace(/,/g, ' ')
/** Mean with the 95 % half-width: `68.8 ± 3.1`. */
export const pm = (mean: number | undefined, half: number | undefined, digits = 2) => (half === undefined ? fmt(mean, digits) : `${fmt(mean, digits)} ± ${fmt(half, digits)}`)
