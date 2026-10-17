import type { PtyReplay } from '../../shared/ipc'

type GateMode = 'awaitingReplay' | 'live'

interface QueuedChunk {
  readonly seq: number
  readonly data: string
}

function assertSeq(seq: number, context: string): void {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new TypeError(`${context}: seq must be a non-negative integer, got ${String(seq)}`)
  }
}

function assertData(data: string, context: string): void {
  if (typeof data !== 'string') {
    throw new TypeError(`${context}: data must be a string, got ${typeof data}`)
  }
}

/**
 * Orders PTY output for one session pane.
 *
 * Live chunks arrive over IPC at any time, but a pane can only write them once
 * it has applied the replay buffer from `ptyReplay`. Until `begin(replay)` is
 * called, chunks are queued; `begin` returns the replay data followed by every
 * queued chunk newer than the replay, in arrival order. Once live, `push`
 * returns chunks to write immediately and drops duplicates / out-of-order
 * chunks (seq <= last written seq). Gaps are NOT tracked: a later seq is
 * always accepted.
 *
 * `reset()` prepares the gate for a process restart: the queue is discarded
 * and the gate waits for a fresh replay, but the last written seq is kept
 * because main keeps increasing seqs across restarts.
 */
export class SeqGate {
  private mode: GateMode = 'awaitingReplay'
  private queue: QueuedChunk[] = []
  private lastSeq = 0

  get isLive(): boolean {
    return this.mode === 'live'
  }

  /** Seq of the newest chunk written (or covered by the replay). */
  get lastWrittenSeq(): number {
    return this.lastSeq
  }

  /**
   * Applies the replay buffer and flushes the queue.
   * Returns the ordered list of chunks to write: the replay data (when
   * non-empty) followed by queued chunks with seq > replay.seq.
   * Throws when called while already live (call `reset()` first).
   */
  begin(replay: PtyReplay): readonly string[] {
    if (this.mode === 'live') {
      throw new Error('SeqGate.begin called twice without reset')
    }
    if (replay === null || typeof replay !== 'object') {
      throw new TypeError('SeqGate.begin: replay must be an object')
    }
    assertData(replay.data, 'SeqGate.begin')
    assertSeq(replay.seq, 'SeqGate.begin')

    this.mode = 'live'
    if (replay.seq > this.lastSeq) {
      this.lastSeq = replay.seq
    }

    const out: string[] = []
    if (replay.data.length > 0) {
      out.push(replay.data)
    }
    for (const chunk of this.queue) {
      if (chunk.seq > this.lastSeq) {
        this.lastSeq = chunk.seq
        out.push(chunk.data)
      }
    }
    this.queue = []
    return out
  }

  /**
   * Offers a live chunk. Before `begin`, the chunk is queued and nothing is
   * returned. Once live, returns `[data]` for fresh chunks or `[]` for
   * duplicates / out-of-order chunks.
   */
  push(seq: number, data: string): readonly string[] {
    assertSeq(seq, 'SeqGate.push')
    assertData(data, 'SeqGate.push')

    if (this.mode !== 'live') {
      this.queue.push({ seq, data })
      return []
    }
    if (seq <= this.lastSeq) {
      return []
    }
    this.lastSeq = seq
    return [data]
  }

  /**
   * Prepares for a process restart: discards queued chunks and waits for a
   * new replay. The last written seq is kept because main-side seqs keep
   * increasing across restarts.
   */
  reset(): void {
    this.queue = []
    this.mode = 'awaitingReplay'
  }
}
