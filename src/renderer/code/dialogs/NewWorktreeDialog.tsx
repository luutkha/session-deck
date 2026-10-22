// New worktree dialog (Code mode, D31): a branch + folder from a repo, and its first agent session. Orca dialog look.
import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import { WORKTREE_NAME_MAX, type AgentKind, type AppSettings, type Id, type Repo } from '../../../shared/types'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { cleanErrorMessage } from '../sidebar/errorText'
import { BaseBranchSelect } from './BaseBranchSelect'
import { INPUT_CLASS, LABEL_CLASS, SessionAgentFields } from './SessionAgentFields'
import { useWorktreeBranches } from './useWorktreeBranches'
import { checkModel, validateWorktreeName, worktreePathHint } from './worktreeDialogLogic'

export interface NewWorktreeDialogProps {
  readonly repos: readonly Repo[]
  /** Preselected repo; undefined = the first repo. */
  readonly defaultRepoId?: Id
  readonly settings: AppSettings
  readonly onClose: () => void
  /** The worktree was created and its first session started: open that session's tab. */
  readonly onCreated: (sessionId: Id) => void
}

const NAME_ID_PREFIX = 'new-worktree'

/** The chosen repo when it still exists, else the first repo, else null. */
function resolveRepoId(repos: readonly Repo[], choice: Id | null): Id | null {
  if (choice !== null && repos.some((repo): boolean => repo.id === choice)) return choice
  return repos[0]?.id ?? null
}

export function NewWorktreeDialog(props: NewWorktreeDialogProps): ReactElement {
  const { repos, defaultRepoId, settings, onClose, onCreated } = props
  const [repoChoice, setRepoChoice] = useState<Id | null>(defaultRepoId ?? null)
  const [name, setName] = useState('')
  const [agent, setAgent] = useState<AgentKind>(settings.agents.defaultAgent)
  const [model, setModel] = useState(settings.agents.opencodeModel)
  const [creating, setCreating] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  const repoId = resolveRepoId(repos, repoChoice)
  const repo = repos.find((candidate): boolean => candidate.id === repoId) ?? null
  const branches = useWorktreeBranches(repoId)
  const nameCheck = validateWorktreeName(name)
  const modelCheck = checkModel(agent, model)
  const canCreate =
    repo !== null &&
    branches.base !== null &&
    !branches.loading &&
    branches.error === null &&
    nameCheck.ok &&
    modelCheck.ok &&
    !creating

  async function submit(): Promise<void> {
    if (!canCreate || repoId === null || branches.base === null || !nameCheck.ok || !modelCheck.ok) return
    setCreating(true)
    setSubmitError(null)
    try {
      const result = await window.api.createWorktree({
        repoId,
        name: nameCheck.value,
        baseBranch: branches.base,
        agent,
        ...(modelCheck.model !== undefined ? { model: modelCheck.model } : {})
      })
      onCreated(result.session.id)
      onClose()
    } catch (error) {
      console.error('[code] create worktree failed:', error)
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
      <DialogContent
        data-testid="new-worktree-dialog"
        className="max-w-md sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          nameInputRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">New worktree</DialogTitle>
          <DialogDescription className="text-xs">
            Creates a branch and its own folder from a repository, then starts the first session in it.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
          {repos.length > 1 && (
            <div className="space-y-1">
              <Label htmlFor={`${NAME_ID_PREFIX}-repo`} className={LABEL_CLASS}>Repository</Label>
              <Select value={repoId ?? ''} disabled={creating} onValueChange={(value): void => setRepoChoice(value)}>
                <SelectTrigger id={`${NAME_ID_PREFIX}-repo`} aria-label="Repository" size="sm" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {repos.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id} className="text-xs">
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={`${NAME_ID_PREFIX}-name`} className={LABEL_CLASS}>Name</Label>
            <Input
              id={`${NAME_ID_PREFIX}-name`}
              ref={nameInputRef}
              name="worktree-name"
              type="text"
              value={name}
              onChange={(event): void => setName(event.target.value)}
              placeholder="fix-login"
              maxLength={WORKTREE_NAME_MAX}
              disabled={creating}
              aria-invalid={!nameCheck.ok}
              className={INPUT_CLASS}
            />
            {!nameCheck.ok && <p role="alert" className="text-[11px] text-muted-foreground">{nameCheck.error}</p>}
          </div>
          <BaseBranchSelect
            idPrefix={NAME_ID_PREFIX}
            branches={branches.branches}
            value={branches.base}
            loading={branches.loading || creating}
            error={branches.error}
            onChange={branches.chooseBase}
          />
          <SessionAgentFields
            idPrefix={NAME_ID_PREFIX}
            agent={agent}
            onAgentChange={setAgent}
            model={model}
            onModelChange={setModel}
            modelError={modelCheck.ok ? null : modelCheck.error}
            disabled={creating}
          />
          <p className="break-all font-mono text-[11px] text-muted-foreground" data-testid="new-worktree-path">
            {worktreePathHint(settings.code.worktreesRoot, repo?.name ?? '<repo>', name)}
          </p>
          {submitError !== null && (
            <p role="alert" className="text-xs text-destructive">{submitError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" className="text-xs" onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="text-xs" disabled={!canCreate}>
              {creating ? 'Creating…' : 'Create worktree'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
