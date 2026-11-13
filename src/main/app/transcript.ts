import { closeSync, fstatSync, existsSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Claude's config dir: CLAUDE_CONFIG_DIR when set, else ~/.claude. */
export function claudeConfigDir(): string {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : join(homedir(), '.claude')
}

const MESSAGE_LINE = /"type":"(?:user|assistant)"/
/** A real conversation is checked from at most its last 64 KB: a metadata-only file is only a few KB. */
const TAIL_BYTES = 64 * 1024
/** The project listing is reused for a moment; a miss always refreshes it, so a new folder is still found. */
const LISTING_TTL_MS = 3000

interface Listing {
  readonly path: string
  readonly at: number
  readonly dirs: readonly string[]
}

let listing: Listing | null = null

/** Project folders, from the short-lived cache when it is fresh. */
function projectDirs(projects: string, fresh: boolean): readonly string[] {
  if (!fresh && listing !== null && listing.path === projects && Date.now() - listing.at < LISTING_TTL_MS) {
    return listing.dirs
  }
  const dirs = readdirSync(projects)
  listing = { path: projects, at: Date.now(), dirs }
  return dirs
}

/** True when the file holds at least one real message line; reads the tail first, the whole file only as a fallback. */
function hasMessage(file: string): boolean {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    if (size <= TAIL_BYTES) {
      return MESSAGE_LINE.test(readFileSync(file, 'utf8'))
    }
    const start = size - TAIL_BYTES
    const buffer = Buffer.alloc(TAIL_BYTES)
    let read = 0
    while (read < TAIL_BYTES) {
      const count = readSync(fd, buffer, read, TAIL_BYTES - read, start + read)
      if (count === 0) break
      read += count
    }
    if (MESSAGE_LINE.test(buffer.subarray(0, read).toString('utf8'))) return true
    // Rare (a line longer than the window, or messages followed by a long tail): the whole file settles it.
    return MESSAGE_LINE.test(readFileSync(file, 'utf8'))
  } finally {
    closeSync(fd)
  }
}

function findIn(dirs: readonly string[], projects: string, claudeSessionId: string): boolean {
  for (const dir of dirs) {
    const file = join(projects, dir, `${claudeSessionId}.jsonl`)
    if (existsSync(file) && hasMessage(file)) return true
  }
  return false
}

/**
 * True when Claude saved real messages for this id (~/.claude/projects/<project>/<id>.jsonl). A session that was
 * started but never prompted leaves only a metadata file (title, agent name): Claude holds the id as "in use" yet
 * has no conversation to resume.
 */
export function transcriptExists(claudeSessionId: string, configDir: string = claudeConfigDir()): boolean {
  const projects = join(configDir, 'projects')
  try {
    const fresh = listing !== null && listing.path === projects && Date.now() - listing.at < LISTING_TTL_MS
    if (findIn(projectDirs(projects, false), projects, claudeSessionId)) return true
    // A cached listing may predate the folder Claude just created: retry with a fresh one before saying no.
    return fresh ? findIn(projectDirs(projects, true), projects, claudeSessionId) : false
  } catch {
    // No projects dir yet (or unreadable): nothing has ever been saved.
    return false
  }
}
