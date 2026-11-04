import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SOUND_SETTINGS, withSettingsPatch, type SoundSettings, type SoundSettingsPatch } from '../sound/soundSettings'
import { describeSound, runWindowAction, type WindowUiDeps } from './windowUi'
import { applySidebarView, describeSidebarView, type SidebarViewControl } from './sidebarView'

function soundDeps(): WindowUiDeps & { current: () => SoundSettings } {
  let settings = DEFAULT_SOUND_SETTINGS
  const play = vi.fn(async () => undefined)
  return {
    current: () => settings,
    sound: {
      get: () => settings,
      update: (patch: SoundSettingsPatch) => { settings = withSettingsPatch(settings, patch) },
      play
    }
  }
}

describe('runWindowAction (D58 sounds)', () => {
  it('leaves workspace actions alone', () => {
    expect(runWindowAction({ kind: 'state' }, soundDeps())).toBeNull()
  })

  it('turns sounds off, sets the volume and a sound per event, and plays a test', () => {
    const d = soundDeps()
    const text = runWindowAction({ kind: 'sound', enabled: false, volume: 0.4, events: { done: { kind: 'builtin', id: 'marimba' }, bell: { kind: 'none' } }, test: 'done' }, d)
    expect(d.current().enabled).toBe(false)
    expect(d.current().volume).toBeCloseTo(0.4)
    expect(d.current().perReason.done).toEqual({ kind: 'builtin', id: 'marimba' })
    expect(d.current().perReason.bell).toEqual({ kind: 'none' })
    expect(d.sound.play).toHaveBeenCalledWith({ kind: 'builtin', id: 'marimba' }, 0.4)
    expect(text).toContain('Sounds: off, volume 40%')
    expect(text).toContain('done (turn finished): marimba')
    expect(text).toContain('Played the done sound.')
  })

  it('refuses unknown sounds, events and volumes', () => {
    const d = soundDeps()
    expect(() => runWindowAction({ kind: 'sound', events: { done: { kind: 'builtin', id: 'kazoo' } } }, d)).toThrow('Unknown sound "kazoo"')
    expect(() => runWindowAction({ kind: 'sound', events: { nope: { kind: 'none' } } as never }, d)).toThrow('Unknown sound event')
    expect(() => runWindowAction({ kind: 'sound', volume: 2 }, d)).toThrow('0 to 100')
    expect(describeSound(d.current())).toContain('Sounds: on')
  })
})

function control(over: Partial<SidebarViewControl> = {}): SidebarViewControl {
  return {
    state: () => ({ groupBy: 'groups', showWorkspaces: true, search: '', statusFilter: ['st1', null], closedCollapsed: true }),
    statusNames: () => new Map([['st1', 'Review']]),
    setSearch: vi.fn(),
    setClosedCollapsed: vi.fn(),
    setGroupBy: vi.fn(),
    setShowWorkspaces: vi.fn(),
    setStatusFilter: vi.fn(),
    setSectionsCollapsed: vi.fn(),
    ...over
  }
}

describe('sidebar view (D58)', () => {
  it('describes and applies every option of the Ops sidebar', () => {
    const c = control()
    expect(describeSidebarView(c)).toBe('Sidebar list: grouped by group, folder buckets on, no search, status filter "Review", "No status", Closed section collapsed')
    applySidebarView({ groupBy: 'status', showWorkspaces: false, search: 'api', statusFilter: [], closedSection: 'expanded', sections: 'collapseAll' }, c)
    expect(c.setGroupBy).toHaveBeenCalledWith('status')
    expect(c.setShowWorkspaces).toHaveBeenCalledWith(false)
    expect(c.setSearch).toHaveBeenCalledWith('api')
    expect(c.setStatusFilter).toHaveBeenCalledWith(new Set())
    expect(c.setClosedCollapsed).toHaveBeenCalledWith(false)
    expect(c.setSectionsCollapsed).toHaveBeenCalledWith(true)
    expect(() => applySidebarView({ statusFilter: ['zz'] }, c)).toThrow('Unknown status id')
  })

  it('says what the Code sidebar does not have', () => {
    const code = control({ setGroupBy: undefined, setShowWorkspaces: undefined, setStatusFilter: undefined, setSectionsCollapsed: undefined })
    expect(() => applySidebarView({ groupBy: 'status' }, code)).toThrow('Code mode sidebar has no "group by"')
    applySidebarView({ search: 'x', closedSection: 'collapsed' }, code)
    expect(code.setSearch).toHaveBeenCalledWith('x')
  })
})
