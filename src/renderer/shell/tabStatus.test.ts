import { describe, expect, it } from 'vitest'
import type { RuntimeState, Session } from '../../shared/types'
import { buildTabModels, folderName, tabIndicatorFor, tabVisualFor } from './tabStatus'

function runtime(sessionId: string, attention: RuntimeState['attention']): RuntimeState {
  return { sessionId, run: 'running', exitCode: null, attention }
}

function sessionNamed(id: string, name: string): Session {
  return {
    id,
    name,
    cwd: `C:\\work\\${id}`,
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: []
  }
}

describe('buildTabModels', () => {
  it('keeps the open order and joins each session with its runtime state', () => {
    const sessions = [sessionNamed('a', 'Alpha'), sessionNamed('b', 'Beta')]
    const states = new Map<string, RuntimeState>([['b', runtime('b', 'done')]])
    expect(buildTabModels(['b', 'a'], sessions, states)).toEqual([
      { id: 'b', title: 'Beta', run: 'running', attention: 'done' },
      { id: 'a', title: 'Alpha', run: null, attention: null }
    ])
  })

  it('skips open ids whose session is not in the store yet', () => {
    expect(buildTabModels(['ghost'], [sessionNamed('a', 'Alpha')], new Map())).toEqual([])
  })

  it('marks only opencode tabs with their agent', () => {
    const claude = sessionNamed('a', 'Alpha')
    const opencode: Session = { ...sessionNamed('b', 'Beta'), agent: 'opencode' }
    expect(buildTabModels(['a', 'b'], [claude, opencode], new Map())).toEqual([
      { id: 'a', title: 'Alpha', run: null, attention: null },
      { id: 'b', title: 'Beta', run: null, attention: null, agent: 'opencode' }
    ])
  })

  it('carries the runtime activity through to the tab model', () => {
    const states = new Map<string, RuntimeState>([
      ['a', { sessionId: 'a', run: 'running', exitCode: null, attention: null, activity: 'working' }]
    ])
    expect(buildTabModels(['a'], [sessionNamed('a', 'Alpha')], states)).toEqual([
      { id: 'a', title: 'Alpha', run: 'running', attention: null, activity: 'working' }
    ])
  })

  it('carries a non-zero exit code through to the tab model', () => {
    const states = new Map<string, RuntimeState>([
      ['a', { sessionId: 'a', run: 'exited', exitCode: 3, attention: null }]
    ])
    expect(buildTabModels(['a'], [sessionNamed('a', 'Alpha')], states)).toEqual([
      { id: 'a', title: 'Alpha', run: 'exited', attention: null, exitCode: 3 }
    ])
  })

  it('omits a null exit code so the plain "Exited" label stays', () => {
    const states = new Map<string, RuntimeState>([
      ['a', { sessionId: 'a', run: 'exited', exitCode: null, attention: null }]
    ])
    expect(buildTabModels(['a'], [sessionNamed('a', 'Alpha')], states)).toEqual([
      { id: 'a', title: 'Alpha', run: 'exited', attention: null }
    ])
  })
})

describe('tabVisualFor (working indicator precedence)', () => {
  it('a working session shows the spinner, not the green dot', () => {
    expect(tabVisualFor({ run: 'running', attention: null, activity: 'working' })).toEqual({ kind: 'working' })
  })
  it('attention (the bell) still wins over working', () => {
    expect(tabVisualFor({ run: 'running', attention: 'done', activity: 'working' })).toEqual({ kind: 'attention', reason: 'done' })
    expect(tabVisualFor({ run: 'running', attention: 'permission', activity: 'working' })).toEqual({ kind: 'attention', reason: 'permission' })
    expect(tabVisualFor({ run: 'running', attention: 'unread', activity: 'working' })).toEqual({ kind: 'attention', reason: 'unread' })
  })
  it('sleeping wins over working', () => {
    expect(tabVisualFor({ run: 'running', attention: null, sleeping: true, activity: 'working' })).toEqual({ kind: 'sleeping' })
  })
  it('needs-input without attention shows the waiting indicator', () => {
    expect(tabVisualFor({ run: 'running', attention: null, activity: 'needs-input' })).toEqual({ kind: 'needs-input' })
  })
  it('finished activity falls back to the plain dot', () => {
    const visual = tabVisualFor({ run: 'running', attention: null, activity: 'finished' })
    expect(visual.kind).toBe('dot')
    if (visual.kind === 'dot') expect(visual.indicator.colorClass).toBe('bg-status-success')
  })
  it('no activity keeps the old dot mapping', () => {
    expect(tabVisualFor({ run: 'exited', attention: null })).toEqual({ kind: 'dot', indicator: tabIndicatorFor('exited', null) })
    expect(tabVisualFor({ run: null, attention: null })).toEqual({ kind: 'dot', indicator: tabIndicatorFor(null, null) })
  })
})

describe('folderName', () => {
  it('returns the last segment of a Windows path', () => {
    expect(folderName('C:\\Works\\projects\\session-deck')).toBe('session-deck')
  })

  it('returns the last segment of a POSIX path and ignores a trailing separator', () => {
    expect(folderName('/home/me/app/')).toBe('app')
  })

  it('returns the input when there is no separator', () => {
    expect(folderName('solo')).toBe('solo')
  })
})

describe('tabIndicatorFor', () => {
  it('shows amber and pulses for a permission request', () => {
    const indicator = tabIndicatorFor('running', 'permission')
    expect(indicator.pulse).toBe(true)
    expect(indicator.colorClass).toContain('--attn-permission')
    expect(indicator.label).toBe('Needs permission')
  })

  it('shows green for a finished turn', () => {
    expect(tabIndicatorFor('running', 'done').colorClass).toContain('--attn-done')
  })

  it('shows blue for an idle session and for a bell', () => {
    expect(tabIndicatorFor('running', 'idle').colorClass).toContain('--attn-idle')
    expect(tabIndicatorFor('running', 'bell').colorClass).toContain('--attn-idle')
  })

  it('attention takes precedence over the run state', () => {
    expect(tabIndicatorFor('exited', 'done').label).toBe('Finished')
  })

  it('shows a steady green dot while running without attention', () => {
    const indicator = tabIndicatorFor('running', null)
    expect(indicator.pulse).toBe(false)
    expect(indicator.colorClass).toBe('bg-status-success')
    expect(indicator.label).toBe('Running')
  })

  it('shows a red dot when the process has exited', () => {
    const indicator = tabIndicatorFor('exited', null)
    expect(indicator.colorClass).toBe('bg-destructive')
    expect(indicator.label).toBe('Exited')
  })

  it('shows the exit code of a non-zero exit for any agent', () => {
    const indicator = tabIndicatorFor('exited', null, 42)
    expect(indicator.colorClass).toBe('bg-destructive')
    expect(indicator.label).toBe('Exited (42)')
  })

  it('keeps the plain label for a clean exit or an unknown code', () => {
    expect(tabIndicatorFor('exited', null, 0).label).toBe('Exited')
    expect(tabIndicatorFor('exited', null, null).label).toBe('Exited')
    expect(tabIndicatorFor('running', null, 3).label).toBe('Running')
  })

  it('attention still wins over an exit code', () => {
    expect(tabIndicatorFor('exited', 'done', 3).label).toBe('Finished')
  })

  it('shows a neutral dot before any runtime state is known', () => {
    const indicator = tabIndicatorFor(null, null)
    expect(indicator.colorClass).toBe('bg-muted-foreground')
    expect(indicator.label).toBe('Not started')
  })
})

