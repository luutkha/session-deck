import { describe, expect, it } from 'vitest'
import type { RuntimeState, Session, StoreData } from '../../shared/types'
import { OPEN_TABS_STORAGE_KEY } from '../shell/openTabsLogic'
import { SPLIT_STORAGE_KEY } from '../split/splitLogic'
import { GRID_STORAGE_KEY } from '../grid/gridLogic'
import { SIDE_PANEL_TAB_KEY } from '../timeline/sidePanelTab'
import {
  DEFAULT_MODE,
  NOTES_STORAGE_KEY,
  VIEW_STORAGE_KEY,
  decideFocus,
  dataForMode,
  effectiveMode,
  modeAfterDock,
  modeStorageKeys,
  needsYouCounts,
  otherMode,
  parseStoredMode,
  sessionMode,
  storageKeyFor
} from './modeLogic'

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    name: 'Session',
    cwd: 'C:\\Works\\app',
    groupId: null,
    statusId: null,
    order: 0,
    createdAt: 1,
    claudeArgs: [],
    ...overrides
  }
}

function store(sessions: readonly Session[]): StoreData {
  return {
    version: 1,
    sessions,
    groups: [{ id: 'g1', name: 'Group', collapsed: false }],
    statuses: [{ id: 'working', name: 'Working', color: '#42a5f5' }],
    groupOrder: ['g1'],
    repos: [{ id: 'r1', name: 'app', path: 'C:\\Works\\app', createdAt: 1, collapsed: false }],
    worktrees: []
  }
}

describe('sessionMode', () => {
  it('treats a session without worktreeId as an Ops session', () => {
    expect(sessionMode(session({ id: 'a' }))).toBe('ops')
  })

  it('treats a session with worktreeId as a Code session', () => {
    expect(sessionMode(session({ id: 'a', worktreeId: 'w1' }))).toBe('code')
  })
})

describe('otherMode', () => {
  it('returns Code for Ops and Ops for Code', () => {
    expect(otherMode('ops')).toBe('code')
    expect(otherMode('code')).toBe('ops')
  })
})

describe('dataForMode', () => {
  it('leaves Jarvis out of both modes (it lives in its own panel, D53)', () => {
    const data = store([session({ id: 'a' }), session({ id: 'j', role: 'jarvis' })])
    expect(dataForMode(data, 'ops').sessions.map((s) => s.id)).toEqual(['a'])
    expect(dataForMode(data, 'code').sessions).toEqual([])
  })

  it('keeps every field of the store and filters only the sessions', () => {
    const data = store([session({ id: 'a' })])
    const ops = dataForMode(data, 'ops')
    expect(ops.groups).toBe(data.groups)
    expect(ops.statuses).toBe(data.statuses)
    expect(ops.repos).toBe(data.repos)
    expect(ops.worktrees).toBe(data.worktrees)
    expect(ops.version).toBe(1)
  })

  it('does not change the input store', () => {
    const data = store([session({ id: 'a' }), session({ id: 'b', worktreeId: 'w1' })])
    dataForMode(data, 'code')
    expect(data.sessions).toHaveLength(2)
  })

  it('gives an empty session list for an empty store in either mode', () => {
    expect(dataForMode(store([]), 'ops').sessions).toEqual([])
    expect(dataForMode(store([]), 'code').sessions).toEqual([])
  })

  it('splits mixed sessions so that no session appears in both modes', () => {
    const data = store([
      session({ id: 'ops1' }),
      session({ id: 'code1', worktreeId: 'w1' }),
      session({ id: 'ops2', closedAt: 9 }),
      session({ id: 'code2', worktreeId: 'w2' })
    ])
    const opsIds = dataForMode(data, 'ops').sessions.map((s: Session): string => s.id)
    const codeIds = dataForMode(data, 'code').sessions.map((s: Session): string => s.id)
    expect(opsIds).toEqual(['ops1', 'ops2'])
    expect(codeIds).toEqual(['code1', 'code2'])
  })
})

describe('storageKeyFor', () => {
  it('leaves Ops keys unchanged', () => {
    expect(storageKeyFor('sessiondeck-open-tabs', 'ops')).toBe('sessiondeck-open-tabs')
    expect(storageKeyFor('sessiondeck.view.v1', 'ops')).toBe('sessiondeck.view.v1')
  })

  it('gives Code its own suffixed key', () => {
    expect(storageKeyFor('sessiondeck.view.v1', 'code')).toBe('sessiondeck.view.v1.code')
  })
})

