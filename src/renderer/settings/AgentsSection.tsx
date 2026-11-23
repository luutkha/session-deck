import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { AppSettings, SettingsPatch } from '../../shared/types'
import {
  JARVIS_MODEL_MAX,
  JARVIS_MODEL_RE,
  MAX_WATCH_MINUTES,
  MIN_WATCH_MINUTES
} from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { AgentPicker } from '../components/AgentPicker'
import { MAX_OPENCODE_MODEL_LENGTH, validateOpenCodeModel } from '../Sidebar/dialogLogic'
import { errorMessage } from '../../shared/guards'
import { OpencodeProbeRow } from './OpencodeProbeRow'

export interface AgentsSectionProps {
  readonly settings: AppSettings
  readonly actions: Pick<SessionActions, 'updateSettings'>
}

// D80: the two opt-in Jarvis features, off by default.
export const WATCH_LABEL = 'Watch the fleet'
export const WATCH_MINUTES_LABEL = 'Check every N minutes'
export const WATCH_HELP =
  "Jarvis checks your sessions on a timer and is told when one waits for you for 3+ minutes or looks stuck for 20+ minutes. Off by default. It uses Jarvis's model only when something needs attention."
export const PLANS_LABEL = 'Task plans'
export const PLANS_HELP =
  'Lets Jarvis split a goal into steps that run in several sessions (plan_create). Off by default. Turning it off cancels plans that are running; sessions already working are left alone.'
export const WATCH_MINUTES_MESSAGE = `Enter a whole number from ${MIN_WATCH_MINUTES} to ${MAX_WATCH_MINUTES}.`

/** The exact patch the "Watch the fleet" switch sends (exported so tests can check it without a DOM). */
export function watchEnabledPatch(enabled: boolean): SettingsPatch {
  return { jarvis: { watchEnabled: enabled } }
}

/** The exact patch the "Task plans" switch sends (exported so tests can check it without a DOM). */
export function plansEnabledPatch(enabled: boolean): SettingsPatch {
  return { jarvis: { plansEnabled: enabled } }
}

export interface WatchMinutesCommit {
  /** The patch to send, or null when the text is invalid or already the stored value. */
  readonly patch: SettingsPatch | null
  /** A user-facing message when the text is empty, not whole, or out of range, otherwise null. */
  readonly error: string | null
}

/**
 * Validates the "Check every N minutes" text on blur/Enter. A whole number from MIN_WATCH_MINUTES to
 * MAX_WATCH_MINUTES is accepted; anything else sends nothing (invalid), and the stored value sends nothing either.
 */
export function commitWatchMinutes(text: string, current: number): WatchMinutesCommit {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return { patch: null, error: WATCH_MINUTES_MESSAGE }
  const minutes = Number(trimmed)
  if (minutes < MIN_WATCH_MINUTES || minutes > MAX_WATCH_MINUTES) {
    return { patch: null, error: WATCH_MINUTES_MESSAGE }
  }
  if (minutes === current) return { patch: null, error: null }
  return { patch: { jarvis: { watchEveryMinutes: minutes } }, error: null }
}

