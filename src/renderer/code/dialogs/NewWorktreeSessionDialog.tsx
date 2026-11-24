// New session in an existing worktree (Code mode, D31): agent + model only, the folder is the worktree. Orca look.
import { useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import type { AgentKind, AppSettings, Id, Worktree } from '../../../shared/types'
import type { SessionActions } from '../../state/useSessionStore'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../components/ui/dialog'
import { initialModelForAgent, modelAfterAgentChange } from '../../Sidebar/dialogLogic'
import { cleanErrorMessage } from '../sidebar/errorText'
import { SessionAgentFields } from './SessionAgentFields'
import { checkModel, worktreeSessionInput } from './worktreeDialogLogic'

export interface NewWorktreeSessionDialogProps {
  readonly worktree: Worktree
  readonly settings: AppSettings
  readonly actions: SessionActions
  readonly onClose: () => void
  /** The session was created: open its tab. */
  readonly onCreated: (sessionId: Id) => void
}

const ID_PREFIX = 'new-worktree-session'

export function NewWorktreeSessionDialog(props: NewWorktreeSessionDialogProps): ReactElement {
  const { worktree, settings, actions, onClose, onCreated } = props
  const [agent, setAgent] = useState<AgentKind>(settings.agents.defaultAgent)
  const [model, setModel] = useState(
    (): string => initialModelForAgent(settings.agents.defaultAgent, settings.agents.opencodeModel)
  )
  const [creating, setCreating] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const modelCheck = checkModel(agent, model)
  const canCreate = modelCheck.ok && !creating

  function changeAgent(next: AgentKind): void {
    setModel((current) => modelAfterAgentChange(agent, next, current, settings.agents.opencodeModel))
    setAgent(next)
  }

  async function submit(): Promise<void> {
    if (!canCreate || !modelCheck.ok) return
    setCreating(true)
    setSubmitError(null)
    try {
      const session = await actions.createSession(worktreeSessionInput(worktree, agent, modelCheck.model))
      onCreated(session.id)
      onClose()
    } catch (error) {
      console.error('[code] create worktree session failed:', error)
      setSubmitError(cleanErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void submit()
  }

  function handleFormKeyDown(event: KeyboardEvent<HTMLFormElement>): void {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
    // Enter submits from any text field, once.
    event.preventDefault()
    void submit()
  }

  return (
    <Dialog
      open
      onOpenChange={(open: boolean): void => {
        if (!open && !creating) onClose()
      }}
    >
      <DialogContent data-testid="new-worktree-session-dialog" className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">New session in {worktree.name}</DialogTitle>
          <DialogDescription className="text-xs">
            Starts a session inside this worktree&apos;s folder. The worktree itself is unchanged.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
          <SessionAgentFields
            idPrefix={ID_PREFIX}
            agent={agent}
            onAgentChange={changeAgent}
            model={model}
            onModelChange={setModel}
            modelError={modelCheck.ok ? null : modelCheck.error}
            disabled={creating}
          />
          <p className="break-all font-mono text-[11px] text-muted-foreground" data-testid="new-worktree-path">
            {worktree.path}
          </p>
          {submitError !== null && (
            <p role="alert" className="text-xs text-destructive">{submitError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" className="text-xs" onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="text-xs" disabled={!canCreate}>
              {creating ? 'Starting…' : 'Start session'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
