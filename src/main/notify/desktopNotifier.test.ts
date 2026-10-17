import { describe, it, expect, beforeEach } from 'vitest'
import type { TraySettings } from '../../shared/types'
import {
  createDesktopNotifier,
  DEDUPE_WINDOW_MS,
  type DesktopNotifierDeps,
  type NotificationOptions
} from './desktopNotifier'

class FakeNotification {
  static created: FakeNotification[] = []
  readonly options: NotificationOptions
  shown = 0
  private readonly handlers = new Map<string, Array<() => void>>()

  constructor(options: NotificationOptions) {
    this.options = options
    FakeNotification.created.push(this)
  }

  on(event: 'click' | 'close', listener: () => void): this {
    const list = this.handlers.get(event) ?? []
    this.handlers.set(event, [...list, listener])
    return this
  }

  show(): void {
    this.shown += 1
  }

  emit(event: 'click' | 'close'): void {
    for (const listener of this.handlers.get(event) ?? []) listener()
  }
}

const ALL_ON: TraySettings = { closeToTray: true, desktopNotifications: true, notifyOnlyWhenUnfocused: true }

interface Harness {
  readonly deps: DesktopNotifierDeps
  readonly clicks: string[]
  readonly appClicks: { count: number }
  readonly errors: string[]
  readonly setNow: (ms: number) => void
  readonly setFocused: (value: boolean) => void
  readonly setSettings: (value: TraySettings) => void
  readonly setSupported: (value: boolean) => void
  readonly setCtorFailure: (value: boolean) => void
}

function harness(): Harness {
  FakeNotification.created = []
  const clicks: string[] = []
  const appClicks = { count: 0 }
  const errors: string[] = []
  let now = 1_000_000
  let focused = false
  let settings: TraySettings = ALL_ON
  let supported = true
  let ctorFails = false

  const NotificationCtor = class extends FakeNotification {
    constructor(options: NotificationOptions) {
      if (ctorFails) throw new Error('ctor failed')
      super(options)
    }
  }

  const deps: DesktopNotifierDeps = {
    NotificationCtor,
    isSupported: () => supported,
    getSettings: () => settings,
    isWindowFocused: () => focused,
    onClickSession: (id) => clicks.push(id),
    onClickApp: () => {
      appClicks.count += 1
    },
    iconPath: '/icons/icon.png',
    now: () => now,
    onError: (where) => errors.push(where)
  }

  return {
    deps,
    clicks,
    appClicks,
    errors,
    setNow: (ms) => {
      now = ms
    },
    setFocused: (value) => {
      focused = value
    },
    setSettings: (value) => {
      settings = value
    },
    setSupported: (value) => {
      supported = value
    },
    setCtorFailure: (value) => {
      ctorFails = value
    }
  }
}