export function AgentsSection({ settings, actions }: AgentsSectionProps): ReactElement {
  const { agents } = settings
  const [modelText, setModelText] = useState<string>(agents.opencodeModel)
  const [error, setError] = useState<string | null>(null)

  useEffect((): void => {
    setModelText(agents.opencodeModel)
  }, [agents.opencodeModel])

  // D53: Jarvis's Claude model (Sonnet by default).
  const [jarvisModel, setJarvisModel] = useState<string>(settings.jarvis.model)
  useEffect((): void => {
    setJarvisModel(settings.jarvis.model)
  }, [settings.jarvis.model])
  const jarvisModelError = JARVIS_MODEL_RE.test(jarvisModel.trim()) ? null : 'Use letters, digits and . _ : [ ] - only.'

  function commitJarvisModel(): void {
    const value = jarvisModel.trim()
    if (jarvisModelError !== null || value === settings.jarvis.model) return
    void applyPatch({ jarvis: { model: value } })
  }

  // D54: Jarvis on OpenCode and its model.
  const [jarvisOcModel, setJarvisOcModel] = useState<string>(settings.jarvis.opencodeModel)
  useEffect((): void => {
    setJarvisOcModel(settings.jarvis.opencodeModel)
  }, [settings.jarvis.opencodeModel])
  const jarvisOcValidation = validateOpenCodeModel(jarvisOcModel)
  const jarvisOcError = jarvisOcValidation.ok ? null : jarvisOcValidation.error

  function commitJarvisOcModel(): void {
    if (!jarvisOcValidation.ok || jarvisOcValidation.value === settings.jarvis.opencodeModel) return
    void applyPatch({ jarvis: { opencodeModel: jarvisOcValidation.value } })
  }

  const modelValidation = validateOpenCodeModel(modelText)
  const modelError = modelValidation.ok ? null : modelValidation.error

  // D80: "Watch the fleet" and its interval (committed on blur/Enter), plus the opt-in "Task plans".
  const [watchText, setWatchText] = useState<string>(String(settings.jarvis.watchEveryMinutes))
  const [watchError, setWatchError] = useState<string | null>(null)

  useEffect((): void => {
    setWatchText(String(settings.jarvis.watchEveryMinutes))
  }, [settings.jarvis.watchEveryMinutes])

  function commitWatchEveryMinutes(): void {
    const result = commitWatchMinutes(watchText, settings.jarvis.watchEveryMinutes)
    setWatchError(result.error)
    if (result.patch !== null) void applyPatch(result.patch)
  }

  async function applyPatch(patch: SettingsPatch): Promise<void> {
    setError(null)
    try {
      await actions.updateSettings(patch)
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }

  function commitModel(): void {
    const result = validateOpenCodeModel(modelText)
    if (!result.ok || result.value === agents.opencodeModel) {
      return
    }
    void applyPatch({ agents: { opencodeModel: result.value } })
  }

  function handleModelKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitModel()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <span className="text-[13px] font-medium text-foreground">
          Default agent for new sessions
        </span>
        <AgentPicker
          value={agents.defaultAgent}
          onChange={(agent): void => void applyPatch({ agents: { defaultAgent: agent } })}
          ariaLabel="Default agent for new sessions"
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        <Label htmlFor="agents-opencode-model" className="text-[13px] font-medium text-foreground">
          Default OpenCode model
        </Label>
        <Input
          id="agents-opencode-model"
          type="text"
          value={modelText}
          onChange={(event): void => setModelText(event.target.value)}
          onBlur={commitModel}
          onKeyDown={handleModelKeyDown}
          placeholder="provider/model, e.g. opencode/deepseek-v4.1-flash-free"
          maxLength={MAX_OPENCODE_MODEL_LENGTH}
          aria-label="Default OpenCode model"
          aria-invalid={modelError !== null}
          className="text-xs"
        />
        {modelError !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {modelError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Empty uses OpenCode&apos;s own default model. Used only for OpenCode sessions.
          </p>
        )}
      </div>

      <OpencodeProbeRow />

      <div className="flex flex-col gap-1" data-opencode-plugin-health="">
        <p className="text-xs text-muted-foreground">
          The injected OpenCode plugin reports a session&apos;s status. If it does not load, that session&apos;s card shows
          &quot;Status unavailable: the OpenCode plugin did not load&quot;; the session still runs.
        </p>
      </div>

      <Separator />

      <div className="space-y-1.5">
        <span className="text-[13px] font-medium text-foreground">Jarvis engine</span>
        <AgentPicker
          value={settings.jarvis.agent}
          onChange={(agent): void => {
            if (agent === 'claude' || agent === 'opencode') void applyPatch({ jarvis: { agent } })
          }}
          ariaLabel="Jarvis engine"
        />
        <p className="text-xs text-muted-foreground">
          Which agent runs Jarvis. OpenCode allows cheaper or free models. Changing it starts a new Jarvis conversation
          the next time you open Jarvis.
        </p>
      </div>

      {settings.jarvis.agent === 'opencode' ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="agents-jarvis-opencode-model" className="text-[13px] font-medium text-foreground">
            Jarvis OpenCode model
          </Label>
          <Input
            id="agents-jarvis-opencode-model"
            type="text"
            value={jarvisOcModel}
            onChange={(event): void => setJarvisOcModel(event.target.value)}
            onBlur={commitJarvisOcModel}
            onKeyDown={(event): void => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitJarvisOcModel()
              }
            }}
            placeholder="provider/model, e.g. opencode/deepseek-v4.1-flash-free"
            maxLength={MAX_OPENCODE_MODEL_LENGTH}
            aria-label="Jarvis OpenCode model"
            aria-invalid={jarvisOcError !== null}
            className="text-xs"
          />
          {jarvisOcError !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {jarvisOcError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Empty uses OpenCode&apos;s own default. Changing it starts a new Jarvis conversation.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor="agents-jarvis-model" className="text-[13px] font-medium text-foreground">
          Jarvis model (Claude)
        </Label>
        <Input
          id="agents-jarvis-model"
          type="text"
          value={jarvisModel}
          onChange={(event): void => setJarvisModel(event.target.value)}
          onBlur={commitJarvisModel}
          onKeyDown={(event): void => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitJarvisModel()
            }
          }}
          placeholder="sonnet"
          maxLength={JARVIS_MODEL_MAX}
          aria-label="Jarvis model"
          aria-invalid={jarvisModelError !== null}
          className="text-xs"
        />
        {jarvisModelError !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {jarvisModelError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Claude model for Jarvis: sonnet, opus, haiku or a full model id. Empty uses Claude&apos;s default. Applies
            the next time Jarvis starts.
          </p>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="agents-jarvis-watch" className="text-[13px] font-medium text-foreground">
            {WATCH_LABEL}
          </Label>
          <Switch
            id="agents-jarvis-watch"
            aria-label={WATCH_LABEL}
            checked={settings.jarvis.watchEnabled}
            onCheckedChange={(checked: boolean): void => void applyPatch(watchEnabledPatch(checked))}
          />
        </div>
        <p className="text-xs text-muted-foreground">{WATCH_HELP}</p>
      </div>

      {settings.jarvis.watchEnabled ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="agents-jarvis-watch-minutes" className="text-[13px] font-medium text-foreground">
            {WATCH_MINUTES_LABEL}
          </Label>
          <Input
            id="agents-jarvis-watch-minutes"
            type="number"
            min={MIN_WATCH_MINUTES}
            max={MAX_WATCH_MINUTES}
            step={1}
            required
            value={watchText}
            onChange={(event): void => setWatchText(event.target.value)}
            onBlur={commitWatchEveryMinutes}
            onKeyDown={(event): void => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitWatchEveryMinutes()
              }
            }}
            aria-label={WATCH_MINUTES_LABEL}
            aria-invalid={watchError !== null}
            className="w-24 text-xs"
          />
          {watchError !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {watchError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="agents-jarvis-plans" className="text-[13px] font-medium text-foreground">
            {PLANS_LABEL}
          </Label>
          <Switch
            id="agents-jarvis-plans"
            aria-label={PLANS_LABEL}
            checked={settings.jarvis.plansEnabled}
            onCheckedChange={(checked: boolean): void => void applyPatch(plansEnabledPatch(checked))}
          />
        </div>
        <p className="text-xs text-muted-foreground">{PLANS_HELP}</p>
      </div>

      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
