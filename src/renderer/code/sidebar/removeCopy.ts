// Wording of the Code mode confirm dialogs. Pure: the sidebar passes names and counts in.

export function sessionCountPhrase(count: number): string {
  return count === 1 ? '1 session' : `${String(count)} sessions`
}

/** "Stops its N sessions and " when there are sessions to stop; '' otherwise. */
function stopsPrefix(sessionCount: number): string {
  return sessionCount > 0 ? `Stops its ${sessionCountPhrase(sessionCount)} and ` : ''
}

export function repoRemoveMessage(repoName: string, sessionCount: number): string {
  return `${stopsPrefix(sessionCount)}removes ${repoName} and its worktrees from SessionDeck. Folders and branches stay on disk.`
}

export function worktreeRemoveMessage(worktreeName: string, sessionCount: number, path: string, repoFolder = false): string {
  if (repoFolder) return `${stopsPrefix(sessionCount)}removes ${worktreeName} from SessionDeck. The repository folder is not touched: ${path}`
  return `${stopsPrefix(sessionCount)}removes ${worktreeName} from SessionDeck. The folder and branch stay on disk: ${path}`
}

export function sessionRemoveCopy(
  name: string,
  closed: boolean
): { readonly title: string; readonly message: string; readonly confirmLabel: string } {
  if (closed) {
    return {
      title: 'Delete session',
      message: `Permanently delete session "${name}"? This cannot be undone.`,
      confirmLabel: 'Delete'
    }
  }
  return { title: 'Remove session', message: `Remove session "${name}"?`, confirmLabel: 'Remove' }
}
