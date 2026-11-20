import { describe, expect, it } from 'vitest'
import type { ResolvedLink } from '../../../shared/types'
import { decideLinkClick, type LinkClickModifiers } from './linkClick'

const NO_MODIFIERS: LinkClickModifiers = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }
const SHIFT: LinkClickModifiers = { ...NO_MODIFIERS, shiftKey: true }
const CTRL: LinkClickModifiers = { ...NO_MODIFIERS, ctrlKey: true }
const META: LinkClickModifiers = { ...NO_MODIFIERS, metaKey: true }
const ALT: LinkClickModifiers = { ...NO_MODIFIERS, altKey: true }

function file(target: string): ResolvedLink {
  return { kind: 'file', target }
}

describe('decideLinkClick', () => {
  it('reveals on Shift for every kind', () => {
    expect(decideLinkClick(file('C:\\work\\notes.md'), SHIFT)).toBe('reveal')
    expect(decideLinkClick(file('C:\\work\\app.exe'), SHIFT)).toBe('reveal')
    expect(decideLinkClick({ kind: 'folder', target: 'C:\\work' }, SHIFT)).toBe('reveal')
    expect(decideLinkClick({ kind: 'url', target: 'https://example.com' }, SHIFT)).toBe('reveal')
  })

  it('Shift wins over Ctrl and Meta', () => {
    expect(decideLinkClick(file('C:\\work\\notes.md'), { ...SHIFT, ctrlKey: true })).toBe('reveal')
    expect(decideLinkClick(file('C:\\work\\notes.md'), { ...SHIFT, metaKey: true })).toBe('reveal')
  })

  it('opens viewable files externally on Ctrl or Meta', () => {
    expect(decideLinkClick(file('C:\\work\\notes.md'), CTRL)).toBe('open')
    expect(decideLinkClick(file('C:\\work\\notes.md'), META)).toBe('open')
    expect(decideLinkClick(file('C:\\work\\shot.PNG'), CTRL)).toBe('open')
  })

  it('views a plain-clicked file the viewer supports', () => {
    for (const target of [
      'C:\\work\\notes.md',
      'C:\\work\\readme.markdown',
      'C:\\work\\app.log',
      'C:\\work\\data.json',
      'C:\\work\\conf.yaml',
      'C:\\work\\shot.png',
      'C:\\work\\photo.JPEG',
      'C:\\work\\table.csv',
      'C:\\work\\book.xlsx',
      'C:\\work\\report.docx',
      'C:\\Users\\John Smith\\My Notes\\plan.md'
    ]) {
      expect(decideLinkClick(file(target), NO_MODIFIERS)).toBe('view')
    }
  })

  it('views upper-case extensions too', () => {
    expect(decideLinkClick(file('C:\\work\\NOTES.MD'), NO_MODIFIERS)).toBe('view')
    expect(decideLinkClick(file('C:\\work\\SHOT.PNG'), NO_MODIFIERS)).toBe('view')
    expect(decideLinkClick(file('C:\\work\\TABLE.CSV'), NO_MODIFIERS)).toBe('view')
    expect(decideLinkClick(file('C:\\work\\Manual.PDF'), NO_MODIFIERS)).toBe('view')
  })

  it('keeps opening files the viewer cannot show', () => {
    expect(decideLinkClick(file('C:\\work\\old.xls'), NO_MODIFIERS)).toBe('open')
    expect(decideLinkClick(file('C:\\work\\letter.doc'), NO_MODIFIERS)).toBe('open')
    expect(decideLinkClick(file('C:\\work\\app.exe'), NO_MODIFIERS)).toBe('open')
    expect(decideLinkClick(file('C:\\work\\Makefile'), NO_MODIFIERS)).toBe('open')
  })

  it('keeps opening URLs and folders', () => {
    expect(decideLinkClick({ kind: 'url', target: 'https://example.com/notes.md' }, NO_MODIFIERS)).toBe('open')
    expect(decideLinkClick({ kind: 'folder', target: 'C:\\work\\notes.md' }, NO_MODIFIERS)).toBe('open')
  })

  it('ignores Alt on its own', () => {
    expect(decideLinkClick(file('C:\\work\\notes.md'), ALT)).toBe('view')
    expect(decideLinkClick(file('C:\\work\\app.exe'), ALT)).toBe('open')
  })
})
