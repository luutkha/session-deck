import { describe, expect, it } from 'vitest'
import { MAX_WEBGL_PANES, planWebgl, type WebglPaneState } from './webglPolicy'

const pane = (
  id: string,
  visible: boolean,
  hasWebgl: boolean,
  failed?: boolean
): WebglPaneState => ({ id, visible, hasWebgl, failed })

describe('planWebgl (performance step 2)', () => {
  it('detaches every hidden pane that still has WebGL', () => {
    const plan = planWebgl([pane('a', false, true), pane('b', false, true), pane('c', true, true)])
    expect(plan.detach).toEqual(['a', 'b'])
    expect(plan.attach).toEqual([])
  })

  it('attaches visible panes that have no WebGL, in the given order', () => {
    const plan = planWebgl([pane('a', true, false), pane('b', true, false), pane('c', true, false)])
    expect(plan.attach).toEqual(['a', 'b', 'c'])
    expect(plan.detach).toEqual([])
  })

  it('does not touch a hidden pane without WebGL', () => {
    expect(planWebgl([pane('a', false, false)])).toEqual({ attach: [], detach: [] })
  })

  it('keeps visible panes that already have WebGL', () => {
    const plan = planWebgl([pane('a', true, true), pane('b', true, false)])
    expect(plan.detach).toEqual([])
    expect(plan.attach).toEqual(['b'])
  })

  it('respects the cap: kept visible contexts count, extra visible panes stay DOM', () => {
    const plan = planWebgl(
      [pane('a', true, true), pane('b', true, true), pane('c', true, false), pane('d', true, false)],
      3
    )
    expect(plan.detach).toEqual([])
    expect(plan.attach).toEqual(['c'])
  })

  it('never detaches a visible pane just because of the cap', () => {
    const panes = [pane('a', true, true), pane('b', true, true), pane('c', true, true)]
    const plan = planWebgl(panes, 1)
    expect(plan.detach).toEqual([])
    expect(plan.attach).toEqual([])
  })

  it('defaults the cap to MAX_WEBGL_PANES', () => {
    const panes: WebglPaneState[] = []
    for (let index = 0; index < MAX_WEBGL_PANES + 4; index += 1) {
      panes.push(pane(`p${String(index)}`, true, false))
    }
    const plan = planWebgl(panes)
    expect(MAX_WEBGL_PANES).toBe(8)
    expect(plan.attach).toHaveLength(MAX_WEBGL_PANES)
    expect(plan.attach[0]).toBe('p0')
    expect(plan.attach[MAX_WEBGL_PANES - 1]).toBe(`p${String(MAX_WEBGL_PANES - 1)}`)
  })

  it('skips a pane whose attach already failed', () => {
    const plan = planWebgl([pane('a', true, false, true), pane('b', true, false)])
    expect(plan.attach).toEqual(['b'])
    expect(plan.detach).toEqual([])
  })

  it('keeps the order stable across mixed input', () => {
    const plan = planWebgl([
      pane('hidden-webgl', false, true),
      pane('visible-webgl', true, true),
      pane('visible-plain', true, false),
      pane('hidden-plain', false, false),
      pane('visible-plain-2', true, false),
      pane('visible-failed', true, false, true)
    ])
    expect(plan.detach).toEqual(['hidden-webgl'])
    expect(plan.attach).toEqual(['visible-plain', 'visible-plain-2'])
  })

  it('returns empty lists for empty input', () => {
    expect(planWebgl([])).toEqual({ attach: [], detach: [] })
  })
})
