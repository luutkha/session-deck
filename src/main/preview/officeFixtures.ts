// Test fixtures for the viewer's Office readers (D75): small but REAL zips, built with JSZip, that look like the
// files Excel and Word write (content types, rels, shared strings, styles, numbering). Shared by office.test.ts,
// sheets.test.ts and docx.test.ts so each test file stays short.
import JSZip from 'jszip'

export const CONTENT_TYPES_PREFIX =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'

export const RELS_PREFIX =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'

export const OFFICE_DOCUMENT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const WORKSHEET_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'

/** D75: Excel and Word pick the main-part content type by flavour; a macro-enabled file is the same zip otherwise. */
export const XLSX_MAIN_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
export const XLSM_MAIN_TYPE = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
export const DOCX_MAIN_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
export const DOCM_MAIN_TYPE = 'application/vnd.ms-word.document.macroEnabled.main+xml'
export const DOTX_MAIN_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml'

/** Builds a real zip (xlsx/docx are zipped XML) from part name -> xml. */
export async function zipParts(parts: Readonly<Record<string, string>>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(parts)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** `[Content_Types].xml` with the two defaults every package has and the caller's overrides. */
export function contentTypesXml(overrides: Readonly<Record<string, string>>): string {
  const entries = Object.entries(overrides)
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join('')
  return (
    CONTENT_TYPES_PREFIX +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    entries +
    '</Types>'
  )
}

export function officeDocumentRels(mainPart: string): string {
  return (
    RELS_PREFIX +
    `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}/officeDocument" Target="${mainPart}"/>` +
    '</Relationships>'
  )
}

/** The smallest workbook the viewer has always handled: inline strings plus a number, two sheets. */
export function basicXlsxParts(): Record<string, string> {
  return {
    '[Content_Types].xml': contentTypesXml({
      '/xl/workbook.xml': XLSX_MAIN_TYPE,
      '/xl/worksheets/sheet1.xml': WORKSHEET_CONTENT_TYPE,
      '/xl/worksheets/sheet2.xml': WORKSHEET_CONTENT_TYPE
    }),
    '_rels/.rels': officeDocumentRels('xl/workbook.xml'),
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

/** The same workbook with the macro-enabled main content type Excel writes for a `.xlsm`. */
export function macroXlsxParts(): Record<string, string> {
  return { ...basicXlsxParts(), '[Content_Types].xml': contentTypesXml({
    '/xl/workbook.xml': XLSM_MAIN_TYPE,
    '/xl/worksheets/sheet1.xml': WORKSHEET_CONTENT_TYPE,
    '/xl/worksheets/sheet2.xml': WORKSHEET_CONTENT_TYPE
  }) }
}

/** The smallest document the viewer has always handled: one paragraph with a bold run. */
export function basicDocxParts(): Record<string, string> {
  return docxPackage(DOCX_MAIN_TYPE, basicDocumentXml())
}

/** D75: Word's `.docm` and `.dotx` differ from `.docx` only in the main part's content type (and a template flag). */
export function macroDocumentParts(mainType: string): Record<string, string> {
  return docxPackage(mainType, basicDocumentXml())
}

function basicDocumentXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' +
    '<w:p>' +
    '<w:r><w:t xml:space="preserve">Hello </w:t></w:r>' +
    '<w:r><w:rPr><w:b/></w:rPr><w:t>bold world</w:t></w:r>' +
    '</w:p>' +
    '</w:body>' +
    '</w:document>'
  )
}

function docxPackage(mainType: string, documentXml: string): Record<string, string> {
  return {
    '[Content_Types].xml': contentTypesXml({ '/word/document.xml': mainType }),
    '_rels/.rels': officeDocumentRels('word/document.xml'),
    'word/document.xml': documentXml
  }
}
