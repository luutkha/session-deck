// Pure helpers for Settings > Code: the shell choices, the folder value and the message of a failed save.
import type { ShellKind } from '../../shared/types'

export const WORKTREES_PLACEHOLDER = '~/SessionDeck/worktrees (default)'
const ERROR_MARKER = 'Error: '

export const SHELL_OPTIONS: readonly { readonly value: ShellKind; readonly label: string }[] = [
  { value: 'powershell', label: 'PowerShell' },
  { value: 'pwsh', label: 'PowerShell 7' },
  { value: 'cmd', label: 'Command Prompt' }
]

export function isShellKind(value: string): value is ShellKind {
  return SHELL_OPTIONS.some((option: { readonly value: ShellKind }): boolean => option.value === value)
}

/** The folder as saved: surrounding spaces removed. '' means the default folder. */
export function normalizeWorktreesRoot(input: string): string {
  return input.trim()
}

/**
 * The user-facing part of a failed save. Main errors arrive wrapped by Electron ("Error invoking remote
 * method ...: Error: <message>"), so the text after the last "Error: " is shown. Falls back to the full text.
 */
export function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const index = message.lastIndexOf(ERROR_MARKER)
  if (index === -1) {
    return message
  }
  const detail = message.slice(index + ERROR_MARKER.length).trim()
  return detail === '' ? message : detail
}
