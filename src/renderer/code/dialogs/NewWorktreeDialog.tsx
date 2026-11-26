// New worktree dialog (Code mode, D31): a branch + folder from a repo, and its first agent session. Orca dialog look.
// D57: start from a new branch, an existing branch (not open elsewhere), or the repo's own folder.
import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import { WORKTREE_NAME_MAX, type AgentKind, type AppSettings, type Id, type Repo, type Session, type Worktree, type WorktreeSource } from '../../../shared/types'
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
import { initialModelForAgent, modelAfterAgentChange } from '../../Sidebar/dialogLogic'
import { cleanErrorMessage } from '../sidebar/errorText'
import { BaseBranchSelect } from './BaseBranchSelect'
import { INPUT_CLASS, LABEL_CLASS, SessionAgentFields } from './SessionAgentFields'
import { useWorktreeBranches } from './useWorktreeBranches'
import { checkModel, compareBaseFor, existingBranchChoices, firstFreeBranch, openRepoFolder, validateWorktreeName, worktreePathHint } from './worktreeDialogLogic'

export interface NewWorktreeDialogProps {
  readonly repos: readonly Repo[]
  /** D57: the stored worktrees (to know whether the repo folder is already open). */
  readonly worktrees: readonly Worktree[]
  /** Preselected repo; undefined = the first repo. */
  readonly defaultRepoId?: Id
  readonly settings: AppSettings
  /** D88: an Ops session that moves into the new worktree (no first session is started; the agent fields are hidden). */
  readonly moveSession?: Session
  readonly onClose: () => void
  /** The worktree was created and its first session started: open that session's tab. */
  readonly onCreated: (sessionId: Id) => void
}

const NAME_ID_PREFIX = 'new-worktree'

const SOURCES: readonly { readonly value: WorktreeSource; readonly label: string; readonly hint: string }[] = [
  { value: 'new', label: 'New branch', hint: 'Creates a branch and its own folder. A taken name gets -2, -3 ...' },
  { value: 'existing', label: 'Existing branch', hint: 'Opens a branch you already have in its own folder.' },
  { value: 'main', label: 'Repo folder', hint: 'Runs in the repository folder itself, on its checked-out branch. Nothing is created.' }
]

/** The chosen repo when it still exists, else the first repo, else null. */
function resolveRepoId(repos: readonly Repo[], choice: Id | null): Id | null {
  if (choice !== null && repos.some((repo): boolean => repo.id === choice)) return choice
  return repos[0]?.id ?? null
}

