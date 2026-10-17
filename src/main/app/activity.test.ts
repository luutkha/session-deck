import { describe, it, expect } from 'vitest'
import type { HookEvent } from '../../shared/types'
import { NO_ACTIVITY, activityFromHook, type ActivitySnapshot } from './activity'

const working: ActivitySnapshot = { activity: 'working', message: null }
const waiting: ActivitySnapshot = { activity: 'needs-input', message: 'Allow write?' }

describe('activityFromHook', () => {
  it('UserPromptSubmit -> working and clears the message', () => {
    const event: HookEvent = { sessionId: 's', event: 'UserPromptSubmit' }
    expect(activityFromHook(event, waiting)).toEqual({ activity: 'working', message: null })
    expect(activityFromHook(event, NO_ACTIVITY)).toEqual({ activity: 'working', message: null })
  })

  it('Notification -> needs-input with the hook message', () => {
    const event: HookEvent = { sessionId: 's', event: 'Notification', message: 'Run npm test?' }
    expect(activityFromHook(event, working)).toEqual({ activity: 'needs-input', message: 'Run npm test?' })
  })

  it('Notification without a message -> needs-input with a null message', () => {
    const event: HookEvent = { sessionId: 's', event: 'Notification' }
    expect(activityFromHook(event, working)).toEqual({ activity: 'needs-input', message: null })
  })

  it('Stop -> finished and clears the message', () => {
    const event: HookEvent = { sessionId: 's', event: 'Stop' }
    expect(activityFromHook(event, waiting)).toEqual({ activity: 'finished', message: null })
  })

  it('does not depend on the previous snapshot for the three known events', () => {
    const event: HookEvent = { sessionId: 's', event: 'Stop' }
    expect(activityFromHook(event, NO_ACTIVITY)).toEqual(activityFromHook(event, working))
  })

  it('an unknown event name keeps the previous snapshot', () => {
    const event = { sessionId: 's', event: 'PreToolUse' } as unknown as HookEvent
    expect(activityFromHook(event, waiting)).toBe(waiting)
  })
})
