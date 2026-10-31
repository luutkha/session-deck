// Resume on launch (D50): remembers which sessions are running and starts them again in the background at the next
// launch. The list is kept current on every run change (so a crash keeps it too) and saved once more before the
// shutdown kills the processes; the kills themselves must not empty it, so tracking stops first.
import type { Id, RuntimeState, Session } from '../../shared/types'
import { isRecord } from '../../shared/guards'

export const RESUME_FILE_NAME = 'resume-on-launch.json'
const SAVE_DEBOUNCE_MS = 1000
/** Pause between two background starts, so a launch with many sessions does not spawn them all at once. */
export const RESUME_STAGGER_MS = 400

type Timer = ReturnType<typeof setTimeout>

export interface LaunchResumeDeps {
  readonly readFile: () => Promise<string>
  readonly writeFile: (text: string) => Promise<void>
  readonly getSessions: () => readonly Session[]
  readonly subscribeRuntime: (listener: (state: RuntimeState) => void) => () => void
  readonly resume: (id: Id) => boolean
  readonly enabled: () => boolean
  readonly setTimeout: (callback: () => void, ms: number) => Timer
  readonly clearTimeout: (timer: Timer) => void
  readonly onError: (where: string, error: unknown) => void
}

export interface LaunchResume {
  /** Reads the ids saved by the previous run (empty when the file is missing or broken). */
  loadSaved(): Promise<readonly Id[]>
  /** Starts following run changes; from now on the file reflects this run. */
  startTracking(): void
  /** Starts the saved sessions that still exist and are not closed, one by one. Does nothing when the setting is off. */
  resumeSaved(ids: readonly Id[]): void
  /** Stops tracking and writes the current list (call before the shutdown kills the sessions). */
  stop(): Promise<void>
}

/** The saved ids, or [] for anything unexpected. */
export function parseResumeFile(text: string): readonly Id[] {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.ids)) return []
    return parsed.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
  } catch {
    return []
  }
}

export function serializeResumeFile(ids: Iterable<Id>): string {
  return JSON.stringify({ version: 1, ids: [...ids] })
}

/** A session counts as running when its process runs, it is not asleep and it was not closed. */
export function isRunningState(state: RuntimeState, session: Session | undefined): boolean {
  return session !== undefined && session.closedAt === undefined && state.run === 'running' && state.sleeping !== true
}

export function createLaunchResume(deps: LaunchResumeDeps): LaunchResume {
  const running = new Set<Id>()
  // Saved sessions whose staggered start has not fired yet: a quick quit must not drop them from the list.
  const pending = new Set<Id>()
  let unsubscribe: (() => void) | null = null
  let saveTimer: Timer | null = null
  let resumeTimers: Timer[] = []

  async function save(): Promise<void> {
    if (saveTimer !== null) {
      deps.clearTimeout(saveTimer)
      saveTimer = null
    }
    try {
      await deps.writeFile(serializeResumeFile(new Set([...running, ...pending])))
    } catch (error) {
      deps.onError('resume on launch: save', error)
    }
  }

  function scheduleSave(): void {
    if (saveTimer !== null) deps.clearTimeout(saveTimer)
    saveTimer = deps.setTimeout(() => {
      saveTimer = null
      void save()
    }, SAVE_DEBOUNCE_MS)
  }

  return {
    async loadSaved(): Promise<readonly Id[]> {
      try {
        return parseResumeFile(await deps.readFile())
      } catch {
        return [] // first launch: no file yet
      }
    },

    startTracking(): void {
      if (unsubscribe !== null) return
      unsubscribe = deps.subscribeRuntime((state) => {
        const session = deps.getSessions().find((s) => s.id === state.sessionId)
        const isRunning = isRunningState(state, session)
        if (isRunning === running.has(state.sessionId)) return
        if (isRunning) running.add(state.sessionId)
        else running.delete(state.sessionId)
        scheduleSave()
      })
    },

    resumeSaved(ids: readonly Id[]): void {
      if (!deps.enabled()) return
      const sessions = deps.getSessions()
      const targets = ids.filter((id) => sessions.some((s) => s.id === id && s.closedAt === undefined))
      targets.forEach((id, index) => {
        pending.add(id)
        resumeTimers.push(deps.setTimeout(() => {
          pending.delete(id)
          try {
            deps.resume(id)
          } catch (error) {
            deps.onError('resume on launch', error)
          }
        }, index * RESUME_STAGGER_MS))
      })
    },

    async stop(): Promise<void> {
      unsubscribe?.()
      unsubscribe = null
      for (const timer of resumeTimers) deps.clearTimeout(timer)
      resumeTimers = []
      await save()
    }
  }
}
