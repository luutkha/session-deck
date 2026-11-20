import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileView } from '../../shared/types'
import { readFileView } from './readFileView'

const CONTENT_TYPES_PREFIX =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'

const RELS_PREFIX =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'

const OFFICE_DOCUMENT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WORKSHEET_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sd-office-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Builds a real zip (xlsx/docx are zipped XML) from part name -> xml. */
async function zipParts(parts: Readonly<Record<string, string>>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(parts)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function viewOf(name: string): Promise<FileView> {
  const result = await readFileView(join(dir, name))
  if (!result.ok) throw new Error(`expected a view for ${name}: ${result.error}`)
  return result.view
}

function xlsxParts(): Record<string, string> {
  return {
    '[Content_Types].xml':
      CONTENT_TYPES_PREFIX +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET_CONTENT_TYPE}"/>` +
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="${WORKSHEET_CONTENT_TYPE}"/>` +
      '</Types>',
    '_rels/.rels':
      RELS_PREFIX +
      `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      '<sheet name="First" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Second" sheetId="2" r:id="rId2"/>' +
      '</sheets>' +
      '</workbook>',
    'xl/_rels/workbook.xml.rels':
      RELS_PREFIX +
      `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${OFFICE_DOCUMENT_REL}/worksheet" Target="worksheets/sheet2.xml"/>` +
      '</Relationships>',
    'xl/worksheets/sheet1.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>Name</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><t>Count</t></is></c>' +
      '</row>' +
      '<row r="2">' +
      '<c r="A2" t="inlineStr"><is><t>alpha</t></is></c>' +
      '<c r="B2"><v>42</v></c>' +
      '</row>' +
      '</sheetData>' +
      '</worksheet>',
    'xl/worksheets/sheet2.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>solo</t></is></c></row>' +
      '</sheetData>' +
      '</worksheet>'
  }
}

function docxParts(): Record<string, string> {
  return {
    '[Content_Types].xml':
      CONTENT_TYPES_PREFIX +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    '_rels/.rels':
      RELS_PREFIX +
      `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}/officeDocument" Target="word/document.xml"/>` +
      '</Relationships>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' +
      '<w:p>' +
      '<w:r><w:t xml:space="preserve">Hello </w:t></w:r>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>bold world</w:t></w:r>' +
      '</w:p>' +
      '</w:body>' +
      '</w:document>'
  }
}

describe('readFileView xlsx', () => {
  it('returns every sheet name and its rows as strings', async () => {
    await writeFile(join(dir, 'book.xlsx'), await zipParts(xlsxParts()))
    const view = await viewOf('book.xlsx')
    expect(view.kind).toBe('sheet')
    expect(view.mime).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    expect(view.truncated).toBe(false)
    expect(view.sheets.map((sheet) => sheet.name)).toEqual(['First', 'Second'])
    expect(view.sheets[0].rows).toEqual([
      ['Name', 'Count'],
      ['alpha', '42']
    ])
    expect(view.sheets[0].rows.flat().every((cell) => typeof cell === 'string')).toBe(true)
    expect(view.sheets[1].rows).toEqual([['solo']])
    expect(view.sheets.every((sheet) => !sheet.truncated)).toBe(true)
  })
})

describe('readFileView docx', () => {
  it('returns html with the text and without img tags', async () => {
    await writeFile(join(dir, 'letter.docx'), await zipParts(docxParts()))
    const view = await viewOf('letter.docx')
    expect(view.kind).toBe('docx')
    expect(view.mime).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(view.truncated).toBe(false)
    expect(view.content).toContain('Hello')
    expect(view.content).toContain('bold world')
    expect(view.content).not.toMatch(/<img/i)
  })
})
