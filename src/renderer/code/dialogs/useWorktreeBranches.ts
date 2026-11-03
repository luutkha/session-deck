import { useEffect, useState } from 'react'
import type { Id, RepoBranches } from '../../../shared/types'
import { cleanErrorMessage } from '../sidebar/errorText'
import { pickBaseBranch } from './worktreeDialogLogic'

interface BranchLoad {
  readonly repoId: Id
  readonly branches: RepoBranches | null
  readonly error: string | null
}

interface BaseChoice {
  readonly repoId: Id
  readonly branch: string
}

export interface WorktreeBranches {
  readonly branches: readonly string[]
  /** True while the branches of the selected repo are being read. */
  readonly loading: boolean
  /** Why the branches could not be read, or null. */
  readonly error: string | null
  /** The chosen base branch: the user's pick, else the default (see pickBaseBranch). null = none. */
  readonly base: string | null
  readonly chooseBase: (branch: string) => void
  /** D57: the branch checked out in the repo folder (null = detached or not loaded) and where each branch is open. */
  readonly current: string | null
  readonly checkedOut: readonly { readonly branch: string; readonly path: string }[]
}

/**
 * Local branches of a repo for the New worktree dialog. Loads them when the repo changes; a result for an older
 * repo is ignored. The base branch resets to the default for each repo.
 */
export function useWorktreeBranches(repoId: Id | null): WorktreeBranches {
  const [load, setLoad] = useState<BranchLoad | null>(null)
  const [choice, setChoice] = useState<BaseChoice | null>(null)

  useEffect((): (() => void) => {
    if (repoId === null) return (): void => undefined
    let active = true
    void window.api
      .getRepoBranches(repoId)
      .then((branches): void => {
        if (active) setLoad({ repoId, branches, error: null })
      })
      .catch((error: unknown): void => {
        console.error('[code] read branches failed:', error)
        if (active) setLoad({ repoId, branches: null, error: cleanErrorMessage(error) })
      })
    return (): void => {
      active = false
    }
  }, [repoId])

  const current = load !== null && load.repoId === repoId ? load : null
  const repoBranches = current?.branches ?? null
  const defaultBase = repoBranches !== null ? pickBaseBranch(repoBranches.current, repoBranches.branches) : null
  const base = choice !== null && choice.repoId === repoId ? choice.branch : defaultBase

  return {
    branches: repoBranches?.branches ?? [],
    loading: repoId !== null && current === null,
    error: current?.error ?? null,
    base,
    chooseBase: (branch: string): void => {
      if (repoId !== null) setChoice({ repoId, branch })
    },
    current: repoBranches?.current ?? null,
    checkedOut: repoBranches?.checkedOut ?? []
  }
}
