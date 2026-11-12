// Append-only ring of output chunks with a monotonic, per-buffer sequence
// number. Used to replay terminal output on reattach.
//
// Chunks are appended in place behind a moving `head` index: trimming only
// advances `head`, so appending is amortised O(1) instead of copying the whole
// array on every write. The dead prefix is compacted once it dominates.

export const DEFAULT_LIMIT_CHARS = 1_000_000

/** Compact the dead prefix once it is this large (or half the array). */
const COMPACT_HEAD_MIN = 1024

export interface RingChunk {
  readonly seq: number
  readonly data: string
}

export interface RingSnapshot {
  readonly data: string
  readonly seq: number
}

export class RingBuffer {
  private readonly limitChars: number
  private chunks: RingChunk[] = []
  private head = 0
  private nextSeq = 1
  private totalChars = 0
  /** Joining up to 1M chars is expensive and snapshot() runs on every hydration. */
  private cached: RingSnapshot | null = null

  constructor(limitChars: number = DEFAULT_LIMIT_CHARS) {
    this.limitChars = limitChars
  }

  append(data: string): number {
    const seq = this.nextSeq
    this.nextSeq += 1
    this.chunks.push({ seq, data })
    this.totalChars += data.length
    this.trimToLimit()
    this.cached = null
    return seq
  }

  snapshot(): RingSnapshot {
    if (this.cached !== null) {
      return this.cached
    }
    if (this.head >= this.chunks.length) {
      this.cached = { data: '', seq: 0 }
      return this.cached
    }
    const data = this.chunks
      .slice(this.head)
      .map((chunk) => chunk.data)
      .join('')
    const seq = this.chunks[this.chunks.length - 1].seq
    this.cached = { data, seq }
    return this.cached
  }

  clear(): void {
    this.chunks = []
    this.head = 0
    this.totalChars = 0
    this.cached = null
  }

  private trimToLimit(): void {
    // Drop the oldest WHOLE chunks while over the limit, but always keep the
    // newest chunk even if it alone exceeds the limit.
    while (this.chunks.length - this.head > 1 && this.totalChars > this.limitChars) {
      this.totalChars -= this.chunks[this.head].data.length
      this.head += 1
    }
    const liveCount = this.chunks.length - this.head
    if (this.head > 0 && (this.head > liveCount || this.head > COMPACT_HEAD_MIN)) {
      this.chunks = this.chunks.slice(this.head)
      this.head = 0
    }
  }
}
