// D75: relative images and relative links inside a Markdown preview. The renderer never touches the
// disk, so this only turns a relative reference in the document into the absolute Windows path main
// will read (assets) or open (links). Anything that is not a plain local relative path stays inert:
// remote images must not load (privacy: no tracking pixels) and schemes never reach the app.
//
// No React, no DOM, no IPC: unit-tested in Node (markdownAssets.test.ts).

/** `C:\x` and `C:/x` are absolute Windows paths even though `C:` also looks like a URI scheme. */
const DRIVE_ABSOLUTE = /^([a-zA-Z]:)[\\/]/
const DRIVE_PREFIX = /^([a-zA-Z]:)/
/** Any URI scheme: http:, https:, data:, javascript:, file:, mailto:, tel:, custom-app: ... */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * The absolute Windows path a relative reference in `baseFilePath` points at, or null when the
 * reference is not a plain relative local path (empty, fragment, scheme, UNC or protocol-relative).
 * Query and fragment are dropped, percent escapes are decoded, `..` never climbs above the drive root.
 */
export function resolveRelativeAsset(baseFilePath: string, href: string): string | null {
  const trimmed = href.trim()
  if (trimmed === '') return null
  const withoutQuery = stripQueryAndFragment(trimmed)
  if (withoutQuery === '') return null

  let decoded: string
  try {
    // `./my%20pic.png` is how a Markdown writer escapes a space; a broken `%` is not a path.
    decoded = decodeURIComponent(withoutQuery)
  } catch {
    return null
  }
  if (decoded === '') return null

  // `//host/x` is protocol-relative and `\\host\share` is a UNC path: both reach the network.
  if (/^[\\/]{2}/.test(decoded)) return null
  if (DRIVE_ABSOLUTE.test(decoded)) return normalizeAbsolute(decoded)
  if (SCHEME.test(decoded)) return null
  // A single leading separator is "root of the current drive", which is not a plain relative path.
  if (/^[\\/]/.test(decoded)) return null

  const base = normalizeAbsolute(baseFilePath)
  if (base === null) return null
  const driveMatch = DRIVE_PREFIX.exec(base)
  if (driveMatch === null) return null
  const drive = driveMatch[1]
  const directory = base.slice(drive.length + 1).split('\\')
  // The last segment is the Markdown file itself; assets resolve against its folder.
  directory.pop()
  return joinSegments(drive, directory, decoded)
}

/** Cuts `?query` and `#fragment` (whichever comes first); the Markdown href may carry either. */
function stripQueryAndFragment(href: string): string {
  const question = href.indexOf('?')
  const hash = href.indexOf('#')
  const cut = question < 0 ? hash : hash < 0 ? question : Math.min(question, hash)
  return cut < 0 ? href : href.slice(0, cut)
}

/** `C:/a/b.md` and `C:\a\b.md` become the same backslash path. */
function toBackslashes(path: string): string {
  return path.replace(/\//g, '\\')
}

/** Normalizes an absolute drive path (`C:\a\..\b` -> `C:\b`), or null when it has no drive letter. */
function normalizeAbsolute(path: string): string | null {
  const normalized = toBackslashes(path)
  const match = DRIVE_ABSOLUTE.exec(normalized)
  if (match === null) return null
  const drive = match[1]
  return joinSegments(drive, [], normalized.slice(drive.length))
}

/** Joins a drive with base segments plus `reference` segments, dropping `.` and clamping `..`. */
function joinSegments(drive: string, base: readonly string[], reference: string): string {
  const out = [...base]
  for (const segment of reference.split(/[\\/]+/)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      // At the drive root there is nothing left to climb to; the path stays on this drive.
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.length === 0 ? `${drive}\\` : `${drive}\\${out.join('\\')}`
}
