import type { ReactElement } from 'react'
import { Bot, Gauge, Settings2, Tags, Volume2, Wand2 } from 'lucide-react'
import type { AppSettings, StatusDef } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { GeneralSection } from './GeneralSection'
import { AgentsSection } from './AgentsSection'
import { SoundSection } from './SoundSection'
import { AutomationSection } from './AutomationSection'
import { QuotaSection } from './QuotaSection'
import { StatusesSection } from './StatusesSection'

export type SettingsSection = 'general' | 'agents' | 'sound' | 'automation' | 'quota' | 'statuses'

export type SettingsActions = Pick<
  SessionActions,
  'upsertStatus' | 'removeStatus' | 'reorderStatuses' | 'updateSettings'
>

export interface SettingsDialogProps {
  readonly section: SettingsSection
  readonly onSectionChange: (section: SettingsSection) => void
  readonly settings: AppSettings
  readonly statuses: readonly StatusDef[]
  readonly actions: SettingsActions
  readonly onClose: () => void
}

interface SettingsNavItemProps {
  readonly label: string
  readonly icon: ReactElement
  readonly active: boolean
  readonly onClick: () => void
}

function SettingsNavItem({ label, icon, active, onClick }: SettingsNavItemProps): ReactElement {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

const NAV_ITEMS: readonly {
  readonly id: SettingsSection
  readonly label: string
  readonly icon: ReactElement
}[] = [
  { id: 'general', label: 'General', icon: <Settings2 className="size-4 shrink-0" aria-hidden="true" /> },
  { id: 'agents', label: 'Agents', icon: <Bot className="size-4 shrink-0" aria-hidden="true" /> },
  { id: 'sound', label: 'Sound', icon: <Volume2 className="size-4 shrink-0" aria-hidden="true" /> },
  { id: 'automation', label: 'Automation', icon: <Wand2 className="size-4 shrink-0" aria-hidden="true" /> },
  { id: 'quota', label: 'Quota', icon: <Gauge className="size-4 shrink-0" aria-hidden="true" /> },
  { id: 'statuses', label: 'Statuses', icon: <Tags className="size-4 shrink-0" aria-hidden="true" /> }
]

function SettingsPane({
  section,
  settings,
  statuses,
  actions
}: {
  readonly section: SettingsSection
  readonly settings: AppSettings
  readonly statuses: readonly StatusDef[]
  readonly actions: SettingsActions
}): ReactElement {
  switch (section) {
    case 'general':
      return <GeneralSection settings={settings} actions={actions} />
    case 'agents':
      return <AgentsSection settings={settings} actions={actions} />
    case 'sound':
      return <SoundSection />
    case 'automation':
      return <AutomationSection settings={settings} statuses={statuses} actions={actions} />
    case 'quota':
      return <QuotaSection settings={settings} actions={actions} />
    case 'statuses':
      return <StatusesSection statuses={statuses} actions={actions} />
  }
}

export function SettingsDialog({
  section,
  onSectionChange,
  settings,
  statuses,
  actions,
  onClose
}: SettingsDialogProps): ReactElement {
  return (
    <Dialog
      open
      onOpenChange={(open: boolean): void => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="h-[640px] max-h-[calc(100vh-2rem)] max-w-xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/50 px-6 pt-5 pb-4">
          <DialogTitle className="text-sm">Settings</DialogTitle>
          <DialogDescription className="text-xs">
            Agents, notifications, automation, quota and statuses.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings sections"
            className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border/50 p-2"
          >
            {NAV_ITEMS.map((item) => (
              <SettingsNavItem
                key={item.id}
                label={item.label}
                icon={item.icon}
                active={section === item.id}
                onClick={(): void => onSectionChange(item.id)}
              />
            ))}
          </nav>
          <ScrollArea className="min-h-0 flex-1" viewportClassName="pr-2">
            <div className="flex flex-col gap-4 px-6 py-5">
              <SettingsPane section={section} settings={settings} statuses={statuses} actions={actions} />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
