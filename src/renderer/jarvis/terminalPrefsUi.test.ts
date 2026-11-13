import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TERM_VIEW, SCROLLBACK_MAX, SCROLLBACK_MIN, ZOOM_MAX, ZOOM_MIN, type TermView } from '../Terminal/termView'
import type { EffectsPref, RendererPref } from '../Terminal/terminalRenderer'
import type { RightClickMode } from '../Terminal/keymap'
import { applyTerminalPrefs, describeTerminalPrefs, type TerminalPrefsDeps } from './terminalPrefsUi'

interface FakeGraphics {
  renderer: RendererPref
  effects: EffectsPref
}

function setup(
  graphics0: FakeGraphics = { renderer: 'auto', effects: 'auto' },
  view0: TermView = DEFAULT_TERM_VIEW,
  rightClick0: RightClickMode = 'menu'
) {
  let graphics = graphics0
  let view = view0
  let rightClick = rightClick0
  const deps: TerminalPrefsDeps = {
    getGraphicsPrefs: () => graphics,
    setRendererPref: vi.fn((pref: RendererPref) => {
      graphics = { ...graphics, renderer: pref }
    }),
    setEffectsPref: vi.fn((pref: EffectsPref) => {
      graphics = { ...graphics, effects: pref }
    }),
    readTermView: () => view,
    setTermView: vi.fn((next: TermView) => {
      view = next
    }),
    readRightClickMode: () => rightClick,
    storeRightClickMode: vi.fn((mode: RightClickMode) => {
      rightClick = mode
    })
  }
  return { deps, graphics: () => graphics, view: () => view, rightClick: () => rightClick }
}

