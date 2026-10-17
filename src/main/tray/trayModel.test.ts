import { describe, it, expect } from 'vitest'
import { buildTrayModel, MAX_TRAY_ATTENTION_ITEMS, type TraySessionInput } from './trayModel'

function session(id: string, attention: TraySessionInput['attention'] = null, name = `Session ${id}`): TraySessionInput {
  return { id, name, attention, run: 'running' }
}

describe('buildTrayModel', () => {
  it('shows the plain tooltip and no attention when nothing needs attention', () => {
    const model = buildTrayModel({ sessions: [session('a'), session('b')], windowVisible: true })
    expect(model.tooltip).toBe('SessionDeck')
    expect(model.hasAttention).toBe(false)
  })

  it('has the show action, the attention header and the quit action in that order', () => {
    const model = buildTrayModel({ sessions: [], windowVisible: false })
    expect(model.items).toEqual([
      { kind: 'action', id: 'show', label: 'Show SessionDeck' },
      { kind: 'separator' },
      { kind: 'header', label: 'Needs attention' },
      { kind: 'separator' },
      { kind: 'action', id: 'quit', label: 'Quit SessionDeck' }
    ])
  })

  it('lists a permission session with a permission suffix', () => {
    const model = buildTrayModel({ sessions: [session('a', 'permission', 'Api')], windowVisible: true })
    expect(model.hasAttention).toBe(true)
    expect(model.items).toContainEqual({ kind: 'session', sessionId: 'a', label: 'Api - permission' })
  })

  it('lists a done session with a finished suffix', () => {
    const model = buildTrayModel({ sessions: [session('a', 'done', 'Web')], windowVisible: true })
    expect(model.items).toContainEqual({ kind: 'session', sessionId: 'a', label: 'Web - finished' })
  })

  it('places attention sessions between the header and the separator before quit', () => {
    const model = buildTrayModel({
      sessions: [session('a', 'done', 'One'), session('b', null, 'Quiet'), session('c', 'permission', 'Two')],
      windowVisible: true
    })
    expect(model.items).toEqual([
      { kind: 'action', id: 'show', label: 'Show SessionDeck' },
      { kind: 'separator' },
      { kind: 'header', label: 'Needs attention' },
      { kind: 'session', sessionId: 'a', label: 'One - finished' },
      { kind: 'session', sessionId: 'c', label: 'Two - permission' },
      { kind: 'separator' },
      { kind: 'action', id: 'quit', label: 'Quit SessionDeck' }
    ])
  })

  it('shows the count in the tooltip', () => {
    const model = buildTrayModel({
      sessions: [session('a', 'done'), session('b', 'permission'), session('c')],
      windowVisible: true
    })
    expect(model.tooltip).toBe('SessionDeck - 2 need attention')
  })

  it('caps the listed sessions at the maximum but keeps the full count in the tooltip', () => {
    const many = Array.from({ length: MAX_TRAY_ATTENTION_ITEMS + 3 }, (_, i) => session(`s${i}`, 'done', `N${i}`))
    const model = buildTrayModel({ sessions: many, windowVisible: true })
    const listed = model.items.filter((item) => item.kind === 'session')
    expect(listed).toHaveLength(MAX_TRAY_ATTENTION_ITEMS)
    expect(model.tooltip).toBe(`SessionDeck - ${MAX_TRAY_ATTENTION_ITEMS + 3} need attention`)
  })

  it('uses the singular-safe wording for one session', () => {
    const model = buildTrayModel({ sessions: [session('a', 'done')], windowVisible: true })
    expect(model.tooltip).toBe('SessionDeck - 1 need attention')
  })

  it('labels idle and bell reasons too', () => {
    const model = buildTrayModel({
      sessions: [session('a', 'idle', 'I'), session('b', 'bell', 'B')],
      windowVisible: true
    })
    expect(model.items).toContainEqual({ kind: 'session', sessionId: 'a', label: 'I - idle' })
    expect(model.items).toContainEqual({ kind: 'session', sessionId: 'b', label: 'B - bell' })
  })

  it('does not change with the window visibility', () => {
    const sessions = [session('a', 'done')]
    expect(buildTrayModel({ sessions, windowVisible: true })).toEqual(buildTrayModel({ sessions, windowVisible: false }))
  })

  it('returns a fresh, readonly-shaped result each call', () => {
    const sessions = [session('a', 'done')]
    const first = buildTrayModel({ sessions, windowVisible: true })
    const second = buildTrayModel({ sessions, windowVisible: true })
    expect(first).toEqual(second)
    expect(first.items).not.toBe(second.items)
  })
})
