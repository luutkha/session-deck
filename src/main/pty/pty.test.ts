import { describe, it, expect } from 'vitest'

interface LoadResult {
  readonly loaded: boolean
}

async function loadNodePty(): Promise<LoadResult> {
  try {
    await import('node-pty')
    return { loaded: true }
  } catch {
    return { loaded: false }
  }
}

describe('node-pty native import', () => {
  it('loads under plain Node', async () => {
    const result = await loadNodePty()
    expect(result.loaded).toBe(true)
  })
})
