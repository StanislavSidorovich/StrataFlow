// A small .xlsx writer (stage 6b phase 4; design §4.5): SpreadsheetML parts packed with core/zip, no dependency.
// Strings are inline (no shared-strings table), numbers are numeric cells with number formats, XML is escaped,
// sheet names are cut to Excel's 31 characters without `[]:*?/\`. Non-Latin text is fine: the parts are UTF-8.
import { writeZip, type ZipEntry } from './zip'

export type CellFormat = 'pct' | 'int' | 'dec2'
/** A plain string or number, or a cell with a look. Null, undefined and non-finite numbers leave the cell empty. */
export type Cell = string | number | null | undefined | { v: string | number | null | undefined; bold?: boolean; fmt?: CellFormat }

export interface Sheet {
  name: string
  rows: Cell[][]
  /** Column widths in characters. */
  widths?: number[]
}

/** Excel sheet names: at most 31 characters, none of `[]:*?/\`, no apostrophe at either end, not empty, unique ignoring case. */
export function sheetName(raw: string, taken: Iterable<string> = []): string {
  const used = new Set([...taken].map((x) => x.toLowerCase()))
  let base = Array.from(raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '')).slice(0, 31).join('').trim()
  if (!base) base = 'Sheet'
  let name = base
  for (let i = 2; used.has(name.toLowerCase()); i++) {
    const tail = ` ${i}`
    name = Array.from(base).slice(0, 31 - tail.length).join('').trimEnd() + tail
  }
  return name
}

const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
/** Escapes text for XML and drops the characters XML 1.0 cannot hold. */
export const xmlText = (s: string) =>
  s
    .replace(BAD_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** Column letters: 0 → A, 25 → Z, 26 → AA. */
export const colName = (i: number) => {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

// styles: 0 plain, 1 bold, 2 percent 0.00 %, 3 decimal 0.00, 4 integer, 5 bold + percent
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

function styleOf(bold: boolean | undefined, fmt: CellFormat | undefined): number {
  if (fmt === 'pct') return bold ? 5 : 2
  if (fmt === 'dec2') return 3
  if (fmt === 'int') return 4
  return bold ? 1 : 0
}

function sheetXml(s: Sheet): string {
  const rows = s.rows
    .map((row, r) => {
      const cells = row
        .map((raw, c) => {
          const cell = raw !== null && typeof raw === 'object' ? raw : { v: raw }
          const ref = `${colName(c)}${r + 1}`
          const st = styleOf(cell.bold, cell.fmt)
          const s0 = st ? ` s="${st}"` : ''
          const v = cell.v
          if (v === null || v === undefined || v === '') return ''
          if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${s0}><v>${v}</v></c>` : ''
          return `<c r="${ref}"${s0} t="inlineStr"><is><t xml:space="preserve">${xmlText(v)}</t></is></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cells}</row>`
    })
    .join('')
  const cols = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`
}

/** The workbook as bytes. Sheet names are made valid and unique here, so callers may pass any title. */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const names: string[] = []
  for (const s of sheets) names.push(sheetName(s.name, names))
  const enc = new TextEncoder()
  const part = (name: string, text: string): ZipEntry => ({ name, data: enc.encode(text) })
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  const entries: ZipEntry[] = [
    part('[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    part('_rels/.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    part('xl/workbook.xml', `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    part('xl/_rels/workbook.xml.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    part('xl/styles.xml', STYLES),
    ...sheets.map((s, i) => part(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s))),
  ]
  return writeZip(entries)
}

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const xlsxBlob = (sheets: Sheet[]) => new Blob([buildXlsx(sheets) as BlobPart], { type: MIME })

/** Tab-separated text of a table for the clipboard: decimals with the locale's separator, so a Portuguese or Russian Excel reads numbers. */
export function toTsv(rows: Cell[][], locale?: string): string {
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 6, useGrouping: false })
  return rows
    .map((row) =>
      row
        .map((raw) => {
          const v = raw !== null && typeof raw === 'object' ? raw.v : raw
          if (v === null || v === undefined) return ''
          if (typeof v === 'number') return Number.isFinite(v) ? fmt.format(raw !== null && typeof raw === 'object' && raw.fmt === 'pct' ? v * 100 : v) + (raw !== null && typeof raw === 'object' && raw.fmt === 'pct' ? ' %' : '') : ''
          return v.replace(/[\t\r\n]+/g, ' ')
        })
        .join('\t'),
    )
    .join('\n')
}