describe('terminal preferences (D71)', () => {
  it('changes every field and answers with all current values', () => {
    const t = setup()
    const text = applyTerminalPrefs(
      { kind: 'terminalPrefs', renderer: 'dom', effects: 'reduced', scrollbackLines: 5_000, zoomPercent: 110, rightClick: 'copy-paste' },
      t.deps
    )
    expect(t.graphics()).toEqual({ renderer: 'dom', effects: 'reduced' })
    expect(t.view()).toEqual({ scrollbackLines: 5_000, zoomPercent: 110 })
    expect(t.rightClick()).toBe('paste')
    // Zoom and scrollback share one stored profile: one write, not two.
    expect(t.deps.setTermView).toHaveBeenCalledTimes(1)
    expect(text).toBe(
      [
        'Terminal renderer: dom (auto = WebGL with a GPU, DOM without).',
        'Visual effects: reduced.',
        'Scrollback: 5000 lines (applies to terminals opened from now on).',
        'Zoom: 110%.',
        'Right-click: copy-paste.'
      ].join('\n')
    )
  })

  it('changes only the fields it is given, and reports when nothing is', () => {
    const t = setup()
    const text = applyTerminalPrefs({ kind: 'terminalPrefs', effects: 'full' }, t.deps)
    expect(t.graphics()).toEqual({ renderer: 'auto', effects: 'full' })
    expect(t.deps.setRendererPref).not.toHaveBeenCalled()
    expect(t.deps.setTermView).not.toHaveBeenCalled()
    expect(t.deps.storeRightClickMode).not.toHaveBeenCalled()
    expect(text).toContain('Visual effects: full.')

    const unchanged = setup()
    const report = applyTerminalPrefs({ kind: 'terminalPrefs' }, unchanged.deps)
    expect(report).toContain('Terminal renderer: auto')
    expect(report).toContain('Scrollback: 10000 lines')
    expect(report).toContain('Zoom: 100%.')
    expect(report).toContain('Right-click: menu.')
    expect(unchanged.deps.setRendererPref).not.toHaveBeenCalled()
    expect(unchanged.deps.setEffectsPref).not.toHaveBeenCalled()
    expect(unchanged.deps.setTermView).not.toHaveBeenCalled()
    expect(unchanged.deps.storeRightClickMode).not.toHaveBeenCalled()
  })

  it('writes nothing when the values already match', () => {
    const t = setup({ renderer: 'webgl', effects: 'reduced' }, { zoomPercent: 120, scrollbackLines: 20_000 }, 'paste')
    const text = applyTerminalPrefs(
      { kind: 'terminalPrefs', renderer: 'webgl', effects: 'reduced', zoomPercent: 120, scrollbackLines: 20_000, rightClick: 'copy-paste' },
      t.deps
    )
    expect(t.deps.setRendererPref).not.toHaveBeenCalled()
    expect(t.deps.setEffectsPref).not.toHaveBeenCalled()
    expect(t.deps.setTermView).not.toHaveBeenCalled()
    expect(t.deps.storeRightClickMode).not.toHaveBeenCalled()
    expect(text).toContain('Zoom: 120%.')
  })

  it('clamps zoom and scrollback and says so in the answer', () => {
    const t = setup()
    const text = applyTerminalPrefs({ kind: 'terminalPrefs', scrollbackLines: 500_000, zoomPercent: 20 }, t.deps)
    expect(t.view()).toEqual({ scrollbackLines: SCROLLBACK_MAX, zoomPercent: ZOOM_MIN })
    expect(text).toContain(`Scrollback 500000 lines is outside ${SCROLLBACK_MIN}-${SCROLLBACK_MAX}; set to ${SCROLLBACK_MAX} lines.`)
    expect(text).toContain(`Zoom 20% is outside ${ZOOM_MIN}-${ZOOM_MAX}%; set to ${ZOOM_MIN}%.`)
    expect(text).toContain(`Scrollback: ${SCROLLBACK_MAX} lines`)

    const up = setup()
    const upText = applyTerminalPrefs({ kind: 'terminalPrefs', zoomPercent: 500, scrollbackLines: 10 }, up.deps)
    expect(up.view()).toEqual({ scrollbackLines: SCROLLBACK_MIN, zoomPercent: ZOOM_MAX })
    expect(upText).toContain(`Zoom 500% is outside ${ZOOM_MIN}-${ZOOM_MAX}%; set to ${ZOOM_MAX}%.`)
    expect(upText).toContain(`Scrollback 10 lines is outside ${SCROLLBACK_MIN}-${SCROLLBACK_MAX}; set to ${SCROLLBACK_MIN} lines.`)
  })

  it('rounds a fractional value and says so', () => {
    const t = setup()
    const text = applyTerminalPrefs({ kind: 'terminalPrefs', zoomPercent: 130.6, scrollbackLines: 5_000.4 }, t.deps)
    expect(t.view()).toEqual({ zoomPercent: 131, scrollbackLines: 5_000 })
    expect(text).toContain('Zoom 130.6% was rounded to 131%.')
    expect(text).toContain('Scrollback 5000.4 was rounded to 5000 lines.')
  })

  it('refuses unknown values and non-numbers, changing nothing', () => {
    const t = setup()
    expect(() => applyTerminalPrefs({ kind: 'terminalPrefs', renderer: 'vulkan' } as never, t.deps)).toThrow('Unknown terminal renderer "vulkan"')
    expect(() => applyTerminalPrefs({ kind: 'terminalPrefs', effects: 'off' } as never, t.deps)).toThrow('Unknown visual effects setting "off"')
    expect(() => applyTerminalPrefs({ kind: 'terminalPrefs', rightClick: 'nothing' } as never, t.deps)).toThrow('Unknown right-click mode "nothing"')
    expect(() => applyTerminalPrefs({ kind: 'terminalPrefs', zoomPercent: Number.NaN }, t.deps)).toThrow('"zoomPercent" must be a number')
    expect(() => applyTerminalPrefs({ kind: 'terminalPrefs', scrollbackLines: Number.POSITIVE_INFINITY }, t.deps)).toThrow('"scrollbackLines" must be a number')
    expect(() => applyTerminalPrefs({ kind: 'terminalPrefs', zoomPercent: '110' } as never, t.deps)).toThrow('"zoomPercent" must be a number')
    // One wrong value must not leave the rest of the action half applied.
    expect(() => applyTerminalPrefs({ kind: 'terminalPrefs', renderer: 'dom', rightClick: 'copy-paste', zoomPercent: Number.NaN }, t.deps)).toThrow('"zoomPercent" must be a number')
    expect(t.deps.setRendererPref).not.toHaveBeenCalled()
    expect(t.deps.setEffectsPref).not.toHaveBeenCalled()
    expect(t.deps.setTermView).not.toHaveBeenCalled()
    expect(t.deps.storeRightClickMode).not.toHaveBeenCalled()
  })

  it('describes a stored state in words', () => {
    expect(describeTerminalPrefs({ renderer: 'auto', effects: 'auto', scrollbackLines: 1_000, zoomPercent: 90, rightClick: 'menu' })).toBe(
      [
        'Terminal renderer: auto (auto = WebGL with a GPU, DOM without).',
        'Visual effects: auto.',
        'Scrollback: 1000 lines (applies to terminals opened from now on).',
        'Zoom: 90%.',
        'Right-click: menu.'
      ].join('\n')
    )
    expect(describeTerminalPrefs({ renderer: 'canvas', effects: 'full', scrollbackLines: 10_000, zoomPercent: 100, rightClick: 'paste' }, ['note'])).toContain('\nnote')
  })
})
