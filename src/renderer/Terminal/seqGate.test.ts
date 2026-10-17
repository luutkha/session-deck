import { SeqGate } from './seqGate'

describe('SeqGate', () => {
  describe('before replay is applied', () => {
    it('queues live chunks and writes nothing', () => {
      const gate = new SeqGate()
      expect(gate.push(1, 'a')).toEqual([])
      expect(gate.push(2, 'b')).toEqual([])
      expect(gate.isLive).toBe(false)
    })
  })

  describe('begin(replay)', () => {
    it('returns replay data first, then queued chunks with seq > replay.seq in arrival order', () => {
      const gate = new SeqGate()
      gate.push(1, 'first')
      gate.push(2, 'second')
      gate.push(3, 'third')
      const out = gate.begin({ data: 'REPLAY', seq: 1 })
      expect(out).toEqual(['REPLAY', 'second', 'third'])
      expect(gate.isLive).toBe(true)
    })

    it('drops queued chunks already covered by the replay (seq <= replay.seq)', () => {
      const gate = new SeqGate()
      gate.push(1, 'old')
      gate.push(5, 'new')
      const out = gate.begin({ data: 'R', seq: 4 })
      expect(out).toEqual(['R', 'new'])
    })

    it('omits the replay data chunk entirely when replay data is empty', () => {
      const gate = new SeqGate()
      gate.push(1, 'live')
      const out = gate.begin({ data: '', seq: 0 })
      expect(out).toEqual(['live'])
    })

    it('returns an empty list when replay is empty and no chunks were queued', () => {
      const gate = new SeqGate()
      expect(gate.begin({ data: '', seq: 0 })).toEqual([])
    })

    it('drops an out-of-order queued chunk whose seq is below an already flushed one', () => {
      const gate = new SeqGate()
      gate.push(2, 'two')
      gate.push(5, 'five')
      gate.push(3, 'three-arrived-late')
      const out = gate.begin({ data: 'R', seq: 1 })
      expect(out).toEqual(['R', 'two', 'five'])
    })

    it('throws when called twice without a reset', () => {
      const gate = new SeqGate()
      gate.begin({ data: '', seq: 0 })
      expect(() => gate.begin({ data: '', seq: 0 })).toThrow(/twice/)
    })

    it('rejects a replay with a non-integer seq', () => {
      const gate = new SeqGate()
      expect(() => gate.begin({ data: '', seq: 1.5 })).toThrow(TypeError)
    })

    it('rejects a replay with a negative seq', () => {
      const gate = new SeqGate()
      expect(() => gate.begin({ data: '', seq: -1 })).toThrow(TypeError)
    })

    it('rejects a replay whose data is not a string', () => {
      const gate = new SeqGate()
      const bad = { data: 42, seq: 0 } as unknown as { data: string; seq: number }
      expect(() => gate.begin(bad)).toThrow(TypeError)
    })
  })

  describe('push(seq, data) once live', () => {
    it('writes a chunk with a fresh seq through immediately', () => {
      const gate = new SeqGate()
      gate.begin({ data: '', seq: 0 })
      expect(gate.push(1, 'hello')).toEqual(['hello'])
    })

    it('drops a duplicate chunk (seq == last written seq)', () => {
      const gate = new SeqGate()
      gate.begin({ data: 'R', seq: 3 })
      expect(gate.push(3, 'dup')).toEqual([])
    })

    it('drops an out-of-order chunk older than the last written seq', () => {
      const gate = new SeqGate()
      gate.begin({ data: '', seq: 0 })
      gate.push(5, 'five')
      expect(gate.push(3, 'stale')).toEqual([])
      expect(gate.push(5, 'dup')).toEqual([])
    })

    it('does not drop chunks across a gap; it accepts the next higher seq', () => {
      const gate = new SeqGate()
      gate.begin({ data: '', seq: 0 })
      gate.push(2, 'two')
      // seq 3 and 4 never arrive: the gate must not stall waiting for them
      expect(gate.push(7, 'seven')).toEqual(['seven'])
      expect(gate.lastWrittenSeq).toBe(7)
    })

    it('rejects a non-integer seq', () => {
      const gate = new SeqGate()
      gate.begin({ data: '', seq: 0 })
      expect(() => gate.push(1.2, 'x')).toThrow(TypeError)
    })

    it('rejects a negative seq', () => {
      const gate = new SeqGate()
      gate.begin({ data: '', seq: 0 })
      expect(() => gate.push(-4, 'x')).toThrow(TypeError)
    })

    it('rejects a non-string payload', () => {
      const gate = new SeqGate()
      gate.begin({ data: '', seq: 0 })
      expect(() => gate.push(1, null as unknown as string)).toThrow(TypeError)
    })
  })

  describe('reset() for process restart', () => {
    it('keeps the last seq so main-side ever-increasing seqs continue to work', () => {
      const gate = new SeqGate()
      gate.begin({ data: 'OLD', seq: 10 })
      gate.push(11, 'eleven')
      gate.reset()
      expect(gate.isLive).toBe(false)
      // after restart, main keeps increasing seq; replay covers up to 12
      const out = gate.begin({ data: 'NEW', seq: 12 })
      expect(out).toEqual(['NEW'])
      expect(gate.push(13, 'thirteen')).toEqual(['thirteen'])
      expect(gate.lastWrittenSeq).toBe(13)
    })

    it('discards chunks queued before the reset', () => {
      const gate = new SeqGate()
      gate.push(1, 'stale')
      gate.reset()
      const out = gate.begin({ data: 'R', seq: 0 })
      expect(out).toEqual(['R'])
    })

    it('drops post-reset chunks that predate the kept last seq', () => {
      const gate = new SeqGate()
      gate.begin({ data: '', seq: 40 })
      gate.reset()
      // a chunk from the old generation arriving late must not be written again
      gate.push(41, 'old-generation')
      const out = gate.begin({ data: 'FRESH', seq: 42 })
      expect(out).toEqual(['FRESH'])
      expect(gate.push(41, 'late-dup')).toEqual([])
    })

    it('accepts a replay whose seq equals the kept last seq (no output since restart)', () => {
      const gate = new SeqGate()
      gate.begin({ data: '', seq: 9 })
      gate.reset()
      const out = gate.begin({ data: '', seq: 9 })
      expect(out).toEqual([])
      expect(gate.push(10, 'next')).toEqual(['next'])
    })

    it('keeps last seq when the new replay is behind (never rewinds)', () => {
      const gate = new SeqGate()
      gate.begin({ data: '', seq: 50 })
      gate.reset()
      gate.begin({ data: '', seq: 0 })
      expect(gate.push(49, 'rewound')).toEqual([])
      expect(gate.push(51, 'forward')).toEqual(['forward'])
    })
  })
})
