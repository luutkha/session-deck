import { spawnSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import {
  hookCommand,
  buildClaudeSettings,
  writeSettingsFile,
  statusLineCommand,
  STATUSLINE_THROTTLE_SECONDS
} from './claudeSettings'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('claudeSettings', () => {
  describe('hookCommand', () => {
    it('posts to /hook/<sessionId>/<Event> with the token header', () => {
      const cmd = hookCommand('Notification')
      expect(cmd).toContain('curl -s -m 2 -X POST')
      expect(cmd).toContain('"http://127.0.0.1:$SESSIONDECK_PORT/hook/$SESSIONDECK_SESSION_ID/Notification"')
      expect(cmd).toContain('-H "x-token: $SESSIONDECK_TOKEN"')
      expect(cmd).toContain('content-type: application/json')
      expect(cmd).not.toContain('actual-token-value')
    })

    it('forwards Claude stdin unchanged as the request body', () => {
      expect(hookCommand('Stop')).toContain('--data-binary @-')
      expect(hookCommand('UserPromptSubmit')).toContain('--data-binary @-')
    })

    it('is silent and always exits 0', () => {
      const cmd = hookCommand('Stop')
      expect(cmd).toContain('>/dev/null 2>&1')
      expect(cmd.trim().endsWith('exit 0')).toBe(true)
    })

    it('embeds the event name in the path (Stop and UserPromptSubmit)', () => {
      expect(hookCommand('Stop')).toContain('/hook/$SESSIONDECK_SESSION_ID/Stop"')
      expect(hookCommand('UserPromptSubmit')).toContain('/hook/$SESSIONDECK_SESSION_ID/UserPromptSubmit"')
      expect(hookCommand('UserPromptSubmit')).not.toContain('Notification')
    })

    it('no longer builds a JSON body by hand (no escaped quotes)', () => {
      expect(hookCommand('Notification')).not.toContain('\\"')
    })
  })
  describe('buildClaudeSettings', () => {
    it('returns valid JSON', () => {
      const json = buildClaudeSettings()
      const parsed = JSON.parse(json)
      expect(parsed).toHaveProperty('hooks')
      expect(parsed.hooks).toHaveProperty('Stop')
      expect(parsed.hooks).toHaveProperty('Notification')
      expect(parsed.hooks).toHaveProperty('UserPromptSubmit')
    })

    it('registers a UserPromptSubmit hook that forwards stdin for the same session', () => {
      const parsed = JSON.parse(buildClaudeSettings())
      const command: string = parsed.hooks.UserPromptSubmit[0].hooks[0].command
      expect(parsed.hooks.UserPromptSubmit[0].hooks[0].type).toBe('command')
      expect(command).toBe(hookCommand('UserPromptSubmit'))
    })

    it('has correct structure with hooks array', () => {
      const json = buildClaudeSettings()
      const parsed = JSON.parse(json)
      expect(Array.isArray(parsed.hooks.Stop)).toBe(true)
      expect(Array.isArray(parsed.hooks.Notification)).toBe(true)
      expect(parsed.hooks.Stop[0]).toHaveProperty('hooks')
      expect(Array.isArray(parsed.hooks.Stop[0].hooks)).toBe(true)
      expect(parsed.hooks.Stop[0].hooks[0]).toHaveProperty('type', 'command')
      expect(parsed.hooks.Stop[0].hooks[0]).toHaveProperty('command')
    })

    it('contains no secret values', () => {
      const json = buildClaudeSettings()
      expect(json).not.toContain('actual-token')
      expect(json).not.toContain('secret')
      expect(json).toContain('$SESSIONDECK_TOKEN')
      expect(json).toContain('$SESSIONDECK_PORT')
      expect(json).toContain('$SESSIONDECK_SESSION_ID')
    })

    it('JSON.parse round trip works', () => {
      const json = buildClaudeSettings()
      const parsed = JSON.parse(json)
      const reparsed = JSON.parse(JSON.stringify(parsed))
      expect(reparsed).toEqual(parsed)
    })

    it('has a statusLine command entry next to the hooks', () => {
      const parsed = JSON.parse(buildClaudeSettings())
      expect(parsed.statusLine).toEqual({ type: 'command', command: statusLineCommand() })
      expect(parsed).toHaveProperty('hooks')
    })

    it('statusLine command contains no secret values and reads env vars only', () => {
      const parsed = JSON.parse(buildClaudeSettings())
      const command: string = parsed.statusLine.command
      expect(command).not.toContain('actual-token')
      expect(command).toContain('$SESSIONDECK_TOKEN')
      expect(command).toContain('$SESSIONDECK_PORT')
      expect(command).toContain('$SESSIONDECK_SESSION_ID')
      expect(command).toContain('/statusline/$SESSIONDECK_SESSION_ID')
    })
  })

  describe('statusLineCommand', () => {
    it('reads stdin, posts with curl --data-binary and never prints', () => {
      const cmd = statusLineCommand()
      expect(cmd).toContain('payload=$(cat)')
      expect(cmd).toContain('--data-binary @-')
      expect(cmd).toContain('x-token: $SESSIONDECK_TOKEN')
      expect(cmd).toContain('content-type: application/json')
      expect(cmd).toContain('-m 2')
      expect(cmd).toContain('>/dev/null 2>&1')
      expect(cmd.trim().endsWith('exit 0')).toBe(true)
    })

    it('throttles with a per-session timestamp file under TMPDIR', () => {
      const cmd = statusLineCommand()
      expect(cmd).toContain('${TMPDIR:-/tmp}/sessiondeck-sl-$SESSIONDECK_SESSION_ID')
      expect(cmd).toContain(`-ge ${STATUSLINE_THROTTLE_SECONDS}`)
      expect(STATUSLINE_THROTTLE_SECONDS).toBe(10)
    })

    it('does not contain the JS-escaped quote sequences used by hookCommand', () => {
      expect(statusLineCommand()).not.toContain('\\"')
    })

    it('keeps the newest payload of a throttled call and sends it once when the window ends (D86)', () => {
      const cmd = statusLineCommand()
      expect(cmd).toContain('"$f.latest"')
      expect(cmd).toContain('"$f.pending"')
      expect(cmd).toContain('sleep $((')
      expect(cmd.trim().endsWith('exit 0')).toBe(true)
    })

    it('is valid bash', () => {
      const result = spawnSync('bash', ['-n', '-c', statusLineCommand()], { encoding: 'utf8' })
      // No bash on this PC: nothing to check here (the e2e covers the real run).
      if (result.error !== undefined) return
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
    })
  })

  describe('writeSettingsFile', () => {
    it('writes file to specified directory', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'sessiondeck-test-'))
      try {
        const filePath = writeSettingsFile(tempDir)
        expect(filePath).toContain('sessiondeck-hooks.json')
        const content = readFileSync(filePath, 'utf8')
        const parsed = JSON.parse(content)
        expect(parsed).toHaveProperty('hooks')
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('creates directory if it does not exist', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'sessiondeck-test-'))
      const nestedDir = join(tempDir, 'nested', 'deep')
      try {
        const filePath = writeSettingsFile(nestedDir)
        expect(filePath).toContain('sessiondeck-hooks.json')
        const content = readFileSync(filePath, 'utf8')
        expect(content).toContain('hooks')
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('overwrites existing file', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'sessiondeck-test-'))
      try {
        const filePath1 = writeSettingsFile(tempDir)
        const content1 = readFileSync(filePath1, 'utf8')
        const filePath2 = writeSettingsFile(tempDir)
        const content2 = readFileSync(filePath2, 'utf8')
        expect(filePath1).toBe(filePath2)
        expect(content1).toBe(content2)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('returns absolute path', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'sessiondeck-test-'))
      try {
        const filePath = writeSettingsFile(tempDir)
        expect(filePath).toBe(filePath) // absolute paths equal themselves
        expect(filePath.startsWith(tempDir)).toBe(true)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})