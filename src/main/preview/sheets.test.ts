import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileView } from '../../shared/types'
import {
  contentTypesXml,
  OFFICE_DOCUMENT_REL,
  officeDocumentRels,
  RELS_PREFIX,
  WORKSHEET_CONTENT_TYPE,
  XLSX_MAIN_TYPE,
  zipParts
} from './officeFixtures'
import { readFileView } from './readFileView'

// D75: one workbook shaped like Excel's own output. Each cell below is a feature the plain reader path has to
// get right; a wrong one shows up as `[object Object]`, `NaN`, a serial number or an off-by-one row.
const SHARED_STRING = (text: string): string => `<si><t xml:space="preserve">${text}</t></si>`

/**
 * Shared strings, a date style with numFmtId 14, a boolean, a formula with a cached value, a merged range, a gap
 * row, a decimal and a cell far to the right. A second sheet is visible and a third one is hidden — Excel's
 * `state="hidden"` is part of the workbook, not of the sheet.
 */
function realisticXlsxParts(): Record<string, string> {
  const strings = [
    'Name',
    'Amount',
    'Active',
    'Due',
    'Alpha',
    'Beta',
    'Total',
    'Note',
    'Merged heading',
    'far right'
  ]
  return {
    '[Content_Types].xml': contentTypesXml({
      '/xl/workbook.xml': XLSX_MAIN_TYPE,
      '/xl/worksheets/sheet1.xml': WORKSHEET_CONTENT_TYPE,
      '/xl/worksheets/sheet2.xml': WORKSHEET_CONTENT_TYPE,
      '/xl/worksheets/sheet3.xml': WORKSHEET_CONTENT_TYPE,
      '/xl/sharedStrings.xml':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
      '/xl/styles.xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'
    }),
    '_rels/.rels': officeDocumentRels('xl/workbook.xml'),
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      '<sheet name="Report" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Totals" sheetId="2" r:id="rId2"/>' +
      '<sheet name="Hidden notes" sheetId="3" state="hidden" r:id="rId3"/>' +
      '</sheets>' +
      '</workbook>',
    'xl/_rels/workbook.xml.rels':
      RELS_PREFIX +
      `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${OFFICE_DOCUMENT_REL}/worksheet" Target="worksheets/sheet2.xml"/>` +
      `<Relationship Id="rId3" Type="${OFFICE_DOCUMENT_REL}/worksheet" Target="worksheets/sheet3.xml"/>` +
      `<Relationship Id="rId4" Type="${OFFICE_DOCUMENT_REL}/sharedStrings" Target="sharedStrings.xml"/>` +
      `<Relationship Id="rId5" Type="${OFFICE_DOCUMENT_REL}/styles" Target="styles.xml"/>` +
      '</Relationships>',
    'xl/sharedStrings.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
      strings.map(SHARED_STRING).join('') +
      '</sst>',
    // Two cellXfs: 0 is General, 1 is the built-in date format 14 (mm-dd-yy) Excel uses for a typed date.
    'xl/styles.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>',
    'xl/worksheets/sheet1.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:Z8"/>' +
      '<sheetData>' +
      '<row r="1">' +
      '<c r="A1" t="s"><v>0</v></c>' +
      '<c r="B1" t="s"><v>1</v></c>' +
      '<c r="C1" t="s"><v>2</v></c>' +
      '<c r="D1" t="s"><v>3</v></c>' +
      '</row>' +
      '<row r="2">' +
      '<c r="A2" t="s"><v>4</v></c>' +
      '<c r="B2"><v>10</v></c>' +
      '<c r="C2" t="b"><v>1</v></c>' +
      '<c r="D2" s="1" t="n"><v>45366</v></c>' +
      '</row>' +
      '<row r="3">' +
      '<c r="A3" t="s"><v>5</v></c>' +
      '<c r="B3"><v>20</v></c>' +
      '<c r="C3" t="b"><v>0</v></c>' +
      '</row>' +
      '<row r="4">' +
      '<c r="A4" t="s"><v>6</v></c>' +
      '<c r="B4"><f>SUM(B2:B3)</f><v>30</v></c>' +
      '</row>' +
      // Row 5 is left out on purpose: Excel also writes only the rows it has cells for.
      '<row r="6">' +
      '<c r="A6" t="s"><v>7</v></c>' +
      '<c r="B6"><v>1.5</v></c>' +
      '</row>' +
      '<row r="8">' +
      '<c r="A8" t="s"><v>8</v></c>' +
      '<c r="Z8" t="s"><v>9</v></c>' +
      '</row>' +
      '</sheetData>' +
      '<mergeCells count="1"><mergeCell ref="A8:C8"/></mergeCells>' +
      '</worksheet>',
    'xl/worksheets/sheet2.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row>' +
      '</sheetData>' +
      '</worksheet>',
    'xl/worksheets/sheet3.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>secret</t></is></c></row>' +
      '</sheetData>' +
      '</worksheet>'
  }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sd-sheets-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function realisticView(): Promise<FileView> {
  await writeFile(join(dir, 'report.xlsx'), await zipParts(realisticXlsxParts()))
  const result = await readFileView(join(dir, 'report.xlsx'))
  if (!result.ok) throw new Error(`expected a view: ${result.error}`)
  return result.view
}

describe('readFileView realistic xlsx', () => {
  it('reads shared strings, a date style, booleans and a cached formula value', async () => {
    const view = await realisticView()
    const report = view.sheets[0]
    expect(report.name).toBe('Report')
    // Shared strings (t="s" into xl/sharedStrings.xml).
    expect(report.rows[0].slice(0, 4)).toEqual(['Name', 'Amount', 'Active', 'Due'])
    // Date cell: serial 45366 with numFmtId 14 is 2024-03-15, never the serial itself.
    expect(report.rows[1].slice(0, 4)).toEqual(['Alpha', '10', 'true', '2024-03-15'])
    expect(report.rows[2].slice(0, 4)).toEqual(['Beta', '20', 'false', ''])
    // Formula cell: the cached <v>30</v> is shown, not the formula text.
    expect(report.rows[3].slice(0, 4)).toEqual(['Total', '30', '', ''])
  })

  it('keeps a gap row, decimals, the merged cell and a far-right column', async () => {
    const view = await realisticView()
    const report = view.sheets[0]
    // Row 5 has no <row> element: it stays as an empty row so row numbers keep matching Excel.
    expect(report.rows[4]).toHaveLength(26)
    expect(report.rows[4].every((cell) => cell === '')).toBe(true)
    expect(report.rows[5].slice(0, 2)).toEqual(['Note', '1.5'])
    // A merged range keeps its value in the top-left cell and reads empty in the covered ones.
    expect(report.rows[7][0]).toBe('Merged heading')
    expect(report.rows[7].slice(1, 3)).toEqual(['', ''])
    // The reader pads every row to the widest used column (Z here), as Excel's grid does; no misalignment.
    expect(report.rows[7]).toHaveLength(26)
    expect(report.rows[7][25]).toBe('far right')
    expect(report.rows[1][25]).toBe('')
    expect(report.truncated).toBe(false)
  })

  it('includes a hidden sheet, because the workbook lists it and the reader has no hidden flag', async () => {
    // Recorded behaviour, not a wish: read-excel-file returns every <sheet> in workbook order, `state="hidden"`
    // included. The viewer shows it like any other sheet; hiding it needs a shared type change.
    const view = await realisticView()
    expect(view.sheets.map((sheet) => sheet.name)).toEqual(['Report', 'Totals', 'Hidden notes'])
    expect(view.sheets[1].rows).toEqual([['2']])
    expect(view.sheets[2].rows).toEqual([['secret']])
  })

  it('never shows an object, NaN or an empty sheet name', async () => {
    const view = await realisticView()
    for (const sheet of view.sheets) {
      expect(sheet.name.length).toBeGreaterThan(0)
      for (const cell of sheet.rows.flat()) {
        expect(typeof cell).toBe('string')
        expect(cell).not.toContain('[object Object]')
        expect(cell).not.toContain('NaN')
      }
    }
  })
})
