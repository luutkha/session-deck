import { Folder } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Session } from '../../shared/types'
import type { WorkspaceBucket } from '../state/selectors'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../components/ui/context-menu'
import { SectionHeader } from './SectionHeader'

export interface WorkspaceSectionProps {
  /** Unique within the sidebar (group + workspace); used for aria and test hooks. */
  readonly sectionId: string
  readonly bucket: WorkspaceBucket
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly onNewSession: (folder: string) => void
  readonly renderSession: (session: Session) => ReactElement
}

/** One workspace (root folder) inside a group: a collapsible sub-header and its sessions. */
export function WorkspaceSection(props: WorkspaceSectionProps): ReactElement {
  const { sectionId, bucket, collapsed, onToggle, onNewSession, renderSession } = props
  return (
    <div
      role="group"
      aria-labelledby={sectionId}
      data-workspace={bucket.key}
      data-workspace-collapsed={collapsed ? 'true' : 'false'}
      className="flex flex-col gap-0.5"
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div title={bucket.path}>
            <SectionHeader
              id={sectionId}
              label={bucket.label}
              count={bucket.sessions.length}
              collapsed={collapsed}
              icon={<Folder className="size-3.5" aria-hidden="true" />}
              onToggle={onToggle}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[10rem]">
          <ContextMenuItem onSelect={(): void => onNewSession(bucket.path)}>
            New session in this workspace
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!collapsed && <div className="flex flex-col gap-0.5 pl-3">{bucket.sessions.map(renderSession)}</div>}
    </div>
  )
}