describe('modeStorageKeys', () => {
  it('returns the historical keys for Ops', () => {
    expect(modeStorageKeys('ops')).toEqual({
      tabs: OPEN_TABS_STORAGE_KEY,
      split: SPLIT_STORAGE_KEY,
      grid: GRID_STORAGE_KEY,
      view: VIEW_STORAGE_KEY,
      notes: NOTES_STORAGE_KEY,
      sidePanel: SIDE_PANEL_TAB_KEY
    })
  })

  it('returns different keys for Code than for Ops in every slot', () => {
    const ops = modeStorageKeys('ops')
    const code = modeStorageKeys('code')
    for (const slot of Object.keys(ops) as (keyof typeof ops)[]) {
      expect(code[slot]).not.toBe(ops[slot])
    }
  })
})

describe('parseStoredMode', () => {
  it('reads code as Code', () => {
    expect(parseStoredMode('code')).toBe('code')
  })

  it('reads ops as Ops', () => {
    expect(parseStoredMode('ops')).toBe('ops')
  })

  it('falls back to Ops for a missing value', () => {
    expect(parseStoredMode(null)).toBe(DEFAULT_MODE)
  })

  it('falls back to Ops for garbage', () => {
    expect(parseStoredMode('{"mode":"code"}')).toBe('ops')
    expect(parseStoredMode('CODE ')).toBe('ops')
    expect(parseStoredMode('')).toBe('ops')
  })
})

describe('effectiveMode', () => {
  it('always shows Code in the Code window, whatever is stored', () => {
    expect(effectiveMode('code', 'ops', false)).toBe('code')
    expect(effectiveMode('code', 'code', true)).toBe('code')
  })

  it('shows the stored mode in the main window when Code is not popped out', () => {
    expect(effectiveMode('main', 'ops', false)).toBe('ops')
    expect(effectiveMode('main', 'code', false)).toBe('code')
  })

  it('shows Ops in the main window while Code is popped out', () => {
    expect(effectiveMode('main', 'code', true)).toBe('ops')
    expect(effectiveMode('main', 'ops', true)).toBe('ops')
  })
})

describe('modeAfterDock', () => {
  it('switches to Code when the Code window closes (true to false)', () => {
    expect(modeAfterDock(true, false)).toBe('code')
  })

  it('does nothing when Code pops out (false to true)', () => {
    expect(modeAfterDock(false, true)).toBeNull()
  })

  it('does nothing while the state stays the same', () => {
    expect(modeAfterDock(false, false)).toBeNull()
    expect(modeAfterDock(true, true)).toBeNull()
  })
})

describe('decideFocus', () => {
  it('needs no switch when the session is in the current mode', () => {
    expect(decideFocus('ops', 'ops', false)).toEqual({})
    expect(decideFocus('code', 'code', false)).toEqual({})
  })

  it('switches the main window to the session mode when it differs', () => {
    expect(decideFocus('ops', 'code', false)).toEqual({ switchTo: 'code' })
    expect(decideFocus('code', 'ops', false)).toEqual({ switchTo: 'ops' })
  })

  it('does not switch while Code is popped out (the Code window shows it)', () => {
    expect(decideFocus('ops', 'code', true)).toEqual({})
  })

  it('does not switch the Code window away from Code', () => {
    expect(decideFocus('code', 'ops', true)).toEqual({})
  })
})

describe('needsYouCounts', () => {
  const bell: RuntimeState = { sessionId: 'x', run: 'running', exitCode: null, attention: 'permission', attentionAt: 5 }

  it('is zero for both modes before the store loads', () => {
    expect(needsYouCounts(null, new Map())).toEqual({ ops: 0, code: 0 })
  })

  it('counts the bells of each mode separately', () => {
    const data = store([
      session({ id: 'o1' }),
      session({ id: 'o2' }),
      session({ id: 'c1', worktreeId: 'w1' })
    ])
    const runtime = new Map<string, RuntimeState>([
      ['o1', { ...bell, sessionId: 'o1' }],
      ['c1', { ...bell, sessionId: 'c1' }]
    ])
    expect(needsYouCounts(data, runtime)).toEqual({ ops: 1, code: 1 })
  })

  it('does not count closed sessions', () => {
    const data = store([session({ id: 'c1', worktreeId: 'w1', closedAt: 3 })])
    const runtime = new Map<string, RuntimeState>([['c1', { ...bell, sessionId: 'c1' }]])
    expect(needsYouCounts(data, runtime)).toEqual({ ops: 0, code: 0 })
  })

  it('never counts Jarvis in either mode (D53)', () => {
    const data = store([session({ id: 'j', role: 'jarvis' })])
    const runtime = new Map<string, RuntimeState>([['j', { ...bell, sessionId: 'j' }]])
    expect(needsYouCounts(data, runtime)).toEqual({ ops: 0, code: 0 })
  })
})
