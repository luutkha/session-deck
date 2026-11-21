import { describe, expect, it } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import type { ResolvedLink } from '../../../shared/types'
import {
  clearHoveredLink,
  getHoveredLink,
  setHoveredLink,
  type HoveredLink
} from './hoveredLink'

const term = (): Terminal => ({}) as Terminal
const file: ResolvedLink = { kind: 'file', target: 'C:\\work\\notes.md' }
const other: ResolvedLink = { kind: 'folder', target: 'C:\\work' }

function hovered(link: ResolvedLink, text = 'notes.md'): HoveredLink {
  return { sessionId: 's1', text, link }
}

describe('hovered link record (D76)', () => {
  it('is empty for a terminal nobody hovered', () => {
    expect(getHoveredLink(term())).toBeNull()
  })

  it('records the hovered link per terminal and clears it', () => {
    const first = term()
    const second = term()
    setHoveredLink(first, hovered(file))
    setHoveredLink(second, hovered(other))
    expect(getHoveredLink(first)?.link).toBe(file)
    expect(getHoveredLink(second)?.link).toBe(other)
    setHoveredLink(first, null)
    expect(getHoveredLink(first)).toBeNull()
    expect(getHoveredLink(second)?.link).toBe(other)
  })

  it('keeps the next link when the previous leave arrives late', () => {
    const t = term()
    const previous = hovered(file)
    const next = hovered(other)
    setHoveredLink(t, previous)
    setHoveredLink(t, next)
    clearHoveredLink(t, previous)
    expect(getHoveredLink(t)).toBe(next)
    clearHoveredLink(t, next)
    expect(getHoveredLink(t)).toBeNull()
  })

  it('clears only the same link', () => {
    const t = term()
    setHoveredLink(t, hovered(file))
    clearHoveredLink(t, hovered(file))
    expect(getHoveredLink(t)).toBeNull()
    setHoveredLink(t, hovered(file))
    clearHoveredLink(t, hovered(other))
    expect(getHoveredLink(t)?.link).toBe(file)
  })
})
