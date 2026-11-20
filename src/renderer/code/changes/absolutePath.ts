// D74: the absolute path of a file in the Changes list, for the side-panel viewer. Changed paths are relative to the
// worktree root with forward slashes; the viewer gets a Windows path (and main re-checks it for the session anyway).
import { fileViewKindFor } from '../../../shared/fileViewKind'

/** Joins a worktree root and a changed file's relative path with backslashes. */
export function absoluteChangedPath(worktreePath: string, path: string): string {
  const target = path.trim().replace(/\//g, '\\')
  // Defensive: an already absolute worktree-relative path (a drive or a UNC share) is kept as given.
  if (/^[a-zA-Z]:\\/.test(target) || target.startsWith('\\\\')) return target
  const root = worktreePath.trim().replace(/[\\/]+$/, '')
  const rest = target.replace(/^\\+/, '')
  return root === '' ? rest : `${root}\\${rest}`
}

/** True when a changed file can open in the viewer: the file still exists and the viewer knows its type. */
export function canOpenInViewer(file: { readonly path: string; readonly kind: string }): boolean {
  return file.kind !== 'deleted' && fileViewKindFor(file.path) !== null
}
