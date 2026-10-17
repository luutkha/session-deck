import { type ReactElement, type ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../components/ui/context-menu'

export interface GroupContextMenuProps {
  readonly children: ReactNode
  readonly onRename: () => void
  readonly onNewSession: () => void
  readonly onRemove: () => void
}

export function GroupContextMenu(props: GroupContextMenuProps): ReactElement {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[10rem]">
        <ContextMenuItem onSelect={props.onRename}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={props.onNewSession}>New session in this group</ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={props.onRemove}>
          Delete group
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}