import { win32 } from 'node:path'
import type { OpenLinkResult, ResolvedLink } from '../../shared/types'
import { parseLinkText, type ParsedPathLink } from './linkText'
import { errorMessage } from '../../shared/guards'

/** Result of a filesystem check made by the caller. */
export interface LinkStat {
  readonly isFile: boolean
  readonly isDirectory: boolean
}

export interface LinkServiceDeps {
  /** cwd of the session, or null when the session is unknown. */
  readonly getSessionCwd: (sessionId: string) => string | null
  /** Resolves to null when the path does not exist. */
  readonly stat: (path: string) => Promise<LinkStat | null>
  /** Electron shell.openPath: '' on success, an OS error message otherwise. */
  readonly openPath: (path: string) => Promise<string>
  readonly openExternal: (url: string) => Promise<void>
  readonly showItemInFolder: (path: string) => void
  readonly homedir: () => string
}

export interface LinkService {
  /** Classifies terminal text against the session cwd and the file system. */
  resolve(sessionId: string, text: string): Promise<ResolvedLink | null>
  /** Batched resolve; same length as `texts`, entries past MAX_LINK_TEXTS are null. */
  resolveMany(sessionId: string, texts: readonly string[]): Promise<readonly (ResolvedLink | null)[]>
  /** Re-resolves `text` (never trusts the caller) and opens the target safely. */
  open(sessionId: string, text: string, reveal: boolean): Promise<OpenLinkResult>
}

/** Candidates past this index resolve to null (guards an abusive renderer). */
export const MAX_LINK_TEXTS = 200

/** Executable / script-like extensions that are never launched by a click. */
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.msi', '.msp', '.scr', '.lnk', '.reg', '.hta', '.cpl', '.jar',
  '.dll', '.sh', '.url', '.msc', '.pif', '.appref-ms', '.vb', '.ps1xml', '.gadget'
])

function isHttpOrMailto(url: string): boolean {
  return /^https?:/i.test(url) || /^mailto:/i.test(url)
}

function withPosition(link: { kind: 'file' | 'folder'; target: string }, parsed: ParsedPathLink): ResolvedLink {
  if (parsed.line === undefined && parsed.column === undefined) return link
  return {
    ...link,
    ...(parsed.line === undefined ? {} : { line: parsed.line }),
    ...(parsed.column === undefined ? {} : { column: parsed.column })
  }
}

export function createLinkService(deps: LinkServiceDeps): LinkService {
  function resolveTarget(parsed: ParsedPathLink, sessionId: string): string | null {
    if (parsed.home) {
      return win32.normalize(win32.join(deps.homedir(), parsed.path))
    }
    if (win32.isAbsolute(parsed.path)) {
      return win32.normalize(parsed.path)
    }
    const cwd = deps.getSessionCwd(sessionId)
    if (cwd === null) return null
    return win32.resolve(cwd, parsed.path)
  }

  async function resolve(sessionId: string, text: string): Promise<ResolvedLink | null> {
    const parsed = parseLinkText(text)
    if (parsed === null) return null
    if (parsed.kind === 'url') return { kind: 'url', target: parsed.url }

    const target = resolveTarget(parsed, sessionId)
    if (target === null) return null
    // A UNC path makes Windows contact the remote host just to stat it (credential-leak vector): never resolve those.
    if (target.startsWith('\\')) return null

    let info: LinkStat | null
    try {
      info = await deps.stat(target)
    } catch {
      return null
    }
    if (info === null) return null
    if (info.isDirectory) return withPosition({ kind: 'folder', target }, parsed)
    if (info.isFile) return withPosition({ kind: 'file', target }, parsed)
    return null
  }

  async function resolveMany(
    sessionId: string,
    texts: readonly string[]
  ): Promise<readonly (ResolvedLink | null)[]> {
    const results: (ResolvedLink | null)[] = new Array<ResolvedLink | null>(texts.length).fill(null)
    const pending = new Map<string, Promise<ResolvedLink | null>>()
    const limit = Math.min(texts.length, MAX_LINK_TEXTS)
    const jobs: Promise<void>[] = []
    for (let i = 0; i < limit; i++) {
      const text = texts[i]
      jobs.push(
        (async () => {
          let promise = pending.get(text)
          if (promise === undefined) {
            promise = resolve(sessionId, text)
            pending.set(text, promise)
          }
          results[i] = await promise
        })()
      )
    }
    await Promise.all(jobs)
    return results
  }

  async function open(sessionId: string, text: string, reveal: boolean): Promise<OpenLinkResult> {
    try {
      const link = await resolve(sessionId, text)
      if (link === null) return { ok: false, error: 'File not found' }

      if (link.kind === 'url') {
        if (!isHttpOrMailto(link.target)) return { ok: false, error: 'Unsupported link' }
        await deps.openExternal(link.target)
        return { ok: true, kind: 'url' }
      }

      if (link.kind === 'folder') {
        const message = await deps.openPath(link.target)
        return message === '' ? { ok: true, kind: 'folder' } : { ok: false, error: `Could not open: ${message}` }
      }

      if (reveal || DANGEROUS_EXTENSIONS.has(win32.extname(link.target).toLowerCase())) {
        deps.showItemInFolder(link.target)
        return { ok: true, kind: 'file' }
      }
      const message = await deps.openPath(link.target)
      return message === '' ? { ok: true, kind: 'file' } : { ok: false, error: `Could not open: ${message}` }
    } catch (error) {
      return { ok: false, error: `Could not open: ${errorMessage(error)}` }
    }
  }

  return { resolve, resolveMany, open }
}
