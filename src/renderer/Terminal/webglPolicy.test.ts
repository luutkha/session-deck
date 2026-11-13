import { describe, expect, it } from 'vitest'
import { MAX_WEBGL_PANES, planRenderers, type RendererPaneState } from './webglPolicy'
import type { RendererKind } from './terminalRenderer'

const pane = (
  id: string,
  visible: boolean,
  kind: RendererKind | null,
  failed?: boolean
): RendererPaneState => ({ id, visible, kind, failed })

describe('planRenderers: WebGL (performance step 2)', () => {
  it('detaches every hidden pane that still holds WebGL', () => {
    const plan = planRenderers(
      [pane('a', false, 'webgl'), pane('b', false, 'webgl'), pane('c', true, 'webgl')],
      'webgl'
    )
    expect(plan.detach).toEqual(['a', 'b'])
    expect(plan.attach).toEqual([])
  })

  it('attaches visible panes that have no addon, in the given order', () => {
    const plan = planRenderers([pane('a', true, null), pane('b', true, null), pane('c', true, null)], 'webgl')
    expect(plan.attach).toEqual([
      { id: 'a', kind: 'webgl' },
      { id: 'b', kind: 'webgl' },
      { id: 'c', kind: 'webgl' }
    ])
    expect(plan.detach).toEqual([])
  })

  it('does not touch a hidden pane without an addon', () => {
    expect(planRenderers([pane('a', false, null)], 'webgl')).toEqual({ attach: [], detach: [] })
  })

  it('keeps visible panes that already hold WebGL', () => {
    const plan = planRenderers([pane('a', true, 'webgl'), pane('b', true, null)], 'webgl')
    expect(plan.detach).toEqual([])
    expect(plan.attach).toEqual([{ id: 'b', kind: 'webgl' }])
  })

  it('respects the cap: kept visible contexts count, extra visible panes stay DOM', () => {
    const plan = planRenderers(
      [pane('a', true, 'webgl'), pane('b', true, 'webgl'), pane('c', true, null), pane('d', true, null)],
      'webgl',
      3
    )
    expect(plan.detach).toEqual([])
    expect(plan.attach).toEqual([{ id: 'c', kind: 'webgl' }])
  })

  it('never detaches a visible pane just because of the cap', () => {
    const plan = planRenderers(
      [pane('a', true, 'webgl'), pane('b', true, 'webgl'), pane('c', true, 'webgl')],
      'webgl',
      1
    )
    expect(plan.detach).toEqual([])
    expect(plan.attach).toEqual([])
  })

  it('defaults the cap to MAX_WEBGL_PANES', () => {
    const panes: RendererPaneState[] = []
    for (let index = 0; index < MAX_WEBGL_PANES + 4; index += 1) {
      panes.push(pane(`p${String(index)}`, true, null))
    }
    const plan = planRenderers(panes, 'webgl')
    expect(MAX_WEBGL_PANES).toBe(8)
    expect(plan.attach).toHaveLength(MAX_WEBGL_PANES)
    expect(plan.attach[0]).toEqual({ id: 'p0', kind: 'webgl' })
    expect(plan.attach[MAX_WEBGL_PANES - 1]).toEqual({ id: `p${String(MAX_WEBGL_PANES - 1)}`, kind: 'webgl' })
  })

  it('skips a pane whose attach already failed', () => {
    const plan = planRenderers([pane('a', true, null, true), pane('b', true, null)], 'webgl')
    expect(plan.attach).toEqual([{ id: 'b', kind: 'webgl' }])
    expect(plan.detach).toEqual([])
  })

  it('keeps the order stable across mixed input', () => {
    const plan = planRenderers(
      [
        pane('hidden-webgl', false, 'webgl'),
        pane('visible-webgl', true, 'webgl'),
        pane('visible-plain', true, null),
        pane('hidden-plain', false, null),
        pane('visible-plain-2', true, null),
        pane('visible-failed', true, null, true)
      ],
      'webgl'
    )
    expect(plan.detach).toEqual(['hidden-webgl'])
    expect(plan.attach).toEqual([
      { id: 'visible-plain', kind: 'webgl' },
      { id: 'visible-plain-2', kind: 'webgl' }
    ])
  })

  it('returns empty lists for empty input', () => {
    expect(planRenderers([], 'webgl')).toEqual({ attach: [], detach: [] })
  })
})

describe('planRenderers: Canvas (no-GPU support)', () => {
  it('attaches every visible pane with no cap', () => {
    const panes: RendererPaneState[] = []
    for (let index = 0; index < MAX_WEBGL_PANES + 12; index += 1) {
      panes.push(pane(`p${String(index)}`, true, null))
    }
    const plan = planRenderers(panes, 'canvas')
    expect(plan.attach).toHaveLength(panes.length)
    expect(plan.attach[0]).toEqual({ id: 'p0', kind: 'canvas' })
  })

  it('detaches hidden panes and never attaches them', () => {
    const plan = planRenderers([pane('a', false, 'canvas'), pane('b', true, null)], 'canvas')
    expect(plan.detach).toEqual(['a'])
    expect(plan.attach).toEqual([{ id: 'b', kind: 'canvas' }])
  })

  it('keeps a visible pane that already holds Canvas', () => {
    const plan = planRenderers([pane('a', true, 'canvas'), pane('b', true, null)], 'canvas')
    expect(plan.detach).toEqual([])
    expect(plan.attach).toEqual([{ id: 'b', kind: 'canvas' }])
  })

  it('switches a visible WebGL pane: detach first, then attach Canvas', () => {
    const plan = planRenderers([pane('a', true, 'webgl'), pane('b', true, 'canvas')], 'canvas')
    expect(plan.detach).toEqual(['a'])
    expect(plan.attach).toEqual([{ id: 'a', kind: 'canvas' }])
  })

  it('skips a pane whose Canvas attach already failed', () => {
    const plan = planRenderers([pane('a', true, null, true), pane('b', true, null)], 'canvas')
    expect(plan.attach).toEqual([{ id: 'b', kind: 'canvas' }])
  })
})

describe('planRenderers: DOM (no GPU addon)', () => {
  it('detaches every addon, hidden or visible', () => {
    const plan = planRenderers(
      [pane('a', false, 'webgl'), pane('b', true, 'canvas'), pane('c', true, null)],
      'dom'
    )
    expect(plan.detach).toEqual(['a', 'b'])
    expect(plan.attach).toEqual([])
  })

  it('is a no-op when no pane holds an addon', () => {
    expect(planRenderers([pane('a', true, null)], 'dom')).toEqual({ attach: [], detach: [] })
  })
})

describe('planRenderers: switching kinds', () => {
  it('moves live panes from Canvas to WebGL up to the cap', () => {
    const plan = planRenderers(
      [pane('a', true, 'canvas'), pane('b', true, 'canvas'), pane('c', true, null)],
      'webgl',
      2
    )
    expect(plan.detach).toEqual(['a', 'b'])
    expect(plan.attach).toEqual([
      { id: 'a', kind: 'webgl' },
      { id: 'b', kind: 'webgl' }
    ])
  })

  it('leaves a Canvas pane alone when the WebGL cap is already taken', () => {
    const plan = planRenderers([pane('a', true, 'webgl'), pane('b', true, 'canvas')], 'webgl', 1)
    expect(plan.detach).toEqual([])
    expect(plan.attach).toEqual([])
  })

  it('detaches hidden panes of the other kind too', () => {
    const plan = planRenderers([pane('a', false, 'canvas')], 'webgl')
    expect(plan.detach).toEqual(['a'])
    expect(plan.attach).toEqual([])
  })
})
