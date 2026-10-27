import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { AppSettings, SettingsPatch } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  SHELL_OPTIONS,
  WORKTREES_PLACEHOLDER,
  errorDetail,
  isShellKind,
  normalizeWorktreesRoot
} from '../mode/codeSettingsLogic'

export interface CodeSectionProps {
  readonly settings: AppSettings
  readonly actions: Pick<SessionActions, 'updateSettings' | 'pickFolder'>
}

/** Settings > Code (D31): where worktrees go and which program Shell sessions run. */
export function CodeSection({ settings, actions }: CodeSectionProps): ReactElement {
  const stored = settings.code.worktreesRoot
  const [draft, setDraft] = useState<string>(stored)
  const [error, setError] = useState<string | null>(null)

  useEffect((): void => {
    setDraft(stored)
  }, [stored])

  // A failed save keeps the typed text and shows the main-process reason inline.
  async function applyPatch(patch: SettingsPatch): Promise<boolean> {
    setError(null)
    try {
      await actions.updateSettings(patch)
      return true
    } catch (err: unknown) {
      console.error('SessionDeck: could not save the Code settings', err)
      setError(errorDetail(err))
      return false
    }
  }

  async function saveRoot(next: string): Promise<void> {
    const saved = await applyPatch({ code: { worktreesRoot: next } })
    if (saved) {
      setDraft(next)
    }
  }

  function commitDraft(): void {
    const next = normalizeWorktreesRoot(draft)
    if (next !== stored) {
      void saveRoot(next)
    }
  }

  async function browse(): Promise<void> {
    setError(null)
    try {
      const picked = await actions.pickFolder()
      if (picked !== null) {
        await saveRoot(picked)
      }
    } catch (err: unknown) {
      console.error('SessionDeck: the folder picker failed', err)
      setError(errorDetail(err))
    }
  }

  async function changeShell(next: string): Promise<void> {
    if (isShellKind(next)) {
      await applyPatch({ code: { shell: next } })
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitDraft()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="code-worktrees-root" className="text-[13px] font-medium text-foreground">
          Worktrees folder
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="code-worktrees-root"
            type="text"
            value={draft}
            onChange={(event): void => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={handleDraftKeyDown}
            placeholder={WORKTREES_PLACEHOLDER}
            aria-label="Worktrees folder"
            className="h-8 min-w-0 flex-1 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={(): void => {
              void browse()
            }}
          >
            Browse...
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={stored === ''}
            onClick={(): void => {
              void saveRoot('')
            }}
          >
            Reset to default
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          New worktrees are created in this folder, under the repository name. Empty uses the default folder.
        </p>
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium text-foreground">Shell for Shell sessions</span>
        <Select
          value={settings.code.shell}
          onValueChange={(next: string): void => {
            void changeShell(next)
          }}
        >
          <SelectTrigger id="code-shell" size="sm" aria-label="Shell for Shell sessions" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {SHELL_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="code-auto-trust" className="text-[13px] font-medium text-foreground">
            Try new worktrees without asking
          </Label>
          <Switch
            id="code-auto-trust"
            checked={settings.code.autoTrustWorktrees}
            onCheckedChange={(checked: boolean): void => {
              void applyPatch({ code: { autoTrustWorktrees: checked } })
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Answers Claude&apos;s &quot;Do you trust the files in this folder?&quot; prompt by choosing &quot;Yes, I trust
          this folder&quot; the first time a new worktree session starts. Off by default; resumed sessions are never
          answered.
        </p>
      </div>

      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
