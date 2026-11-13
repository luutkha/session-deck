import { describe, expect, it, vi } from 'vitest'
import { applyJarvisPrefs, describeJarvisPrefs, type JarvisPanelWidthLimits, type JarvisPrefsDeps } from './jarvisPrefsUi'

const LIMITS: JarvisPanelWidthLimits = { min: 340, max: 1_200, defaultWidth: 520 }

function setup(speak0 = false, width0 = 520, limits: JarvisPanelWidthLimits = LIMITS) {
  let speak = speak0
  let width = width0
  const deps: JarvisPrefsDeps = {
    getSpeak: () => speak,
    setSpeak: vi.fn((on: boolean) => {
      speak = on
    }),
    getPanelWidth: () => width,
    setPanelWidth: vi.fn((next: number) => {
      width = next
    }),
    widthLimits: () => limits
  }
  return { deps, speak: () => speak, width: () => width }
}

describe('Jarvis panel preferences (D54)', () => {
  it('changes both settings and answers with every current value', () => {
    const t = setup()
    const text = applyJarvisPrefs({ kind: 'jarvisPrefs', speak: true, panelWidth: 400 }, t.deps)
    expect(t.speak()).toBe(true)
    expect(t.width()).toBe(400)
    expect(t.deps.setSpeak).toHaveBeenCalledTimes(1)
    expect(t.deps.setPanelWidth).toHaveBeenCalledTimes(1)
    expect(text).toBe(
      ['Jarvis reads its replies aloud: on.', 'Jarvis panel width: 400px (limits 340-1200px).'].join('\n')
    )
  })

  it('changes only the fields it is given, and only reports when nothing is', () => {
    const t = setup(true, 900)
    const text = applyJarvisPrefs({ kind: 'jarvisPrefs', speak: false }, t.deps)
    expect(t.speak()).toBe(false)
    expect(t.width()).toBe(900)
    expect(t.deps.setPanelWidth).not.toHaveBeenCalled()
    expect(text).toContain('Jarvis reads its replies aloud: off.')
    expect(text).toContain('Jarvis panel width: 900px')

    const report = setup(true, 480)
    const reported = applyJarvisPrefs({ kind: 'jarvisPrefs', panelWidth: null }, report.deps)
    expect(reported).toBe(
      ['Jarvis reads its replies aloud: on.', 'Jarvis panel width: 480px (limits 340-1200px).'].join('\n')
    )
    expect(report.deps.setSpeak).not.toHaveBeenCalled()
    expect(report.deps.setPanelWidth).not.toHaveBeenCalled()
  })

  it('writes nothing when the values already match', () => {
    const t = setup(true, 520)
    const text = applyJarvisPrefs({ kind: 'jarvisPrefs', speak: true, panelWidth: 520 }, t.deps)
    expect(t.deps.setSpeak).not.toHaveBeenCalled()
    expect(t.deps.setPanelWidth).not.toHaveBeenCalled()
    expect(text).toContain('Jarvis panel width: 520px, the default (limits 340-1200px).')
  })

  it('clamps a width to the panel limits and says so', () => {
    const small = setup()
    const smallText = applyJarvisPrefs({ kind: 'jarvisPrefs', panelWidth: 200 }, small.deps)
    expect(small.width()).toBe(340)
    expect(smallText).toContain('Panel width 200px is outside 340-1200px; set to 340px.')

    const big = setup()
    const bigText = applyJarvisPrefs({ kind: 'jarvisPrefs', panelWidth: 5_000 }, big.deps)
    expect(big.width()).toBe(1_200)
    expect(bigText).toContain('Panel width 5000px is outside 340-1200px; set to 1200px.')
  })

  it('rounds a fractional width and says so', () => {
    const t = setup()
    const text = applyJarvisPrefs({ kind: 'jarvisPrefs', panelWidth: 419.6 }, t.deps)
    expect(t.width()).toBe(420)
    expect(text).toContain('Panel width 419.6px was rounded to 420px.')
  })

  it('resets the width to the default, clamped when the window is narrow', () => {
    const t = setup(false, 900)
    const text = applyJarvisPrefs({ kind: 'jarvisPrefs', panelWidth: 'reset' }, t.deps)
    expect(t.width()).toBe(520)
    expect(text).toContain('Jarvis panel width: 520px, the default (limits 340-1200px).')
    expect(text).toContain('Panel width is back to the default 520px.')

    const narrow = setup(false, 900, { min: 340, max: 480, defaultWidth: 520 })
    const narrowText = applyJarvisPrefs({ kind: 'jarvisPrefs', panelWidth: 'reset' }, narrow.deps)
    expect(narrow.width()).toBe(480)
    expect(narrowText).toContain('The window is too narrow for the default 520px; set to 480px.')
  })

  it('refuses a non-boolean toggle and a width that is not a number, changing nothing', () => {
    const t = setup()
    expect(() => applyJarvisPrefs({ kind: 'jarvisPrefs', speak: 'yes' } as never, t.deps)).toThrow('The "speak" setting must be true or false.')
    expect(() => applyJarvisPrefs({ kind: 'jarvisPrefs', panelWidth: Number.NaN }, t.deps)).toThrow('The panel width must be a number of pixels.')
    expect(() => applyJarvisPrefs({ kind: 'jarvisPrefs', panelWidth: Number.POSITIVE_INFINITY }, t.deps)).toThrow('The panel width must be a number of pixels.')
    expect(() => applyJarvisPrefs({ kind: 'jarvisPrefs', panelWidth: '400' } as never, t.deps)).toThrow('The panel width must be a number of pixels.')
    // One wrong value must not leave the rest of the action half applied.
    expect(() => applyJarvisPrefs({ kind: 'jarvisPrefs', speak: true, panelWidth: Number.NaN }, t.deps)).toThrow('The panel width must be a number of pixels.')
    expect(t.speak()).toBe(false)
    expect(t.deps.setSpeak).not.toHaveBeenCalled()
    expect(t.deps.setPanelWidth).not.toHaveBeenCalled()
  })

  it('describes a state in words, with notes last', () => {
    const state = { speak: false, panelWidth: 600, limits: LIMITS }
    expect(describeJarvisPrefs(state)).toBe(
      ['Jarvis reads its replies aloud: off.', 'Jarvis panel width: 600px (limits 340-1200px).'].join('\n')
    )
    expect(describeJarvisPrefs(state, ['a note'])).toContain('\na note')
  })
})
