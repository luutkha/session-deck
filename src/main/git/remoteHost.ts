// D60: a remote URL → the host's "new pull request" page for a branch. Pure (no IO).
// GitHub (incl. GitHub Enterprise hosts named *github*), GitLab (gitlab.com or *gitlab* hosts) and Bitbucket Cloud.
// Any other host returns null: SessionDeck does not guess URLs it cannot vouch for.

export type RemoteHostKind = 'github' | 'gitlab' | 'bitbucket'

export interface RemoteRepo {
  readonly kind: RemoteHostKind
  /** https origin, e.g. https://github.com */
  readonly origin: string
  /** owner/repo (GitLab: group/subgroup/repo) without .git */
  readonly path: string
}

const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/

function hostKind(host: string): RemoteHostKind | null {
  const h = host.toLowerCase()
  if (h === 'bitbucket.org') return 'bitbucket'
  if (h.includes('github')) return 'github'
  if (h.includes('gitlab')) return 'gitlab'
  return null
}

function cleanPath(raw: string): string | null {
  const trimmed = raw.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '')
  const parts = trimmed.split('/').filter((part) => part.length > 0)
  return parts.length >= 2 ? parts.join('/') : null
}

/** https://host/owner/repo(.git), ssh://git@host[:port]/owner/repo.git, git@host:owner/repo.git → the repo; else null. */
export function parseRemoteUrl(url: string): RemoteRepo | null {
  const text = url.trim()
  let host: string
  let repoPath: string
  const scp = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? null : SCP_LIKE.exec(text)
  if (scp !== null) {
    host = scp[1]
    repoPath = scp[2]
  } else {
    let parsed: URL
    try {
      parsed = new URL(text)
    } catch {
      return null
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(parsed.protocol)) return null
    host = parsed.hostname
    repoPath = decodeURIComponent(parsed.pathname)
  }
  const kind = hostKind(host)
  const cleaned = cleanPath(repoPath)
  if (kind === null || cleaned === null) return null
  return { kind, origin: `https://${host.toLowerCase()}`, path: cleaned }
}

const enc = encodeURIComponent

/** The host's page to open a pull/merge request from `branch` into `base`; null for an unknown host. */
export function compareUrl(remoteUrl: string, base: string, branch: string): string | null {
  const repo = parseRemoteUrl(remoteUrl)
  if (repo === null) return null
  const root = `${repo.origin}/${repo.path}`
  if (repo.kind === 'github') {
    // Branch names keep their slashes in GitHub's compare path.
    const ref = (name: string): string => name.split('/').map(enc).join('/')
    return `${root}/compare/${ref(base)}...${ref(branch)}?expand=1`
  }
  if (repo.kind === 'gitlab') {
    return `${root}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${enc(branch)}&merge_request%5Btarget_branch%5D=${enc(base)}`
  }
  return `${root}/pull-requests/new?source=${enc(branch)}&dest=${enc(base)}`
}
