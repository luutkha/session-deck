// D83: the renderer of a detached Changes window. Its request arrives in the launch argument
// (window.api.changesWindowRequest is non-null only here); the same ChangesPanel, hooks and git pieces as the
// Code side panel draw it in the wide split layout and keep it live. Nothing else from the app shell is mounted.
import type { ReactElement } from 'react'
import { ChangesPanel } from './ChangesPanel'

const NO_REQUEST = 'This window has no worktree to show.'
export const CHANGES_WINDOW_FALLBACK_TITLE = 'Changes'

export function ChangesWindow(): ReactElement {
  const launch = window.api?.changesWindowRequest ?? null
  const title = launch !== null && launch.title.trim() !== '' ? launch.title : CHANGES_WINDOW_FALLBACK_TITLE

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
        </div>
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
