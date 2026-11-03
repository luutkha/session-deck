import { describe, expect, it } from 'vitest'
import type { Id, RuntimeState, Session } from '../../shared/types'
import { folderKey, isActiveSession, projectTabIds } from './projectTabs'

const s = (id: string, cwd: string): Session => ({ id, cwd }) as Session
const rt = (sessionId: string, run: 'running' | 'exited', sleeping = false): RuntimeState =>
  ({ sessionId, run, exitCode: null, attention: null, sleeping }) as RuntimeState
const runtimeOf = (...states: RuntimeState[]): ReadonlyMap<Id, RuntimeState> =>
  new Map(states.map((st): [Id, RuntimeState] => [st.sessionId, st]))

describe('projectTabIds', () => {
  const sessions = [
    s('a', 'C:\\work\\app'),
    s('b', 'c:/work/app/'),
    s('c', 'C:\\work\\other'),
    s('d', 'C:\\work\\app')
  ]
  const allRunning = runtimeOf(rt('a', 'running'), rt('b', 'running'), rt('c', 'running'), rt('d', 'running'))

  it('keeps only open tabs from the active folder, in tab order', () => {
    expect(projectTabIds(['c', 'a', 'b'], sessions, 'a', allRunning)).toEqual(['a', 'b'])
  })
  it('shows a lone session by itself', () => {
    expect(projectTabIds(['a', 'c'], sessions, 'c', allRunning)).toEqual(['c'])
  })
  it('shows every active tab when nothing is active', () => {
    expect(projectTabIds(['a', 'c'], sessions, null, allRunning)).toEqual(['a', 'c'])
  })
  it('does not list sessions that are not open', () => {
    expect(projectTabIds(['a'], sessions, 'a', allRunning)).toEqual(['a'])
  })
  it('hides sleeping, exited and never-started sessions of the folder (D55)', () => {
    const runtime = runtimeOf(rt('a', 'running'), rt('b', 'running', true), rt('d', 'exited'))
    expect(projectTabIds(['a', 'b', 'd'], sessions, 'a', runtime)).toEqual(['a'])
    expect(projectTabIds(['a', 'b'], sessions, 'a', runtimeOf(rt('a', 'running')))).toEqual(['a'])
  })
  it('always keeps the session on screen, even asleep (D55)', () => {
    const runtime = runtimeOf(rt('a', 'running', true), rt('b', 'running'))
    expect(projectTabIds(['a', 'b'], sessions, 'a', runtime)).toEqual(['a', 'b'])
  })
  it('hides inactive tabs when nothing is active (D55)', () => {
    expect(projectTabIds(['a', 'c'], sessions, null, runtimeOf(rt('a', 'exited'), rt('c', 'running')))).toEqual(['c'])
  })
})

describe('isActiveSession', () => {
  it('is true only for a running, awake session', () => {
    expect(isActiveSession(rt('a', 'running'))).toBe(true)
    expect(isActiveSession(rt('a', 'running', true))).toBe(false)
    expect(isActiveSession(rt('a', 'exited'))).toBe(false)
    expect(isActiveSession(undefined)).toBe(false)
  })
})

describe('folderKey', () => {
  it('ignores slash style, trailing slash and case', () => {
    expect(folderKey('C:\\Work\\App\\')).toBe(folderKey('c:/work/app'))
  })
})
