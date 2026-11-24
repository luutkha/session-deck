// D83: the renderer of a detached Changes window. Its request arrives in the launch argument
// (window.api.changesWindowRequest is non-null only here); the same ChangesPanel, hooks and git pieces as the
// Code side panel draw it in the wide split layout and keep it live. Nothing else from the app shell is mounted.
import { useState } from 'react'
import type { ReactElement } from 'react'
import { PanelRightClose } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { ChangesPanel } from './ChangesPanel'

const NO_REQUEST = 'This window has no worktree to show.'
const ATTACH_FAILED = 'Could not show these changes in the main window.'
export const CHANGES_WINDOW_FALLBACK_TITLE = 'Changes'

// The main process rejects with a readable Error; anything else still gets a useful line.
export function attachErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  // Electron wraps a rejected invoke as "Error invoking remote method 'channel': Error: <text>"; show only <text>.
  const text = message.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '').trim()
  return text !== '' ? text : ATTACH_FAILED
}

export function ChangesWindow(): ReactElement {
  const launch = window.api?.changesWindowRequest ?? null
  const title = launch !== null && launch.title.trim() !== '' ? launch.title : CHANGES_WINDOW_FALLBACK_TITLE
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)

  // Docking back hands the worktree to the main window, which closes this one; success needs no local state.
  async function dockBack(worktreeId: string): Promise<void> {
    setAttaching(true)
    setAttachError(null)
    try {
      await window.api.attachChanges(worktreeId)
    } catch (error) {
      setAttachError(attachErrorText(error))
    } finally {
      setAttaching(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-foreground">
      {/* The window uses the hidden native title bar (36px overlay): this strip is the drag area and keeps
          the native min/max/close buttons clear of the header content. */}
      <header className="app-drag flex shrink-0 flex-col border-b border-sidebar-border">
        <div className="h-9" aria-hidden="true" />
        <div className="flex items-center gap-2 px-3 pb-2">
          <span
            data-changes-window-title=""
            className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90"
            title={title}
          >
            {title}
          </span>
          {launch !== null && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="app-no-drag text-[11px]"
              aria-label="Show these changes in the main window and close this window"
              data-changes-attach=""
              title="Show in the main window"
              disabled={attaching}
              onClick={(): void => {
                void dockBack(launch.worktreeId)
              }}
            >
              <PanelRightClose aria-hidden="true" />
              Dock back
            </Button>
          )}
        </div>
        {attachError !== null && (
          <p role="alert" data-changes-attach-error="" className="px-3 pb-2 text-xs text-destructive">
            {attachError}
          </p>
        )}
      </header>
      {launch === null ? (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {NO_REQUEST}
        </p>
      ) : (
        // No target: the annotation UI needs a session this window does not have. No onDetach: already detached.
        <ChangesPanel worktreeId={launch.worktreeId} layout="split" className="min-h-0 flex-1" />
      )}
    </div>
  )
}
