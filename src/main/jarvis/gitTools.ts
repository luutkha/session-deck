// Jarvis tools for Code mode git work (D60): branch status, commit, push, pull request, merge. They call the same
// codeGitOps as the Changes panel. Push, pull request and merge ask the user first; commit is local and does not.
import type { McpTool } from './mcpProtocol'
import type { JarvisToolDeps } from './jarvisTools'
import { resolveWorktree } from './targets'
import { optionalText, schema, text } from './toolArgs'

const WORKTREE_PROP = { type: 'string', description: 'Worktree name, branch or id.' }

export function createGitTools(deps: JarvisToolDeps): McpTool[] {
  // Read on each call: Jarvis's tools are built before Code mode's wiring exists (index.ts passes a getter).
  const git = (): JarvisToolDeps['code']['git'] => deps.code.git
  const worktreeOf = (args: Readonly<Record<string, unknown>>): ReturnType<typeof resolveWorktree> =>
    resolveWorktree(deps.getData(), text(args, 'worktree'))

  return [
    {
      name: 'branch_status',
      description: 'Code mode: where a worktree\'s branch stands: uncommitted files, commits to push (ahead) and commits on the remote it lacks (behind, as of the last fetch), its remote and upstream, and whether a pull request would be made by the GitHub CLI or opened in the browser.',
      inputSchema: schema({ worktree: WORKTREE_PROP }, ['worktree']),
      run: async (args) => {
        const worktree = worktreeOf(args)
        const s = await git().branchStatus(worktree.id)
        if (s.error !== undefined) throw new Error(`Could not read the branch of "${worktree.name}": ${s.error}`)
        const pr = s.compareUrl === null ? 'no pull request page (no remote or unknown host)' : s.ghReady ? 'Create PR uses the GitHub CLI' : `Create PR opens ${s.compareUrl}`
        return `"${worktree.name}": branch ${s.branch ?? '(detached)'} (base ${s.baseBranch}${s.repoFolder ? ', repository folder' : ''}); ${s.uncommitted} uncommitted file(s); ` +
          `${s.remote === null ? 'no remote' : s.upstream === null ? `never pushed to ${s.remote}, ${s.ahead} commit(s) to push` : `upstream ${s.upstream}: ${s.ahead} ahead, ${s.behind} behind`}; ${pr}.`
      }
    },
    {
      name: 'commit_worktree',
      description: 'Code mode: commits files of a worktree with the given message (local only, nothing is pushed). files = paths from worktree_changes that are marked uncommitted; omit it to commit every uncommitted file in the list. Write a short, real commit message (conventional style is fine).',
      inputSchema: schema({
        worktree: WORKTREE_PROP,
        message: { type: 'string', description: 'The commit message (first line = summary).' },
        files: { type: 'array', items: { type: 'string' }, description: 'Paths to commit (default: all uncommitted).' }
      }, ['worktree', 'message']),
      run: async (args) => {
        const worktree = worktreeOf(args)
        let paths: string[]
        if (args.files !== undefined) {
          if (!Array.isArray(args.files) || args.files.some((p) => typeof p !== 'string')) throw new Error('"files" must be a list of paths.')
          paths = args.files as string[]
        } else {
          const changes = await deps.code.changes(worktree.id)
          if (changes.error !== undefined) throw new Error(`Could not read the changes of "${worktree.name}": ${changes.error}`)
          paths = changes.files.filter((f) => f.uncommitted === true).map((f) => f.path)
        }
        if (paths.length === 0) return `"${worktree.name}" has nothing uncommitted. Nothing was committed.`
        const result = await git().commit({ worktreeId: worktree.id, message: text(args, 'message'), paths })
        deps.log('commit_worktree', `${worktree.name}: ${result.subject} (${result.files} file(s))`)
        return `Committed ${result.files} file(s) in "${worktree.name}" as ${result.sha.slice(0, 7)} "${result.subject}". Not pushed yet.`
      }
    },
    {
      name: 'push_worktree',
      description: 'Code mode: pushes a worktree\'s branch to its remote (git push -u; never forced). The user is asked to confirm.',
      inputSchema: schema({ worktree: WORKTREE_PROP }, ['worktree']),
      run: async (args) => {
        const worktree = worktreeOf(args)
        const s = await git().branchStatus(worktree.id)
        const yes = await deps.confirm({ title: 'Jarvis: push', message: `Jarvis wants to push branch ${s.branch ?? worktree.branch} of “${worktree.name}” to ${s.remote ?? 'its remote'} (${s.ahead} commit(s)).`, confirmLabel: 'Push' })
        if (!yes) return `The user did not allow pushing "${worktree.name}". Nothing was pushed.`
        const result = await git().push(worktree.id)
        deps.log('push_worktree', `${worktree.name}: ${result.branch} -> ${result.remote}`)
        return `Pushed ${result.branch} to ${result.remote}.`
      }
    },
    {
      name: 'create_pr',
      description: 'Code mode: opens a pull request for a worktree\'s branch into its base branch (pushes first when needed). With the GitHub CLI signed in it creates the PR (title/body optional: default the last commit and the commit list); otherwise it opens the host\'s new-pull-request page in the browser (GitHub, GitLab, Bitbucket). The user is asked to confirm.',
      inputSchema: schema({ worktree: WORKTREE_PROP, title: { type: 'string' }, body: { type: 'string' } }, ['worktree']),
      run: async (args) => {
        const worktree = worktreeOf(args)
        const s = await git().branchStatus(worktree.id)
        const how = s.ghReady ? 'create it with the GitHub CLI' : 'open the pull request page in the browser'
        const yes = await deps.confirm({ title: 'Jarvis: pull request', message: `Jarvis wants to push “${worktree.name}” (if needed) and ${how}: ${s.branch ?? worktree.branch} into ${s.baseBranch}.`, confirmLabel: 'Open PR' })
        if (!yes) return `The user did not allow the pull request for "${worktree.name}". Nothing was pushed or opened.`
        const title = optionalText(args, 'title')
        const body = optionalText(args, 'body')
        const result = await git().createPr(worktree.id, { ...(title !== undefined ? { title } : {}), ...(body !== undefined ? { body } : {}) })
        deps.log('create_pr', `${worktree.name}: ${result.url}`)
        return result.created ? `Pull request created: ${result.url}` : `Opened the pull request page in the browser: ${result.url} (the user finishes it there).`
      }
    },
    {
      name: 'merge_worktree',
      description: 'Code mode: merges a worktree\'s branch into its base branch in the repository folder (git merge --no-ff). Needs everything committed, the base branch checked out and clean in the repository folder; a conflict is undone and its files listed. The user is asked to confirm.',
      inputSchema: schema({ worktree: WORKTREE_PROP }, ['worktree']),
      run: async (args) => {
        const worktree = worktreeOf(args)
        const yes = await deps.confirm({ title: 'Jarvis: merge', message: `Jarvis wants to merge branch ${worktree.branch} (“${worktree.name}”) into ${worktree.baseBranch} in the repository folder.`, confirmLabel: 'Merge' })
        if (!yes) return `The user did not allow merging "${worktree.name}". Nothing was changed.`
        const result = await git().merge(worktree.id)
        deps.log('merge_worktree', `${worktree.name}: ${result.message}`)
        return result.conflicts !== undefined ? `${result.message}\nConflicting files: ${result.conflicts.join(', ')}` : result.message
      }
    }
  ]
}
