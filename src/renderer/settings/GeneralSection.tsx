import { useEffect, useState, type ReactElement } from 'react'
import type { AppSettings, LoginItemState, SettingsPatch } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

export interface GeneralSectionProps {
  readonly settings: AppSettings
  readonly actions: Pick<SessionActions, 'updateSettings'>
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function GeneralSection({ settings, actions }: GeneralSectionProps): ReactElement {
  const [loginItem, setLoginItem] = useState<LoginItemState | null>(null)
  const [loginPending, setLoginPending] = useState(false)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect((): (() => void) => {
    let cancelled = false
    window.api
      .getLoginItem()
      .then((state: LoginItemState): void => {
        if (!cancelled) setLoginItem(state)
      })
      .catch((err: unknown): void => {
        if (!cancelled) setError(toMessage(err))
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  async function applyPatch(patch: SettingsPatch): Promise<void> {
    setError(null)
    try {
      await actions.updateSettings(patch)
    } catch (err: unknown) {
      setError(toMessage(err))
    }
  }

  async function handleLoginToggle(open: boolean): Promise<void> {
    setError(null)
    setLoginPending(true)
    try {
      setLoginItem(await window.api.setLoginItem(open))
    } catch (err: unknown) {
      setError(toMessage(err))
    } finally {
      setLoginPending(false)
    }
  }

  async function handleQuit(): Promise<void> {
    if (!confirmQuit) {
      setConfirmQuit(true)
      return
    }
    setError(null)
    try {
      await window.api.quitApp()
    } catch (err: unknown) {
      setError(toMessage(err))
      setConfirmQuit(false)
    }
  }

  const loginSupported = loginItem !== null && loginItem.supported

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="general-start-on-login" className="text-[13px] font-medium text-foreground">
            Start SessionDeck when I sign in to Windows
          </Label>
          <Switch
            id="general-start-on-login"
            checked={loginItem?.openAtLogin ?? false}
            disabled={!loginSupported || loginPending}
            onCheckedChange={(checked: boolean): void => void handleLoginToggle(checked)}
          />
        </div>
        {loginItem !== null && !loginItem.supported ? (
          <p className="text-xs text-muted-foreground">Available in the installed app</p>
        ) : null}
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="general-close-to-tray" className="text-[13px] font-medium text-foreground">
            Keep running in the tray when I close the window
          </Label>
          <Switch
            id="general-close-to-tray"
            checked={settings.tray.closeToTray}
            onCheckedChange={(checked: boolean): void => void applyPatch({ tray: { closeToTray: checked } })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Your sessions keep running. Quit from the tray menu or the button below.
        </p>
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label
            htmlFor="general-desktop-notifications"
            className="text-[13px] font-medium text-foreground"
          >
            Desktop notifications
          </Label>
          <Switch
            id="general-desktop-notifications"
            checked={settings.tray.desktopNotifications}
            onCheckedChange={(checked: boolean): void =>
              void applyPatch({ tray: { desktopNotifications: checked } })
            }
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label
            htmlFor="general-notify-unfocused"
            className="text-[13px] font-medium text-foreground"
          >
            Only when SessionDeck is not the active window
          </Label>
          <Switch
            id="general-notify-unfocused"
            checked={settings.tray.notifyOnlyWhenUnfocused}
            disabled={!settings.tray.desktopNotifications}
            onCheckedChange={(checked: boolean): void =>
              void applyPatch({ tray: { notifyOnlyWhenUnfocused: checked } })
            }
          />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="general-hub-scroll" className="text-[13px] font-medium text-foreground">
            Open the Hub at the busiest status
          </Label>
          <Switch
            id="general-hub-scroll"
            checked={settings.hub.scrollToBusiest}
            onCheckedChange={(checked: boolean): void => void applyPatch({ hub: { scrollToBusiest: checked } })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Scrolls the board to the status column with the most sessions.
        </p>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit text-xs text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/20"
          aria-label="Quit SessionDeck"
          onClick={(): void => void handleQuit()}
        >
          Quit SessionDeck
        </Button>
        {confirmQuit ? (
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">This stops all running sessions.</p>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-xs"
              onClick={(): void => setConfirmQuit(false)}
            >
              Cancel
            </Button>
          </div>
        ) : null}
      </div>

      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
