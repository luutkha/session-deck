import { describe, it, expect } from 'vitest'
import { RingBuffer } from './RingBuffer'

describe('RingBuffer', () => {
  it('assigns increasing sequence numbers starting at 1', () => {
    const buffer = new RingBuffer()
    expect(buffer.append('a')).toBe(1)
    expect(buffer.append('b')).toBe(2)
    expect(buffer.append('c')).toBe(3)
  })

  it('returns empty data and seq 0 when no chunks exist', () => {
    const buffer = new RingBuffer()
    expect(buffer.snapshot()).toEqual({ data: '', seq: 0 })
  })

  it('concatenates chunks in append order and reports the last seq', () => {
    const buffer = new RingBuffer()
    buffer.append('hello')
    buffer.append(' world')
    expect(buffer.snapshot()).toEqual({ data: 'hello world', seq: 2 })
  })

  it('drops oldest whole chunks once over the limit', () => {
    const buffer = new RingBuffer(5)
    buffer.append('aaa')
    buffer.append('bbb')
    expect(buffer.snapshot()).toEqual({ data: 'bbb', seq: 2 })
    buffer.append('c')
    expect(buffer.snapshot()).toEqual({ data: 'bbbc', seq: 3 })
  })

  it('never splits a chunk while trimming', () => {
    const buffer = new RingBuffer(3)
    buffer.append('ab')
    buffer.append('cde')
    expect(buffer.snapshot()).toEqual({ data: 'cde', seq: 2 })
  })

  it('keeps the newest chunk even when it alone exceeds the limit', () => {
    const buffer = new RingBuffer(2)
    buffer.append('abcdef')
    expect(buffer.snapshot()).toEqual({ data: 'abcdef', seq: 1 })
  })

  it('clear empties data but keeps the sequence monotonic', () => {
    const buffer = new RingBuffer()
    buffer.append('a')
    buffer.append('b')
    buffer.clear()
    expect(buffer.snapshot()).toEqual({ data: '', seq: 0 })
    expect(buffer.append('c')).toBe(3)
  })
})
