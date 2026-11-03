// The mounted workspace registers how it runs Jarvis's screen actions (D55); App's listener finds it here. Only one
// workspace is mounted per window (the mode on screen); after a mode switch the new one registers on mount.
import type { JarvisUiAction, UiMode } from '../../shared/types'

export type WorkspaceUiHandler = (action: JarvisUiAction) => string

let current: { readonly mode: UiMode; readonly handler: WorkspaceUiHandler } | null = null

/** Returns the unregister function (only removes this exact handler). */
export function registerWorkspaceUi(mode: UiMode, handler: WorkspaceUiHandler): () => void {
  current = { mode, handler }
  return (): void => {
    if (current?.handler === handler) current = null
  }
}

/** The workspace of `mode` (any mode when null), waiting for it to mount after a mode switch. */
export async function workspaceUiFor(
  mode: UiMode | null,
  timeoutMs: number,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<WorkspaceUiHandler> {
  for (let waited = 0; ; waited += 50) {
    if (current !== null && (mode === null || current.mode === mode)) return current.handler
    if (waited >= timeoutMs) throw new Error(mode === null ? 'The window is still loading.' : `The ${mode === 'code' ? 'Code' : 'Ops'} mode screen did not open.`)
    await wait(50)
  }
}
