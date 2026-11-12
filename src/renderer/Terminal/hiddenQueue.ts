// Output held back for a hidden terminal pane (performance step 2b).
//
// A hidden pane is display:none, but xterm's fallback DOM renderer still walks and
// rewrites its rows for every chunk written to it (measured: renderer busy time
// 21% -> 37% with hidden panes mounted). So the pane registry stops writing to a
// hidden pane and keeps its output here instead, bounded: past `limitChars` the
// queue is dropped and the pane rehydrates from the main-process replay buffer,
// which is the source of truth. Pure: no React, no DOM, no timers.

export interface HiddenQueueTake {
  /** Queued chunks, in arrival order; empty when the queue overflowed. */
  readonly chunks: string[]
  /** True when the limit was exceeded: the output is gone and must be replayed instead. */
  readonly overflowed: boolean
}

export class HiddenQueue {
  private readonly limitChars: number
  private chunks: string[] = []
  private chars = 0
  private overflowed = false

  constructor(limitChars = 1_000_000) {
    if (!Number.isInteger(limitChars) || limitChars < 0) {
      throw new TypeError(`HiddenQueue: limitChars must be a non-negative integer, got ${String(limitChars)}`)
    }
    this.limitChars = limitChars
  }

  /** Characters currently queued (a discarded queue reports 0). */
  get size(): number {
    return this.chars
  }

  /**
   * Appends output. A push that would take the queue past the limit discards
   * everything and marks the queue overflowed; later pushes are ignored (no
   * memory growth) until `take` resets it.
   */
  push(chunk: string): void {
    if (typeof chunk !== 'string') {
      throw new TypeError(`HiddenQueue.push: chunk must be a string, got ${typeof chunk}`)
    }
    if (this.overflowed || chunk.length === 0) {
      return
    }
    if (this.chars + chunk.length > this.limitChars) {
      this.chunks = []
      this.chars = 0
      this.overflowed = true
      return
    }
    this.chunks.push(chunk)
    this.chars += chunk.length
  }

  /** Returns and clears what was queued, including the overflow flag. */
  take(): HiddenQueueTake {
    const taken: HiddenQueueTake = { chunks: this.chunks, overflowed: this.overflowed }
    this.chunks = []
    this.chars = 0
    this.overflowed = false
    return taken
  }
}
