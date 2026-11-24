import type { Terminal } from '@xterm/xterm'
import type { AgentKind } from '../../shared/types'
import { formatDroppedPaths } from './dropPaths'

/** Claude Code reads an image from the system clipboard when it receives Alt+V (ESC v). */
export const CLAUDE_PASTE_IMAGE_KEYS = '\x1bv'

/** OpenCode reads an image from the system clipboard on Ctrl+V (it ignores Alt+V). */
export const OPENCODE_PASTE_IMAGE_KEYS = '\x16'

/** The keys that make the session's agent attach the clipboard image (D81: Cursor uses Claude's keys). */
export function pasteImageKeysFor(agent: AgentKind | undefined): string {
  return agent === 'opencode' ? OPENCODE_PASTE_IMAGE_KEYS : CLAUDE_PASTE_IMAGE_KEYS
}

/** True when the clipboard holds an image and no text (the case where a plain paste would do nothing). */
export async function clipboardHasImageOnly(): Promise<boolean> {
  try {
    const items = await navigator.clipboard.read()
    const types = items.flatMap((item) => [...item.types])
    return types.some((t) => t.startsWith('image/')) && !types.includes('text/plain')
  } catch {
    // Reading is refused without focus or permission; the caller then falls back to a text paste.
    return false
  }
}

function pathsOf(files: FileList): string[] {
  return [...files].map((file) => window.api.pathForFile(file))
}

/** Dropping files onto the pane pastes their absolute paths (Claude Code turns image paths into attachments). */
export function attachFileDrop(element: HTMLElement, term: Terminal): void {
  element.addEventListener('dragover', (event: DragEvent): void => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  })
  element.addEventListener('drop', (event: DragEvent): void => {
    const files = event.dataTransfer?.files
    if (files === undefined || files.length === 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const text = formatDroppedPaths(pathsOf(files))
    if (text.length > 0) {
      term.paste(text)
      term.focus()
    }
  })
}
