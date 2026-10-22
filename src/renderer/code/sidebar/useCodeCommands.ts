import { useCallback, useMemo } from 'react'
import type { Id, Repo, Worktree } from '../../../shared/types'
import { cleanErrorMessage } from './errorText'
import type { CodeCommands } from './codeTreeView'

const FOLDER_OPEN_FAILED = 'Could not open the folder.'

/**
 * IPC commands of the Code sidebar. A failure is logged and reported through onError (the sidebar banner);
 * the returned promises never reject, so no handler throws out of an event.
 */
export function useCodeCommands(onError: (message: string) => void): CodeCommands {
  const run = useCallback(
    async (label: string, action: () => Promise<void>): Promise<void> => {
      try {
        await action()
      } catch (error) {
        console.error(`[code] ${label} failed:`, error)
        onError(cleanErrorMessage(error))
      }
    },
    [onError]
  )

  return useMemo((): CodeCommands => {
    const toggleRepo = (repo: Repo): Promise<void> =>
      run('collapse repository', (): Promise<void> => window.api.setRepoCollapsed(repo.id, !repo.collapsed))
    const toggleWorktree = (worktree: Worktree): Promise<void> =>
      run('collapse worktree', (): Promise<void> => window.api.setWorktreeCollapsed(worktree.id, !worktree.collapsed))
    return {
      addRepository: (): Promise<void> =>
        run('add repository', async (): Promise<void> => {
          const folder = await window.api.pickFolder()
          if (folder !== null) {
            await window.api.addRepo(folder)
          }
        }),
      removeRepo: (repoId: Id): Promise<void> =>
        run('remove repository', (): Promise<void> => window.api.removeRepo(repoId)),
      removeWorktree: (worktreeId: Id): Promise<void> =>
        run('remove worktree', (): Promise<void> => window.api.removeWorktree(worktreeId)),
      sleepSession: (sessionId: Id): Promise<void> =>
        run('sleep session', (): Promise<void> => window.api.sleepSession(sessionId)),
      setKeepAwake: (sessionId: Id, keepAwake: boolean): Promise<void> =>
        run('keep awake', (): Promise<void> => window.api.setKeepAwake(sessionId, keepAwake)),
      toggleRepo,
      toggleWorktree,
      copyPath: (path: string): Promise<void> =>
        run('copy path', (): Promise<void> => navigator.clipboard.writeText(path)),
      openFolder: (sessionId: Id, path: string): Promise<void> =>
        run('open folder', async (): Promise<void> => {
          const result = await window.api.openLink(sessionId, path, false)
          if (!result.ok) {
            throw new Error(result.error ?? FOLDER_OPEN_FAILED)
          }
        })
    }
  }, [run])
}
