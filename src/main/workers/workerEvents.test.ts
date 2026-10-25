import { describe, expect, it } from 'vitest'
import { MAX_EVENT_TEXT, parseWorkerEvent } from './workerEvents'

const OC = 'ses_abcdefgh12345678'
const base = { v: 1, proc: 'p', oc: OC }

describe('parseWorkerEvent', () => {
  it('accepts each kind', () => {
    expect(parseWorkerEvent({ v: 1, proc: 'p', kind: 'hello' })).toEqual({ kind: 'hello', proc: 'p' })
    expect(parseWorkerEvent({ v: 1, proc: 'p', kind: 'beat' })).toEqual({ kind: 'beat', proc: 'p' })
    expect(parseWorkerEvent({ ...base, kind: 'start', dir: 'd', title: 't' })).toMatchObject({ kind: 'start', dir: 'd', title: 't' })
    expect(parseWorkerEvent({ ...base, kind: 'tool', partId: 'x', tool: 'bash', state: 'done', text: 'ls' })).toMatchObject({ state: 'done' })
    expect(parseWorkerEvent({ ...base, kind: 'step', partId: 'x', cost: 0.5, tokens: 10 })).toMatchObject({ cost: 0.5, tokens: 10 })
    expect(parseWorkerEvent({ ...base, kind: 'idle' })).toEqual({ kind: 'idle', proc: 'p', oc: OC })
  })

  it('accepts hello with a valid proc and rejects it without or with an invalid one', () => {
    // A child: the normal non-empty short proc parses (see accepts each kind).
    expect(parseWorkerEvent({ v: 1, proc: '12345', kind: 'hello' })).toEqual({ kind: 'hello', proc: '12345' })
    expect(parseWorkerEvent({ v: 1, kind: 'hello' })).toBeNull()
    expect(parseWorkerEvent({ v: 1, proc: '', kind: 'hello' })).toBeNull()
    expect(parseWorkerEvent({ v: 1, proc: 42, kind: 'hello' })).toBeNull()
  })

  it('rejects wrong versions, bad ids, unknown kinds and bad shapes', () => {
    expect(parseWorkerEvent(null)).toBeNull()
    expect(parseWorkerEvent([])).toBeNull()
    expect(parseWorkerEvent({ ...base, v: 2, kind: 'idle' })).toBeNull()
    expect(parseWorkerEvent({ ...base, oc: 'nope', kind: 'idle' })).toBeNull()
    expect(parseWorkerEvent({ ...base, kind: 'explode' })).toBeNull()
    expect(parseWorkerEvent({ ...base, kind: 'tool', partId: 'x', tool: 'bash', state: 'weird', text: '' })).toBeNull()
    expect(parseWorkerEvent({ ...base, kind: 'text', text: 'no part id' })).toBeNull()
    expect(parseWorkerEvent({ kind: 'beat', v: 1 })).toBeNull()
  })

  it('caps text and clamps bad numbers', () => {
    const long = parseWorkerEvent({ ...base, kind: 'text', partId: 'x', text: 'a'.repeat(MAX_EVENT_TEXT * 3) })
    expect(long && 'text' in long ? long.text.length : 0).toBe(MAX_EVENT_TEXT)
    expect(parseWorkerEvent({ ...base, kind: 'step', partId: 'x', cost: -5, tokens: 'many' })).toMatchObject({ cost: 0, tokens: 0 })
  })
})
