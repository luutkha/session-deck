import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SOUND_SETTINGS, withSettingsPatch, type SoundSettings, type SoundSettingsPatch } from '../sound/soundSettings'
import type { EffectsPref, RendererPref } from '../Terminal/terminalRenderer'
import type { RightClickMode } from '../Terminal/keymap'
import type { TermView } from '../Terminal/termView'
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

describe('runWindowAction (D71 terminal preferences)', () => {
  it('runs the terminal preferences of the window and still leaves workspace actions alone', () => {
    let renderer: RendererPref = 'auto'
    let effects: EffectsPref = 'auto'
    let view: TermView = { zoomPercent: 100, scrollbackLines: 10_000 }
    let rightClick: RightClickMode = 'menu'
    const deps: WindowUiDeps = {
      ...soundDeps(),
      terminalPrefs: {
        getGraphicsPrefs: () => ({ renderer, effects }),
        setRendererPref: (pref) => { renderer = pref },
        setEffectsPref: (pref) => { effects = pref },
        readTermView: () => view,
        setTermView: (next) => { view = next },
        readRightClickMode: () => rightClick,
        storeRightClickMode: (mode) => { rightClick = mode }
      }
    }
    const text = runWindowAction({ kind: 'terminalPrefs', renderer: 'dom', zoomPercent: 120, rightClick: 'copy-paste' }, deps)
    expect(text).toContain('Terminal renderer: dom (auto = WebGL with a GPU, DOM without).')
    expect(text).toContain('Zoom: 120%.')
    expect(renderer).toBe('dom')
    expect(view).toEqual({ zoomPercent: 120, scrollbackLines: 10_000 })
    expect(rightClick).toBe('paste')
    expect(runWindowAction({ kind: 'zoom', action: 'in' }, deps)).toBeNull()
  })
})

describe('runWindowAction (Jarvis panel preferences)', () => {
  it('changes the read-aloud toggle and the panel width through the window stores', () => {
    let speak = false
    let width = 520
    const deps: WindowUiDeps = {
      ...soundDeps(),
      jarvisPrefs: {
        getSpeak: () => speak,
        setSpeak: (on) => { speak = on },
        getPanelWidth: () => width,
        setPanelWidth: (px) => { width = px },
        widthLimits: () => ({ min: 340, max: 1_200, defaultWidth: 520 })
      }
    }
    const text = runWindowAction({ kind: 'jarvisPrefs', speak: true, panelWidth: 400 }, deps)
    expect(text).toContain('Jarvis reads its replies aloud: on.')
    expect(text).toContain('Jarvis panel width: 400px (limits 340-1200px).')
    expect(speak).toBe(true)
    expect(width).toBe(400)
    expect(runWindowAction({ kind: 'jarvisPrefs' }, deps)).toContain('Jarvis panel width: 400px')
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
