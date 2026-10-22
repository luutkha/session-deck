// Small filesystem checks shared by the git modules. Only "not there" errors become false; anything else is thrown.
import { lstat, stat } from 'node:fs/promises'

const MISSING_CODES: readonly string[] = ['ENOENT', 'ENOTDIR']

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' && MISSING_CODES.includes(code)
}

/** True when `p` is an existing directory (symlinks followed). */
export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

/** True when anything (file, folder, dangling symlink) sits at `p`. */
export async function pathTaken(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}
