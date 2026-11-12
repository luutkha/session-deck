import { describe, expect, it } from 'vitest'
import { HiddenQueue } from './hiddenQueue'

describe('HiddenQueue (performance step 2b)', () => {
  it('keeps the arrival order and reports the queued size', () => {
    const queue = new HiddenQueue()
    queue.push('one ')
    queue.push('two ')
    queue.push('three')
    expect(queue.size).toBe('one two three'.length)
    expect(queue.take()).toEqual({ chunks: ['one ', 'two ', 'three'], overflowed: false })
  })

  it('resets to empty after take', () => {
    const queue = new HiddenQueue()
    queue.push('abc')
    queue.take()
    expect(queue.size).toBe(0)
    queue.push('de')
    expect(queue.take()).toEqual({ chunks: ['de'], overflowed: false })
  })

  it('discards everything on overflow and ignores later pushes', () => {
    const queue = new HiddenQueue(4)
    queue.push('ab')
    queue.push('cde')
    expect(queue.size).toBe(0)
    queue.push('fgh')
    queue.push('i')
    expect(queue.size).toBe(0)
    expect(queue.take()).toEqual({ chunks: [], overflowed: true })
  })

  it('resets the overflow flag after take', () => {
    const queue = new HiddenQueue(2)
    queue.push('abc')
    expect(queue.take().overflowed).toBe(true)
    queue.push('de')
    expect(queue.take()).toEqual({ chunks: ['de'], overflowed: false })
  })

  it('returns an empty result when nothing was queued', () => {
    const queue = new HiddenQueue()
    expect(queue.take()).toEqual({ chunks: [], overflowed: false })
    expect(queue.size).toBe(0)
  })

  it('accepts output up to exactly the limit and drops the next chunk', () => {
    const queue = new HiddenQueue(5)
    queue.push('abc')
    queue.push('de')
    expect(queue.size).toBe(5)
    expect(queue.take()).toEqual({ chunks: ['abc', 'de'], overflowed: false })

    queue.push('abc')
    queue.push('def')
    expect(queue.size).toBe(0)
    expect(queue.take()).toEqual({ chunks: [], overflowed: true })
  })

  it('ignores empty chunks', () => {
    const queue = new HiddenQueue(2)
    queue.push('')
    expect(queue.size).toBe(0)
    expect(queue.take()).toEqual({ chunks: [], overflowed: false })
  })
})
