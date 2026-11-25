import { describe, expect, it } from 'vitest'
import { badgeTitle, changeBadge } from './changeBadge'

describe('changeBadge', () => {
  it('is null when there are no changes', () => {
    expect(changeBadge(0, 0)).toBeNull()
  })
  it('shows the unreviewed count while any file is unreviewed', () => {
    expect(changeBadge(3, 5)).toEqual({ text: '3', unreviewed: true })
  })
  it('shows the total once everything is reviewed', () => {
    expect(changeBadge(0, 5)).toEqual({ text: '5', unreviewed: false })
  })
  it('caps counts above 99 with 99+', () => {
    expect(changeBadge(150, 200)).toEqual({ text: '99+', unreviewed: true })
    expect(changeBadge(0, 100)).toEqual({ text: '99+', unreviewed: false })
    expect(changeBadge(99, 99)).toEqual({ text: '99', unreviewed: true })
  })
})

describe('badgeTitle', () => {
  it('spells out partially reviewed files', () => {
    expect(badgeTitle(3, 5)).toBe('3 of 5 changed files not reviewed yet')
  })
  it('spells out a fully reviewed list, singular and plural', () => {
    expect(badgeTitle(0, 5)).toBe('5 changed files, all reviewed')
    expect(badgeTitle(0, 1)).toBe('1 changed file, all reviewed')
  })
  it('agrees in number for a single unreviewed file', () => {
    expect(badgeTitle(1, 1)).toBe('1 of 1 changed file not reviewed yet')
  })
  it('has no title when there are no changes', () => {
    expect(badgeTitle(0, 0)).toBe('')
  })
})
