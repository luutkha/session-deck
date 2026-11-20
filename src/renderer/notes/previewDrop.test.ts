import { describe, expect, it } from 'vitest'
import { previewDropFor } from './previewDrop'

describe('previewDropFor', () => {
  it('shows a file the viewer knows', () => {
    expect(previewDropFor('C:\\p\\README.md')).toEqual({ kind: 'view', text: 'C:\\p\\README.md' })
    expect(previewDropFor('C:\\p\\sheet.xlsx')).toEqual({ kind: 'view', text: 'C:\\p\\sheet.xlsx' })
  })

  it('trims the path it passes on', () => {
    expect(previewDropFor('  C:\\p\\notes.txt  ')).toEqual({ kind: 'view', text: 'C:\\p\\notes.txt' })
  })

  it('refuses a type the viewer cannot show', () => {
    expect(previewDropFor('C:\\p\\app.exe')).toEqual({ kind: 'unsupported' })
    expect(previewDropFor('C:\\p\\drawing.svg')).toEqual({ kind: 'unsupported' })
    expect(previewDropFor('C:\\p\\folder')).toEqual({ kind: 'unsupported' })
  })

  it('ignores a blank path', () => {
    expect(previewDropFor('')).toEqual({ kind: 'ignore' })
    expect(previewDropFor('   ')).toEqual({ kind: 'ignore' })
  })
})
