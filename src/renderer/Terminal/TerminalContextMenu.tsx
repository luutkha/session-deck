// The terminal right-click menu (D59), adapted from stablyai/orca (MIT, (c) 2026 Lovecast Inc.): a Radix dropdown
// anchored at the click point. The workspace decides which rows apply (split, close pane, fork) and does the work.
import { useRef, type ReactElement } from 'react'
import { Clipboard, Copy, Eraser, FolderOpen, GitFork, PanelBottomClose, PanelRightClose, RotateCcw, Search, TextSelect, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { isOpeningGesture } from './terminalMenuLogic'

/** Where and for which pane the menu is open. */
export interface TerminalMenuTarget {
  readonly id: string
  readonly x: number
  readonly y: number
  /** Read when the menu opened: Copy is disabled without a selection. */
  readonly hasSelection: boolean
  /** Date.now() when it opened: the opening click must not close it again. */
  readonly openedAt: number
}

export interface TerminalContextMenuProps {
  readonly target: TerminalMenuTarget | null
  readonly onClose: () => void
  readonly onCopy: () => void
  readonly onPaste: () => void
  readonly onSelectAll: () => void
  readonly onFind: () => void
  readonly onClear: () => void
  /** Switches off a stuck alternate screen / mouse reporting so scrolling and selecting work again. */
  readonly onResetModes: () => void
  readonly onCopyPath: () => void
  /** Absent = the row is hidden (grid view, fewer than two open sessions, the pane limit). */
  readonly onSplitRight?: () => void
  readonly onSplitDown?: () => void
  /** Absent = the pane is the only one on screen. */
  readonly onClosePane?: () => void
  /** Absent = not a Claude session with a saved conversation. */
  readonly onFork?: () => void
}

export function TerminalContextMenu(props: TerminalContextMenuProps): ReactElement | null {
  const { target, onClose } = props
  const openedAt = useRef(0)
  openedAt.current = target?.openedAt ?? 0
  if (target === null) return null
  return (
    <DropdownMenu
      key={`${target.id}:${String(target.openedAt)}`}
      open
      modal={false}
      // The opening-click guard lives in onPointerDownOutside only: Escape must always close the menu.
      onOpenChange={(open: boolean): void => {
        if (!open) onClose()
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: target.x, top: target.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label="Terminal menu"
        data-testid="terminal-context-menu"
        className="min-w-56"
        sideOffset={0}
        align="start"
        // The pane's terminal takes focus back (the workspace does it on close), not Radix's hidden trigger.
        onCloseAutoFocus={(event): void => event.preventDefault()}
        onFocusOutside={(event): void => event.preventDefault()}
        onPointerDownOutside={(event): void => {
          if (isOpeningGesture(openedAt.current, Date.now())) event.preventDefault()
        }}
      >
        <DropdownMenuItem disabled={!target.hasSelection} onSelect={props.onCopy}>
          <Copy />
          Copy
          <DropdownMenuShortcut>Ctrl+C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onSelectAll}>
          <TextSelect />
          Select All
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onPaste}>
          <Clipboard />
          Paste
          <DropdownMenuShortcut>Ctrl+V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onFind}>
          <Search />
          Find…
          <DropdownMenuShortcut>Ctrl+Shift+F</DropdownMenuShortcut>
        </DropdownMenuItem>
        {props.onFork !== undefined ? (
          <DropdownMenuItem onSelect={props.onFork}>
            <GitFork />
            Fork Session
          </DropdownMenuItem>
        ) : null}
        {props.onSplitRight !== undefined || props.onSplitDown !== undefined || props.onClosePane !== undefined ? (
          <DropdownMenuSeparator />
        ) : null}
        {props.onSplitRight !== undefined ? (
          <DropdownMenuItem className="whitespace-nowrap" onSelect={props.onSplitRight}>
            <PanelRightClose />
            Split Terminal Right
          </DropdownMenuItem>
        ) : null}
        {props.onSplitDown !== undefined ? (
          <DropdownMenuItem className="whitespace-nowrap" onSelect={props.onSplitDown}>
            <PanelBottomClose />
            Split Terminal Down
          </DropdownMenuItem>
        ) : null}
        {props.onClosePane !== undefined ? (
          <DropdownMenuItem onSelect={props.onClosePane}>
            <X />
            Close Pane
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={props.onCopyPath}>
          <FolderOpen />
          Copy Folder Path
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onClear}>
          <Eraser />
          Clear Screen
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onResetModes}>
          <RotateCcw />
          Reset Terminal Modes
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
