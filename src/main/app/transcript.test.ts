import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { transcriptExists } from './transcript'
import { shouldRotateSessionId } from './claudeLaunch'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function configDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-claude-'))
  dirs.push(dir)
  return dir
}

describe('transcriptExists', () => {
  it('finds a conversation with messages under any project folder', () => {
    const dir = configDir()
    const project = join(dir, 'projects', 'C--work-app')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'abc.jsonl'), ['{"type":"ai-title"}', '{"type":"user","message":"hi"}'].join('\n'))
    expect(transcriptExists('abc', dir)).toBe(true)
    expect(transcriptExists('other', dir)).toBe(false)
  })

  it('treats a metadata-only file as never prompted', () => {
    const dir = configDir()
    const project = join(dir, 'projects', 'C--work-app')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'meta.jsonl'), ['{"type":"ai-title"}', '{"type":"agent-name"}'].join('\n'))
    expect(transcriptExists('meta', dir)).toBe(false)
  })

  it('is false when Claude has no projects folder yet', () => {
    expect(transcriptExists('abc', configDir())).toBe(false)
  })
})

describe('shouldRotateSessionId', () => {
  const failed = {
    mode: 'resume' as const,
    runMs: 900,
    exitCode: 1,
    outputTail: 'Error: Session ID 1234 is already in use.\r\n',
    hasTranscript: false
  }

  it('rotates when a quick resume fails as "already in use" and nothing was ever saved', () => {
    expect(shouldRotateSessionId(failed)).toBe(true)
  })

  it('also rotates on "No conversation found" (the first failure of resuming an unprompted session)', () => {
    expect(shouldRotateSessionId({ ...failed, outputTail: 'No conversation found with session ID: 1234' })).toBe(true)
  })

  it('keeps the id when a conversation was saved (a real second process holds it)', () => {
    expect(shouldRotateSessionId({ ...failed, hasTranscript: true })).toBe(false)
  })

  it('ignores slow exits, clean exits and other errors', () => {
    expect(shouldRotateSessionId({ ...failed, runMs: 20_000 })).toBe(false)
    expect(shouldRotateSessionId({ ...failed, exitCode: 0 })).toBe(false)
    expect(shouldRotateSessionId({ ...failed, outputTail: 'Error: boom' })).toBe(false)
  })
})
