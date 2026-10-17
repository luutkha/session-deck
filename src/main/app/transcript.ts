import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Claude's config dir: CLAUDE_CONFIG_DIR when set, else ~/.claude. */
function claudeConfigDir(): string {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : join(homedir(), '.claude')
}

const MESSAGE_LINE = /"type":"(?:user|assistant)"/

/**
 * True when Claude saved real messages for this id (~/.claude/projects/<project>/<id>.jsonl). A session that was
 * started but never prompted leaves only a metadata file (title, agent name): Claude holds the id as "in use" yet
 * has no conversation to resume.
 */
export function transcriptExists(claudeSessionId: string, configDir: string = claudeConfigDir()): boolean {
  const projects = join(configDir, 'projects')
  try {
    for (const dir of readdirSync(projects)) {
      const file = join(projects, dir, `${claudeSessionId}.jsonl`)
      if (existsSync(file) && MESSAGE_LINE.test(readFileSync(file, 'utf8'))) return true
    }
    return false
  } catch {
    // No projects dir yet (or unreadable): nothing has ever been saved.
    return false
  }
}
