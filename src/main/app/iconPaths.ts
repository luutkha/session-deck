import path from 'node:path'

export type IconName = 'icon.png' | 'tray.png' | 'tray-attention.png'

export interface IconPathDeps {
  readonly isPackaged: boolean
  /** process.resourcesPath (packaged builds). */
  readonly resourcesPath: string
  /** app.getAppPath() (development: the project root). */
  readonly appPath: string
  readonly exists: (filePath: string) => boolean
}

/** Absolute path of a bundled icon, or null when the file is not there. */
export function resolveIconPath(name: IconName, deps: IconPathDeps): string | null {
  const base = deps.isPackaged ? deps.resourcesPath : deps.appPath
  const candidate = path.join(base, 'build', name)
  return deps.exists(candidate) ? candidate : null
}
