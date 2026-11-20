import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileView } from '../../shared/types'
import {
  basicDocxParts,
  basicXlsxParts,
  DOTX_MAIN_TYPE,
  DOCM_MAIN_TYPE,
  macroDocumentParts,
  macroXlsxParts,
  zipParts
} from './officeFixtures'
import { readFileView } from './readFileView'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sd-office-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function viewOf(name: string): Promise<FileView> {
  const result = await readFileView(join(dir, name))
  if (!result.ok) throw new Error(`expected a view for ${name}: ${result.error}`)
  return result.view
}

async function writeOffice(name: string, parts: Readonly<Record<string, string>>): Promise<void> {
  await writeFile(join(dir, name), await zipParts(parts))
}

describe('readFileView xlsx', () => {
  it('returns every sheet name and its rows as strings', async () => {
    await writeOffice('book.xlsx', basicXlsxParts())
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
    await writeOffice('letter.docx', basicDocxParts())
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

// D75: a macro-enabled or template file has the same parts as its plain sibling; only the content type of the
// main part differs. Both readers must still open it (they locate the parts through the rels, not the type).
describe('readFileView macro-enabled and template files', () => {
  it('opens an xlsm whose workbook part is application/vnd.ms-excel.sheet.macroEnabled.main+xml', async () => {
    await writeOffice('macro.xlsm', macroXlsxParts())
    const view = await viewOf('macro.xlsm')
    expect(view.kind).toBe('sheet')
    expect(view.sheets.map((sheet) => sheet.name)).toEqual(['First', 'Second'])
    expect(view.sheets[0].rows).toEqual([
      ['Name', 'Count'],
      ['alpha', '42']
    ])
  })

  it('opens a docm whose document part is application/vnd.ms-word.document.macroEnabled.main+xml', async () => {
    await writeOffice('letter.docm', macroDocumentParts(DOCM_MAIN_TYPE))
    const view = await viewOf('letter.docm')
    expect(view.kind).toBe('docx')
    expect(view.content).toContain('bold world')
    expect(view.content).not.toMatch(/<img/i)
  })

  it('opens a dotx whose document part is the wordprocessingml template main type', async () => {
    await writeOffice('template.dotx', macroDocumentParts(DOTX_MAIN_TYPE))
    const view = await viewOf('template.dotx')
    expect(view.kind).toBe('docx')
    expect(view.content).toContain('Hello')
    expect(view.content).not.toMatch(/<img/i)
  })
})
