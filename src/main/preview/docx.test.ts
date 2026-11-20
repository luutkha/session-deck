import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileView } from '../../shared/types'
import {
  contentTypesXml,
  DOCX_MAIN_TYPE,
  OFFICE_DOCUMENT_REL,
  officeDocumentRels,
  RELS_PREFIX,
  zipParts
} from './officeFixtures'
import { readFileView } from './readFileView'

// D75: a document shaped like Word's own output — real styles, a numbered bullet list, a table, bold/italic runs
// and an external hyperlink. The renderer sanitizes the HTML; here we only check it is the right SHAPE.
function style(type: string, id: string, name: string, isDefault: boolean): string {
  return (
    `<w:style w:type="${type}" w:styleId="${id}"${isDefault ? ' w:default="1"' : ''}>` +
    `<w:name w:val="${name}"/></w:style>`
  )
}

function bullet(text: string): string {
  return (
    '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/>' +
    '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
    `<w:r><w:t>${text}</w:t></w:r></w:p>`
  )
}

function cell(first: string, second: string): string {
  return (
    '<w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${first}</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${second}</w:t></w:r></w:p></w:tc>` +
    '</w:tr>'
  )
}

/** A Title and a Heading 1 with real style definitions, a bullet list with numbering, a table, emphasis, a link. */
function realisticDocxParts(): Record<string, string> {
  return {
    '[Content_Types].xml': contentTypesXml({
      '/word/document.xml': DOCX_MAIN_TYPE,
      '/word/styles.xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
      '/word/numbering.xml':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'
    }),
    '_rels/.rels': officeDocumentRels('word/document.xml'),
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>' +
      '<w:r><w:t>Quarterly report</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' +
      '<w:r><w:t>Summary</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>' +
      '<w:r><w:t xml:space="preserve">Some </w:t></w:r>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve"> and </w:t></w:r>' +
      '<w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve"> text, see </w:t></w:r>' +
      '<w:hyperlink r:id="rIdLink"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>' +
      '<w:t>the site</w:t></w:r></w:hyperlink></w:p>' +
      bullet('First point') +
      bullet('Second point') +
      '<w:tbl>' +
      '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
      cell('Quarter', 'Revenue') +
      cell('Q1', '10') +
      '</w:tbl>' +
      '<w:p/>' +
      '</w:body>' +
      '</w:document>',
    'word/_rels/document.xml.rels':
      RELS_PREFIX +
      `<Relationship Id="rIdStyles" Type="${OFFICE_DOCUMENT_REL}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rIdNumbering" Type="${OFFICE_DOCUMENT_REL}/numbering" Target="numbering.xml"/>` +
      '<Relationship Id="rIdLink" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ' +
      'Target="https://example.com/report" TargetMode="External"/>' +
      '</Relationships>',
    'word/styles.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      style('paragraph', 'Normal', 'Normal', true) +
      style('paragraph', 'Title', 'Title', false) +
      style('paragraph', 'Heading1', 'heading 1', false) +
      '<w:style w:type="paragraph" w:styleId="ListParagraph">' +
      '<w:name w:val="List Paragraph"/></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink">' +
      '<w:name w:val="Hyperlink"/></w:style>' +
      '</w:styles>',
    'word/numbering.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:abstractNum w:abstractNumId="0">' +
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
      '<w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl>' +
      '</w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '</w:numbering>'
  }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sd-docx-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function realisticHtml(): Promise<FileView> {
  await writeFile(join(dir, 'report.docx'), await zipParts(realisticDocxParts()))
  const result = await readFileView(join(dir, 'report.docx'))
  if (!result.ok) throw new Error(`expected a view: ${result.error}`)
  return result.view
}

describe('readFileView realistic docx', () => {
  it('keeps headings, lists, tables, emphasis and links as html', async () => {
    const view = await realisticHtml()
    expect(view.kind).toBe('docx')
    expect(view.content).toContain('<h1')
    expect(view.content).toContain('<ul')
    expect(view.content).toContain('<li')
    expect(view.content).toContain('<table')
    expect(view.content).toContain('<strong')
    expect(view.content).toContain('<em')
    expect(view.content).toContain('<a ')
    expect(view.content).not.toMatch(/<img/i)
  })

  it('renders the Heading 1 paragraph as h1 and the Title as h1.title', async () => {
    const view = await realisticHtml()
    // styleId "Heading1" with the name Word writes, "heading 1", must reach the h1 branch of the style map.
    expect(view.content).toMatch(/<h1[^>]*>Summary<\/h1>/)
    expect(view.content).toContain('<h1 class="title">Quarterly report</h1>')
  })

  it('keeps the hyperlink target and marks the list as a bullet list', async () => {
    const view = await realisticHtml()
    expect(view.content).toContain('<a href="https://example.com/report">the site</a>')
    expect(view.content).toContain('First point')
    expect(view.content).toContain('Second point')
    // A numbered paragraph must not stay a bare <p>: the <li> count tells lists apart from plain paragraphs.
    expect(view.content.match(/<li>/g)).toHaveLength(2)
  })

  it('keeps the table rows and cells', async () => {
    const view = await realisticHtml()
    expect(view.content).toContain('Quarter')
    expect(view.content).toContain('Revenue')
    expect(view.content.match(/<tr>/g)).toHaveLength(2)
    expect(view.content.match(/<td>/g)).toHaveLength(4)
  })
})
