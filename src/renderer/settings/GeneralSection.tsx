import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { AppSettings, LoginItemState, SettingsPatch } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { applyTheme, getTheme, subscribeTheme, writeThemePref, type Theme } from '../theme/themePref'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { AwaySettingsBlock } from '../timeline/AwaySettingsBlock'
import { errorMessage } from '../../shared/guards'

export interface GeneralSectionProps {
  readonly settings: AppSettings
  readonly actions: Pick<SessionActions, 'updateSettings'>
}

const THEME_CHOICES: readonly { readonly value: Theme; readonly label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
]

export function GeneralSection({ settings, actions }: GeneralSectionProps): ReactElement {
  // D89: a renderer-local preference (not a store setting), shared with the other windows.
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme)
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
        if (!cancelled) setError(errorMessage(err))
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
      setError(errorMessage(err))
    }
  }

  function chooseTheme(next: Theme): void {
    if (next === theme) {
      return
    }
    writeThemePref(next)
    // Applies in this window at once too (the subscription updates the terminals and other windows).
    applyTheme(document, next)
  }

  async function handleLoginToggle(open: boolean): Promise<void> {
    setError(null)
    setLoginPending(true)
    try {
      setLoginItem(await window.api.setLoginItem(open))
    } catch (err: unknown) {
      setError(errorMessage(err))
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
      setError(errorMessage(err))
      setConfirmQuit(false)
    }
  }

  const loginSupported = loginItem !== null && loginItem.supported

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-foreground">Theme</span>
        <div
          id="general-theme"
          data-testid="settings-theme"
          className="flex items-center gap-2"
          role="group"
          aria-label="Theme"
        >
          {THEME_CHOICES.map((choice) => (
            <Button
              key={choice.value}
              type="button"
              size="xs"
              variant={theme === choice.value ? 'default' : 'outline'}
              aria-pressed={theme === choice.value}
              data-theme-choice={choice.value}
              onClick={(): void => chooseTheme(choice.value)}
            >
              {choice.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Dark is the default. Light changes this window and the other open windows immediately, including the terminals.
        </p>
      </div>

      <Separator />

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

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="general-resume-running" className="text-[13px] font-medium text-foreground">
            Resume running sessions on launch
          </Label>
          <Switch
            id="general-resume-running"
            checked={settings.launch.resumeRunning}
            onCheckedChange={(checked: boolean): void => void applyPatch({ launch: { resumeRunning: checked } })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Sessions that were running when SessionDeck closed start again in the background (their conversations resume).
        </p>
      </div>

      <Separator />

      <AwaySettingsBlock settings={settings.away} onPatch={applyPatch} />

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
