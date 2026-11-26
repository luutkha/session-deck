// D60: the Changes panel's git state: branch status, the commit message and ticked files, the action in progress,
// the confirm step for Push / Create PR / Merge, and the last result line. Every call goes through window.api.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BranchStatus, Id, WorktreeChanges } from '../../../shared/types'
import { cleanErrorMessage } from '../sidebar/errorText'
import { chosenPaths, pruneUnticked } from './gitActionsLogic'
import { changesContentKey } from './useWorktreeChanges'

export type GitAction = 'push' | 'pr' | 'merge'

export interface GitNotice {
  readonly kind: 'ok' | 'error'
  readonly text: string
  /** A link the notice offers (the created PR). */
  readonly url?: string
}

export interface GitActions {
  readonly status: BranchStatus | null
  readonly busy: boolean
  readonly notice: GitNotice | null
  readonly dismissNotice: () => void
  readonly message: string
  readonly setMessage: (message: string) => void
  readonly unticked: ReadonlySet<string>
  readonly toggleFile: (path: string) => void
  readonly setAllTicked: (ticked: boolean) => void
  readonly chosen: readonly string[]
  readonly commit: () => Promise<void>
  /** Fetch, then fast-forward only. No confirmation: it never creates a merge commit or touches uncommitted work. */
  readonly pull: () => Promise<void>
  /** The action waiting for the user's Yes, or null. */
  readonly confirming: GitAction | null
  readonly ask: (action: GitAction) => void
  readonly cancel: () => void
  readonly confirm: (pr?: { readonly title: string; readonly body: string }) => Promise<void>
}

export function useGitActions(worktreeId: Id, changes: WorktreeChanges | null, refreshChanges: () => void): GitActions {
  const [status, setStatus] = useState<BranchStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<GitNotice | null>(null)
  const [message, setMessage] = useState('')
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set())
  const [confirming, setConfirming] = useState<GitAction | null>(null)
  const current = useRef(worktreeId)
  current.current = worktreeId

  const loadStatus = useCallback(async (): Promise<void> => {
    const id = worktreeId
    try {
      const next = await window.api.getWorktreeBranchStatus(id)
      if (current.current === id) setStatus(next)
    } catch (error) {
      if (current.current === id) setNotice({ kind: 'error', text: cleanErrorMessage(error) })
    }
  }, [worktreeId])

  // A new worktree starts clean; the status follows every new Changes result (a turn ended, a refresh, an action).
  useEffect((): void => {
    setStatus(null)
    setNotice(null)
    setMessage('')
    setUnticked(new Set())
    setConfirming(null)
  }, [worktreeId])
  // Branch status is ~7 sequential git commands: only a changed file list warrants re-reading it, not every poll.
  const contentKey = useMemo((): string => changesContentKey(changes), [changes])
  useEffect((): void => {
    void loadStatus()
  }, [loadStatus, contentKey])
  useEffect((): void => {
    setUnticked((previous) => pruneUnticked(changes, previous))
  }, [changes])

  const chosen = chosenPaths(changes, unticked)

  const run = useCallback(async (work: () => Promise<GitNotice>): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      setNotice(await work())
    } catch (error) {
      setNotice({ kind: 'error', text: cleanErrorMessage(error) })
    } finally {
      setBusy(false)
      refreshChanges()
      void loadStatus()
    }
  }, [refreshChanges, loadStatus])

  const commit = useCallback(async (): Promise<void> => {
    const paths = chosen
    const text = message
    await run(async (): Promise<GitNotice> => {
      const result = await window.api.commitWorktree({ worktreeId, message: text, paths })
      setMessage('')
      return { kind: 'ok', text: `Committed ${result.files} file${result.files === 1 ? '' : 's'}: ${result.sha.slice(0, 7)} ${result.subject}` }
    })
  }, [chosen, message, run, worktreeId])

  const pull = useCallback(async (): Promise<void> => {
    await run(async (): Promise<GitNotice> => {
      const result = await window.api.pullWorktree(worktreeId)
      return { kind: 'ok', text: result.updated ? `Pulled ${result.branch} from ${result.remote}.` : `${result.branch} is already up to date with ${result.remote}.` }
    })
  }, [run, worktreeId])

  const confirm = useCallback(async (pr?: { readonly title: string; readonly body: string }): Promise<void> => {
    const action = confirming
    setConfirming(null)
    if (action === null) return
    await run(async (): Promise<GitNotice> => {
      if (action === 'push') {
        const result = await window.api.pushWorktree(worktreeId)
        return { kind: 'ok', text: `Pushed ${result.branch} to ${result.remote}.` }
      }
      if (action === 'pr') {
        const result = await window.api.createWorktreePr(worktreeId, pr ?? {})
        return result.created
          ? { kind: 'ok', text: 'Pull request created.', url: result.url }
          : { kind: 'ok', text: 'Opened the pull request page in your browser.', url: result.url }
      }
      const result = await window.api.mergeWorktree(worktreeId)
      return {
        kind: result.merged || result.conflicts === undefined ? 'ok' : 'error',
        text: result.conflicts !== undefined ? `${result.message} Files: ${result.conflicts.join(', ')}` : result.message
      }
    })
  }, [confirming, run, worktreeId])

  return {
    status,
    busy,
    notice,
    dismissNotice: useCallback((): void => setNotice(null), []),
    message,
    setMessage,
    unticked,
    toggleFile: useCallback((path: string): void => {
      setUnticked((previous) => {
        const next = new Set(previous)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
    }, []),
    setAllTicked: useCallback((ticked: boolean): void => {
      setUnticked(ticked ? new Set() : new Set((changes?.files ?? []).filter((f) => f.uncommitted === true).map((f) => f.path)))
    }, [changes]),
    chosen,
    commit,
    confirming,
    pull,
    ask: useCallback((action: GitAction): void => setConfirming(action), []),
    cancel: useCallback((): void => setConfirming(null), []),
    confirm
  }
}
