import { describe, expect, it, vi } from 'vitest'
import { onFileViewRequest, requestFileView } from './previewBus'

describe('previewBus', () => {
  it('returns false when nobody listens', () => {
    expect(requestFileView({ sessionId: 's', text: 'a.md' })).toBe(false)
  })

  it('delivers a request to every listener and stops after unsubscribe', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = onFileViewRequest(a)
    const offB = onFileViewRequest(b)
    expect(requestFileView({ sessionId: 's', text: 'a.md' })).toBe(true)
    expect(a).toHaveBeenCalledWith({ sessionId: 's', text: 'a.md' })
    expect(b).toHaveBeenCalledTimes(1)
    offA()
    requestFileView({ sessionId: 's', text: 'b.md' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
    offB()
    expect(requestFileView({ sessionId: 's', text: 'c.md' })).toBe(false)
  })
})
