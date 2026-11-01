import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { AppSettings, SettingsPatch } from '../../shared/types'
import { JARVIS_MODEL_MAX, JARVIS_MODEL_RE } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { AgentPicker } from '../components/AgentPicker'
import { MAX_OPENCODE_MODEL_LENGTH, validateOpenCodeModel } from '../Sidebar/dialogLogic'
import { errorMessage } from '../../shared/guards'

export interface AgentsSectionProps {
  readonly settings: AppSettings
  readonly actions: Pick<SessionActions, 'updateSettings'>
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

  const modelValidation = validateOpenCodeModel(modelText)
  const modelError = modelValidation.ok ? null : modelValidation.error

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

      <Separator />

      <div className="flex flex-col gap-1">
        <Label htmlFor="agents-jarvis-model" className="text-[13px] font-medium text-foreground">
          Jarvis model
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

      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
