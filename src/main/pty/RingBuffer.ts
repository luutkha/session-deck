// Append-only ring of output chunks with a monotonic, per-buffer sequence
// number. Used to replay terminal output on reattach.

export const DEFAULT_LIMIT_CHARS = 1_000_000

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
  private nextSeq = 1
  private totalChars = 0

  constructor(limitChars: number = DEFAULT_LIMIT_CHARS) {
    this.limitChars = limitChars
  }

  append(data: string): number {
    const seq = this.nextSeq
    this.nextSeq += 1
    this.chunks = [...this.chunks, { seq, data }]
    this.totalChars += data.length
    this.trimToLimit()
    return seq
  }

  snapshot(): RingSnapshot {
    if (this.chunks.length === 0) {
      return { data: '', seq: 0 }
    }
    const data = this.chunks.map((chunk) => chunk.data).join('')
    const seq = this.chunks[this.chunks.length - 1].seq
    return { data, seq }
  }

  clear(): void {
    this.chunks = []
    this.totalChars = 0
  }

  private trimToLimit(): void {
    // Drop the oldest WHOLE chunks while over the limit, but always keep the
    // newest chunk even if it alone exceeds the limit.
    while (this.chunks.length > 1 && this.totalChars > this.limitChars) {
      const oldest = this.chunks[0]
      this.chunks = this.chunks.slice(1)
      this.totalChars -= oldest.data.length
    }
  }
}
