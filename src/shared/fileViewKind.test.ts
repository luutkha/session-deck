import { describe, expect, it } from 'vitest'
import { fileViewKindFor } from './fileViewKind'

describe('fileViewKindFor', () => {
  it('knows every type the user asked for, in any letter case', () => {
    expect(fileViewKindFor('C:\\work\\README.md')).toBe('markdown')
    expect(fileViewKindFor('notes.MARKDOWN')).toBe('markdown')
    expect(fileViewKindFor('C:/pics/a.PNG')).toBe('image')
    expect(fileViewKindFor('table.csv')).toBe('csv')
    expect(fileViewKindFor('table.TSV')).toBe('csv')
    expect(fileViewKindFor('book.xlsx')).toBe('sheet')
    expect(fileViewKindFor('report.docx')).toBe('docx')
    expect(fileViewKindFor('C:\\docs\\manual.PDF')).toBe('pdf')
  })

  it('treats the other common image formats as images (svg is shown through an <img>, so it stays inert)', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']) {
      expect(fileViewKindFor(`x.${ext}`), ext).toBe('image')
    }
  })

  it('opens macro-enabled and template Office files with the same readers', () => {
    expect(fileViewKindFor('book.xlsm')).toBe('sheet')
    expect(fileViewKindFor('report.docm')).toBe('docx')
    expect(fileViewKindFor('letter.dotx')).toBe('docx')
  })

  it('treats text-like files as text', () => {
    for (const ext of ['txt', 'log', 'json', 'yaml', 'yml']) {
      expect(fileViewKindFor(`x.${ext}`), ext).toBe('text')
    }
  })

  it('refuses what the viewer cannot show: legacy Office, programs, archives, no extension', () => {
    for (const name of ['old.xls', 'letter.doc', 'slides.ppt', 'app.exe', 'run.bat', 'pack.zip', 'Makefile', '.gitignore', 'trailing.', 'C:\\dir.with.dots\\file']) {
      expect(fileViewKindFor(name), name).toBeNull()
    }
  })
})
