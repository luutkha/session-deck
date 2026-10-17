import { describe, expect, it } from 'vitest'
import type { Session } from '../../shared/types'
import { folderKey, projectTabIds } from './projectTabs'

const s = (id: string, cwd: string): Session => ({ id, cwd }) as Session

describe('projectTabIds', () => {
  const sessions = [
    s('a', 'C:\\work\\app'),
    s('b', 'c:/work/app/'),
    s('c', 'C:\\work\\other'),
    s('d', 'C:\\work\\app')
  ]

  it('keeps only open tabs from the active folder, in tab order', () => {
    expect(projectTabIds(['c', 'a', 'b'], sessions, 'a')).toEqual(['a', 'b'])
  })
  it('shows a lone session by itself', () => {
    expect(projectTabIds(['a', 'c'], sessions, 'c')).toEqual(['c'])
  })
  it('shows everything when nothing is active', () => {
    expect(projectTabIds(['a', 'c'], sessions, null)).toEqual(['a', 'c'])
  })
  it('does not list sessions that are not open', () => {
    expect(projectTabIds(['a'], sessions, 'a')).toEqual(['a'])
  })
})

describe('folderKey', () => {
  it('ignores slash style, trailing slash and case', () => {
    expect(folderKey('C:\\Work\\App\\')).toBe(folderKey('c:/work/app'))
  })
})
