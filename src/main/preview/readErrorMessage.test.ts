import { describe, expect, it } from 'vitest'
import { readErrorMessage } from './readFileView'

describe('readErrorMessage', () => {
  it('turns a zip-library message into one plain sentence and drops its link', () => {
    const raw = new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html")
    const text = readErrorMessage('docx', raw)
    expect(text.startsWith('Could not read this Word document')).toBe(true)
    expect(text).not.toContain('http')
    expect(text).toContain("Can't find end of central directory")
  })

  it('names a spreadsheet as a spreadsheet', () => {
    expect(readErrorMessage('sheet', new Error('No data'))).toMatch(/^Could not read this spreadsheet: .*\(No data\)$/)
  })

  it('keeps the plain wording for the other kinds, and works with non-Error values', () => {
    expect(readErrorMessage('text', new Error('EBUSY: resource busy or locked'))).toBe('Could not read the file: EBUSY: resource busy or locked')
    expect(readErrorMessage(null, 'boom')).toContain('boom')
  })

  it('caps a very long detail and collapses line breaks', () => {
    const text = readErrorMessage('sheet', new Error('a'.repeat(500) + '\n\n' + 'b'.repeat(500)))
    expect(text.length).toBeLessThan(220)
    expect(text).not.toContain('\n')
  })

  it('has no detail suffix when the error carries no text', () => {
    expect(readErrorMessage('text', new Error(''))).toBe('Could not read the file')
  })
})
