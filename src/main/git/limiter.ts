// Concurrency limit for background work (performance): the Code mode used to start every git process of every worktree
// at once (5 per worktree), so a refresh with 40 worktrees was a burst of ~200 child processes. A limiter runs at most
// `max` tasks at the same time and starts the rest in the order they were asked for. A task that throws frees its slot.

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>

export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`createLimiter: max must be a positive integer, got ${String(max)}`)
  }
  let running = 0
  const waiting: Array<() => void> = []

  const release = (): void => {
    running -= 1
    const next = waiting.shift()
    if (next !== undefined) next()
  }

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const start = (): void => {
        running += 1
        let started: Promise<T>
        try {
          started = task()
        } catch (error) {
          release()
          reject(error)
          return
        }
        started.then(resolve, reject).finally(release)
      }
      if (running < max) start()
      else waiting.push(start)
    })
}

/** Maps `items` with at most `max` calls of `fn` in flight at once; the result keeps the input order. */
export async function mapLimit<T, R>(items: readonly T[], max: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const limit = createLimiter(max)
  return Promise.all(items.map((item) => limit(() => fn(item))))
}
