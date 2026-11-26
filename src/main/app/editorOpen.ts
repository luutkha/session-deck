// D89: open a changed file in the user's editor at a line. VS Code (`code --goto file:line`) when it is installed,
// otherwise the OS default app for the file (no line). The file must be inside the worktree.
import path from 'node:path'

export interface EditorDeps {
  /** Runs `code --goto <file>:<line>`; true = it worked (exit code 0). */
  readonly runCode: (file: string, line: number) => Promise<boolean>
  /** Electron shell.openPath: '' on success, an error message otherwise. */
  readonly openPath: (file: string) => Promise<string>
  readonly isFile: (file: string) => Promise<boolean>
}

export interface OpenInEditorResult {
  readonly via: 'vscode' | 'default'
  readonly file: string
  readonly line: number
}

/** The absolute path of `rel` inside `root`, or null when it escapes the folder (.., absolute, other drive). */
export function resolveInside(root: string, rel: string): string | null {
  if (rel.length === 0 || path.isAbsolute(rel)) return null
  const full = path.resolve(root, rel)
  const back = path.relative(path.resolve(root), full)
  if (back.length === 0 || back.startsWith('..') || path.isAbsolute(back)) return null
  return full
}

export function clampLine(line: number): number {
  return Number.isFinite(line) && line >= 1 ? Math.floor(line) : 1
}

export async function openInEditor(deps: EditorDeps, worktreePath: string, rel: string, line: number): Promise<OpenInEditorResult> {
  const file = resolveInside(worktreePath, rel)
  if (file === null) throw new Error('That file is outside the worktree.')
  if (!(await deps.isFile(file))) throw new Error('That file no longer exists (it may have been deleted).')
  const at = clampLine(line)
  if (!file.includes('"') && (await deps.runCode(file, at))) return { via: 'vscode', file, line: at }
  const failure = await deps.openPath(file)
  if (failure !== '') throw new Error(`Could not open the file: ${failure}`)
  return { via: 'default', file, line: at }
}
