// D76: the rows a terminal right-click menu gets when the pointer was over a link. Pure: the menu hook maps
// these ids to actions, so the order and labels live here and are unit-tested.
import { fileViewKindFor } from '../../../shared/fileViewKind'
import type { ResolvedLink } from '../../../shared/types'

export type LinkMenuRowId =
  | 'preview'
  | 'open'
  | 'reveal'
  | 'copyPath'
  | 'openUrl'
  | 'copyUrl'
  | 'openFolder'

export interface LinkMenuRow {
  readonly id: LinkMenuRowId
  readonly label: string
}

const PREVIEW: LinkMenuRow = { id: 'preview', label: 'Open in Side Panel' }
const OPEN: LinkMenuRow = { id: 'open', label: 'Open in Default App' }
const REVEAL: LinkMenuRow = { id: 'reveal', label: 'Show in Explorer' }
const COPY_PATH: LinkMenuRow = { id: 'copyPath', label: 'Copy Path' }
const OPEN_FOLDER: LinkMenuRow = { id: 'openFolder', label: 'Open Folder' }
const OPEN_URL: LinkMenuRow = { id: 'openUrl', label: 'Open in Browser' }
const COPY_URL: LinkMenuRow = { id: 'copyUrl', label: 'Copy Link' }

/**
 * The link rows for one resolved link, in menu order. A file the viewer knows gets Preview first; every other
 * file opens externally; a folder has no preview; a URL gets the browser rows. `text` is the link text the
 * terminal showed (kept in the signature because the actions act on it, not on the resolved target).
 */
export function linkMenuRows(link: ResolvedLink, _text: string): readonly LinkMenuRow[] {
  if (link.kind === 'url') {
    return [OPEN_URL, COPY_URL]
  }
  if (link.kind === 'folder') {
    return [OPEN_FOLDER, COPY_PATH]
  }
  if (fileViewKindFor(link.target) !== null) {
    return [PREVIEW, OPEN, REVEAL, COPY_PATH]
  }
  return [OPEN, REVEAL, COPY_PATH]
}

/**
 * One-line heading of what the rows act on: the file/folder name, or the URL's host (the full URL for a
 * `mailto:` link, which has no host). Falls back to the link text when the target has no last segment.
 */
export function linkMenuHeading(link: ResolvedLink, text: string): string {
  if (link.kind === 'url') {
    try {
      return new URL(link.target).host || link.target
    } catch {
      return link.target
    }
  }
  const base = link.target.slice(Math.max(link.target.lastIndexOf('/'), link.target.lastIndexOf('\\')) + 1)
  return base.length > 0 ? base : text
}