export function NewWorktreeDialog(props: NewWorktreeDialogProps): ReactElement {
  const { repos, worktrees, defaultRepoId, settings, moveSession, onClose, onCreated } = props
  const [repoChoice, setRepoChoice] = useState<Id | null>(defaultRepoId ?? null)
  const [source, setSource] = useState<WorktreeSource>('new')
  const [existingChoice, setExistingChoice] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [agent, setAgent] = useState<AgentKind>(settings.agents.defaultAgent)
  const [model, setModel] = useState(
    (): string => initialModelForAgent(settings.agents.defaultAgent, settings.agents.opencodeModel)
  )
  const [creating, setCreating] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  const repoId = resolveRepoId(repos, repoChoice)
  const repo = repos.find((candidate): boolean => candidate.id === repoId) ?? null
  const branches = useWorktreeBranches(repoId)
  const choices = existingBranchChoices(branches.branches, branches.checkedOut)
  const existingBranch = existingChoice !== null && choices.some((c) => c.branch === existingChoice && c.openIn === null)
    ? existingChoice
    : firstFreeBranch(choices)
  const repoFolderOpen = openRepoFolder(worktrees, repoId)
  // An existing branch is named after itself unless the user typed a name; the repo folder after the repo.
  const effectiveName = source === 'main' ? (repo?.name ?? '') : source === 'existing' && name.trim() === '' ? (existingBranch ?? '') : name
  const nameCheck = validateWorktreeName(effectiveName)
  const modelCheck = checkModel(agent, model)
  const baseBranch = source === 'existing'
    ? compareBaseFor(existingBranch, branches.base, branches.branches)
    : source === 'main' ? (branches.current ?? branches.base) : branches.base
  const sourceReady =
    source === 'new' ? true : source === 'existing' ? existingBranch !== null : repoFolderOpen === null
  const canCreate =
    repo !== null &&
    baseBranch !== null &&
    !branches.loading &&
    branches.error === null &&
    nameCheck.ok &&
    modelCheck.ok &&
    sourceReady &&
    !creating

  function changeAgent(next: AgentKind): void {
    setModel((current) => modelAfterAgentChange(agent, next, current, settings.agents.opencodeModel))
    setAgent(next)
  }

  async function submit(): Promise<void> {
    if (!canCreate || repoId === null || baseBranch === null || !nameCheck.ok || !modelCheck.ok) return
    setCreating(true)
    setSubmitError(null)
    try {
      const result = await window.api.createWorktree({
        repoId,
        name: nameCheck.value,
        baseBranch,
        ...(source !== 'new' ? { source } : {}),
        ...(source === 'existing' && existingBranch !== null ? { branch: existingBranch } : {}),
        agent,
        ...(moveSession !== undefined ? { moveSessionId: moveSession.id } : {}),
        ...(modelCheck.model !== undefined && moveSession === undefined ? { model: modelCheck.model } : {})
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
            <span className={LABEL_CLASS}>Start from</span>
            <div role="group" aria-label="Start from" className="flex items-center rounded-md border border-border p-0.5">
              {SOURCES.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={source === option.value ? 'secondary' : 'ghost'}
                  size="xs"
                  aria-pressed={source === option.value}
                  data-worktree-source={option.value}
                  disabled={creating}
                  className="flex-1 text-[11px]"
                  onClick={(): void => setSource(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{SOURCES.find((o) => o.value === source)?.hint}</p>
          </div>
          {source === 'existing' && (
            <div className="space-y-1">
              <Label htmlFor={`${NAME_ID_PREFIX}-branch`} className={LABEL_CLASS}>Branch</Label>
              <Select
                value={existingBranch ?? ''}
                disabled={creating || branches.loading || choices.length === 0}
                onValueChange={(value): void => setExistingChoice(value)}
              >
                <SelectTrigger id={`${NAME_ID_PREFIX}-branch`} aria-label="Branch" size="sm" className="w-full text-xs">
                  <SelectValue placeholder={branches.loading ? 'Loading branches...' : 'No free branch'} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {choices.map((choice) => (
                    <SelectItem key={choice.branch} value={choice.branch} disabled={choice.openIn !== null} className="text-xs">
                      {choice.branch}
                      {choice.openIn !== null ? ` (open in ${choice.openIn})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!branches.loading && existingBranch === null ? (
                <p role="alert" className="text-[11px] text-muted-foreground">Every branch is already open in a worktree. Git allows a branch in one worktree only.</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">Branches already open in another folder cannot be opened twice (git allows one worktree per branch).</p>
              )}
            </div>
          )}
          {source === 'main' ? (
            <div className="space-y-1" data-testid="new-worktree-main">
              {repoFolderOpen !== null ? (
                <p role="alert" className="text-[11px] text-muted-foreground">The repository folder is already open as "{repoFolderOpen.name}". Add a session to it from its row instead.</p>
              ) : (
                <p className="break-all text-[11px] text-muted-foreground">
                  Sessions run in <span className="font-mono">{repo?.path ?? ''}</span>
                  {branches.current !== null ? <> on branch <span className="font-mono">{branches.current}</span></> : null}.
                </p>
              )}
            </div>
          ) : (
          <div className="space-y-1">
            <Label htmlFor={`${NAME_ID_PREFIX}-name`} className={LABEL_CLASS}>Name</Label>
            <Input
              id={`${NAME_ID_PREFIX}-name`}
              ref={nameInputRef}
              name="worktree-name"
              type="text"
              value={name}
              onChange={(event): void => setName(event.target.value)}
              placeholder={source === 'existing' ? (existingBranch ?? 'name') : 'fix-login'}
              maxLength={WORKTREE_NAME_MAX}
              disabled={creating}
              aria-invalid={!nameCheck.ok}
              className={INPUT_CLASS}
            />
            {!nameCheck.ok && <p role="alert" className="text-[11px] text-muted-foreground">{nameCheck.error}</p>}
          </div>
          )}
          {source === 'new' && (
            <BaseBranchSelect
              idPrefix={NAME_ID_PREFIX}
              branches={branches.branches}
              value={branches.base}
              loading={branches.loading || creating}
              error={branches.error}
              onChange={branches.chooseBase}
            />
          )}
          {moveSession === undefined && <SessionAgentFields
            idPrefix={NAME_ID_PREFIX}
            agent={agent}
            onAgentChange={changeAgent}
            model={model}
            onModelChange={setModel}
            modelError={modelCheck.ok ? null : modelCheck.error}
            disabled={creating}
          />}
          {moveSession !== undefined && (
            <p className="text-xs text-muted-foreground" data-testid="new-worktree-move-note">
              “{moveSession.name}” moves into this worktree and restarts there with a new conversation.
            </p>
          )}
          {source !== 'main' && (
            <p className="break-all font-mono text-[11px] text-muted-foreground" data-testid="new-worktree-path">
              {worktreePathHint(settings.code.worktreesRoot, repo?.name ?? '<repo>', effectiveName)}
            </p>
          )}
          {submitError !== null && (
            <p role="alert" className="text-xs text-destructive">{submitError}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" className="text-xs" onClick={onClose} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="text-xs" disabled={!canCreate}>
              {creating ? 'Creating…' : moveSession !== undefined ? 'Create and move' : source === 'main' ? 'Open repo folder' : 'Create worktree'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
