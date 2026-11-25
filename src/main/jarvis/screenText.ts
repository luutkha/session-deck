// What a session's terminal shows, as plain text (D53 read_screen): the pty replay is drawn into a headless xterm of
// the same size, so cursor moves and redraws of a full-screen TUI end up as the lines a person would see.
import xtermHeadless from '@xterm/headless'

export const SCREEN_LINES_DEFAULT = 40
export const SCREEN_LINES_MAX = 300

const SCREEN_CACHE_MAX = 32
const FINGERPRINT_EDGE = 512
const SAMPLE_COUNT = 16
const SAMPLE_WIDTH = 32

interface ScreenCacheEntry {
  readonly samples: readonly string[]
  readonly text: string
}

const screenCache = new Map<string, ScreenCacheEntry>()

/** Cheap FNV-1a fingerprint of the replay's first/last 512 chars (a fingerprint, not a security hash). */
function fingerprint(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 16 evenly spaced 32-char slices: an exact second check in case a head/tail fingerprint collides. */
function samplesOf(data: string): string[] {
  const lastStart = Math.max(0, data.length - SAMPLE_WIDTH)
  const samples: string[] = []
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const start = Math.floor((lastStart * i) / (SAMPLE_COUNT - 1))
    samples.push(data.slice(start, start + SAMPLE_WIDTH))
  }
  return samples
}

function sameSamples(a: readonly string[], b: readonly string[]): boolean {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return a.length === b.length
}

function remember(key: string, entry: ScreenCacheEntry): void {
  screenCache.delete(key)
  screenCache.set(key, entry) // a hit also becomes the most-recently-used entry
  while (screenCache.size > SCREEN_CACHE_MAX) {
    const oldest = screenCache.keys().next()
    if (oldest.done === true) break
    screenCache.delete(oldest.value)
  }
}

/** The last `lines` lines of the rendered screen (scrollback included), trailing blank lines dropped. */
export function renderScreenText(data: string, cols: number, rows: number, lines: number): Promise<string> {
  const head = fingerprint(data.slice(0, FINGERPRINT_EDGE))
  const tail = fingerprint(data.slice(Math.max(0, data.length - FINGERPRINT_EDGE)))
  const key = `${data.length}:${head}:${tail}:${cols}:${rows}:${lines}`
  const cached = screenCache.get(key)
  if (cached !== undefined && sameSamples(cached.samples, samplesOf(data))) {
    remember(key, cached)
    return Promise.resolve(cached.text)
  }
  // An idle session's replay is unchanged; rebuilding a headless xterm from up to 1 MB on every digest/poll is
  // needless work on the main thread. The fingerprint and exact samples stop a stale screen being returned.
  const term = new xtermHeadless.Terminal({ cols, rows, scrollback: SCREEN_LINES_MAX, allowProposedApi: true })
  return new Promise((resolve) => {
    term.write(data, () => {
      const buffer = term.buffer.active
      const all: string[] = []
      for (let i = 0; i < buffer.length; i += 1) all.push(buffer.getLine(i)?.translateToString(true) ?? '')
      while (all.length > 0 && all[all.length - 1].trim() === '') all.pop()
      const text = all.slice(-lines).join('\n')
      term.dispose()
      remember(key, { samples: samplesOf(data), text })
      resolve(text)
    })
  })
}
