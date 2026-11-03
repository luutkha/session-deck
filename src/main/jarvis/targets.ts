// Which session (or group, status) Jarvis means (D53). The model names things the way the user does; an id always
// wins, then an exact name, then a unique partial name. Ambiguity is an error that lists the candidates, so Jarvis
// asks the user instead of guessing. Jarvis itself is never a target.
import type { Group, Repo, Session, StatusDef, StoreData, Worktree } from '../../shared/types'

export function isJarvis(session: Pick<Session, 'role'>): boolean {
  return session.role === 'jarvis'
}

function norm(text: string): string {
  return text.trim().toLowerCase()
}

/** Finds one item by id, exact name (case-insensitive), or a unique name that contains the text. */
function pick<T extends { readonly id: string; readonly name: string }>(items: readonly T[], ref: string, kind: string): T {
  const text = norm(ref)
  if (text.length === 0) throw new Error(`Say which ${kind}.`)
  const byId = items.find((item) => item.id === ref.trim())
  if (byId !== undefined) return byId
  const exact = items.filter((item) => norm(item.name) === text)
  if (exact.length === 1) return exact[0]
  const partial = exact.length > 1 ? exact : items.filter((item) => norm(item.name).includes(text))
  if (partial.length === 1) return partial[0]
  if (partial.length === 0) throw new Error(`No ${kind} matches "${ref}".`)
  const listed = partial.slice(0, 10).map((item) => `"${item.name}" (id ${item.id})`).join(', ')
  throw new Error(`"${ref}" matches ${partial.length} ${kind}s: ${listed}. Ask the user which one, then pass its id.`)
}

/** The sessions Jarvis may act on: every session except Jarvis. */
export function targetSessions(data: StoreData): readonly Session[] {
  return data.sessions.filter((session) => !isJarvis(session))
}

export function resolveSession(data: StoreData, ref: unknown): Session {
  if (typeof ref !== 'string') throw new Error('Say which session (its name or id).')
  return pick(targetSessions(data), ref, 'session')
}

export function resolveGroup(data: StoreData, ref: string): Group {
  return pick(data.groups, ref, 'group')
}

export function resolveStatus(data: StoreData, ref: string): StatusDef {
  return pick(data.statuses, ref, 'status')
}

export function resolveRepo(data: StoreData, ref: string): Repo {
  const repos = data.repos ?? []
  const want = ref.trim().toLowerCase()
  const found = repos.filter((r) => r.id === ref.trim() || r.name.toLowerCase() === want || r.path.toLowerCase() === want)
  if (found.length === 1) return found[0]
  if (found.length === 0) throw new Error(`No repository matches "${ref}". Repositories: ${repos.map((r) => `"${r.name}"`).join(', ') || '(none; use add_repo)'}`)
  throw new Error(`"${ref}" matches several repositories: ${found.map((r) => `"${r.name}" (${r.path})`).join(', ')}. Pass the path or id.`)
}

export function resolveWorktree(data: StoreData, ref: string): Worktree {
  const worktrees = data.worktrees ?? []
  const want = ref.trim().toLowerCase()
  const found = worktrees.filter((w) => w.id === ref.trim() || w.name.toLowerCase() === want || w.branch.toLowerCase() === want)
  if (found.length === 1) return found[0]
  if (found.length === 0) throw new Error(`No worktree matches "${ref}".`)
  throw new Error(`"${ref}" matches several worktrees: ${found.map((w) => `"${w.name}" (id ${w.id})`).join(', ')}. Pass the id.`)
}