describe('createDesktopNotifier', () => {
  beforeEach(() => {
    FakeNotification.created = []
  })

  it('shows a session notification with the name as title and the text as body', () => {
    const h = harness()
    const notifier = createDesktopNotifier(h.deps)
    expect(notifier.notifySession('s1', 'Api work', 'Needs your permission')).toBe(true)
    expect(FakeNotification.created).toHaveLength(1)
    expect(FakeNotification.created[0]?.options).toEqual({
      title: 'Api work',
      body: 'Needs your permission',
      icon: '/icons/icon.png'
    })
    expect(FakeNotification.created[0]?.shown).toBe(1)
  })

  it('omits the icon when none is configured', () => {
    const h = harness()
    const notifier = createDesktopNotifier({ ...h.deps, iconPath: undefined })
    notifier.notifySession('s1', 'A', 'B')
    expect(FakeNotification.created[0]?.options.icon).toBeUndefined()
  })

  it('does nothing when the platform does not support notifications', () => {
    const h = harness()
    h.setSupported(false)
    const notifier = createDesktopNotifier(h.deps)
    expect(notifier.notifySession('s1', 'A', 'B')).toBe(false)
    expect(notifier.notifyApp('T', 'B')).toBe(false)
    expect(FakeNotification.created).toHaveLength(0)
  })

  it('does nothing when desktopNotifications is off', () => {
    const h = harness()
    h.setSettings({ ...ALL_ON, desktopNotifications: false })
    const notifier = createDesktopNotifier(h.deps)
    expect(notifier.notifySession('s1', 'A', 'B')).toBe(false)
    expect(notifier.notifyApp('T', 'B')).toBe(false)
    expect(FakeNotification.created).toHaveLength(0)
  })

  it('does nothing while the window is focused when notifyOnlyWhenUnfocused is on', () => {
    const h = harness()
    h.setFocused(true)
    const notifier = createDesktopNotifier(h.deps)
    expect(notifier.notifySession('s1', 'A', 'B')).toBe(false)
    expect(FakeNotification.created).toHaveLength(0)
  })

  it('still notifies while focused when notifyOnlyWhenUnfocused is off', () => {
    const h = harness()
    h.setFocused(true)
    h.setSettings({ ...ALL_ON, notifyOnlyWhenUnfocused: false })
    const notifier = createDesktopNotifier(h.deps)
    expect(notifier.notifySession('s1', 'A', 'B')).toBe(true)
  })

  it('calls onClickSession with the session id when the notification is clicked', () => {
    const h = harness()
    const notifier = createDesktopNotifier(h.deps)
    notifier.notifySession('s42', 'A', 'B')
    FakeNotification.created[0]?.emit('click')
    expect(h.clicks).toEqual(['s42'])
  })

  it('calls onClickApp when an app notification is clicked', () => {
    const h = harness()
    const notifier = createDesktopNotifier(h.deps)
    notifier.notifyApp('Claude usage 82%', 'body')
    FakeNotification.created[0]?.emit('click')
    expect(h.appClicks.count).toBe(1)
    expect(h.clicks).toEqual([])
  })

  it('drops the same session and title within the dedupe window', () => {
    const h = harness()
    const notifier = createDesktopNotifier(h.deps)
    expect(notifier.notifySession('s1', 'Api', 'Needs your permission')).toBe(true)
    h.setNow(1_000_000 + DEDUPE_WINDOW_MS - 1)
    expect(notifier.notifySession('s1', 'Api', 'Needs your permission')).toBe(false)
    expect(FakeNotification.created).toHaveLength(1)
  })

  it('shows again after the dedupe window has passed', () => {
    const h = harness()
    const notifier = createDesktopNotifier(h.deps)
    notifier.notifySession('s1', 'Api', 'B')
    h.setNow(1_000_000 + DEDUPE_WINDOW_MS)
    expect(notifier.notifySession('s1', 'Api', 'B')).toBe(true)
    expect(FakeNotification.created).toHaveLength(2)
  })

  it('does not dedupe different titles or different sessions', () => {
    const h = harness()
    const notifier = createDesktopNotifier(h.deps)
    expect(notifier.notifySession('s1', 'Api', 'B')).toBe(true)
    expect(notifier.notifySession('s1', 'Other', 'B')).toBe(true)
    expect(notifier.notifySession('s2', 'Api', 'B')).toBe(true)
    expect(FakeNotification.created).toHaveLength(3)
  })

  it('does not record a dedupe entry for a notification that was suppressed', () => {
    const h = harness()
    h.setFocused(true)
    const notifier = createDesktopNotifier(h.deps)
    notifier.notifySession('s1', 'Api', 'B')
    h.setFocused(false)
    expect(notifier.notifySession('s1', 'Api', 'B')).toBe(true)
  })

  it('keeps live notifications referenced until they close', () => {
    const h = harness()
    const notifier = createDesktopNotifier(h.deps)
    notifier.notifySession('s1', 'A', 'B')
    notifier.notifySession('s2', 'C', 'D')
    expect(notifier.liveCount()).toBe(2)
    FakeNotification.created[0]?.emit('close')
    expect(notifier.liveCount()).toBe(1)
    FakeNotification.created[1]?.emit('close')
    expect(notifier.liveCount()).toBe(0)
  })

  it('reports a constructor failure and returns false', () => {
    const h = harness()
    h.setCtorFailure(true)
    const notifier = createDesktopNotifier(h.deps)
    expect(notifier.notifySession('s1', 'A', 'B')).toBe(false)
    expect(h.errors).toEqual(['desktop notification'])
    expect(notifier.liveCount()).toBe(0)
  })
})
