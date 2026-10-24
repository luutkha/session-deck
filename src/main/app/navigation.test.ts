import { describe, expect, it } from 'vitest'
import { isSameDocumentNavigation } from './navigation'

describe('isSameDocumentNavigation', () => {
  it('allows the same document and fragment-only changes', () => {
    expect(isSameDocumentNavigation('file:///app/index.html', 'file:///app/index.html')).toBe(true)
    expect(isSameDocumentNavigation('file:///app/index.html', 'file:///app/index.html#/hub')).toBe(true)
    expect(isSameDocumentNavigation('http://localhost:5173/', 'http://localhost:5173/#x')).toBe(true)
  })

  it('blocks another path, another origin and another query', () => {
    expect(isSameDocumentNavigation('file:///app/index.html', 'file:///app/other.html')).toBe(false)
    expect(isSameDocumentNavigation('http://localhost:5173/', 'http://localhost:5174/')).toBe(false)
    expect(isSameDocumentNavigation('https://app.local/', 'https://evil.local/')).toBe(false)
    expect(isSameDocumentNavigation('https://app.local/', 'https://app.local/?next=evil')).toBe(false)
  })

  it('is not fooled by a URL that starts with the current one', () => {
    expect(isSameDocumentNavigation('file:///app/index.html', 'file:///app/index.html.evil')).toBe(false)
  })

  it('blocks an unparseable target', () => {
    expect(isSameDocumentNavigation('file:///app/index.html', 'not a url')).toBe(false)
  })
})
