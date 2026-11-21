import { describe, expect, it } from 'vitest'
import { createOpencodeExportRunner, EXPORT_MAX_BUFFER, EXPORT_TIMEOUT_MS, type ExportExec } from './exportRunner'

function fakeExec(result: { stdout?: string; stderr?: string; error?: Error | null; throws?: Error }): {
  exec: ExportExec
  calls: Array<{ file: string; args: readonly string[]; options: Parameters<ExportExec>[2] }>
} {
  const calls: Array<{ file: string; args: readonly string[]; options: Parameters<ExportExec>[2] }> = []
  const exec: ExportExec = (file, args, options, callback) => {
    calls.push({ file, args, options })
    if (result.throws !== undefined) throw result.throws
    callback(result.error ?? null, result.stdout ?? '', result.stderr ?? '')
  }
  return { exec, calls }
}

describe('createOpencodeExportRunner', () => {
  it('runs opencode with the args in order and resolves stdout', async () => {
    const { exec, calls } = fakeExec({ stdout: '{"messages":[]}' })
    const run = createOpencodeExportRunner(exec)
    await expect(run(['session', 'export', 'ses_abc123'])).resolves.toBe('{"messages":[]}')
    expect(calls).toHaveLength(1)
    if (process.platform === 'win32') {
      // `opencode` is `opencode.cmd` on Windows: the shell resolves it, from our own tokens (never a caller string).
      expect(calls[0]?.file).toBe('opencode session export ses_abc123')
      expect(calls[0]?.args).toEqual([])
    } else {
      expect(calls[0]?.file).toBe('opencode')
      expect(calls[0]?.args).toEqual(['session', 'export', 'ses_abc123'])
    }
    expect(calls[0]?.options).toMatchObject({
      timeout: EXPORT_TIMEOUT_MS,
      maxBuffer: EXPORT_MAX_BUFFER,
      windowsHide: true,
      encoding: 'utf8',
      shell: process.platform === 'win32'
    })
  })

  it('never passes --sanitize (it would redact the conversation text)', async () => {
    const { exec, calls } = fakeExec({ stdout: '{}' })
    await createOpencodeExportRunner(exec)(['session', 'export', 'ses_abc123'])
    const call = calls[0]
    expect(call === undefined ? '' : `${call.file} ${call.args.join(' ')}`).not.toContain('--sanitize')
  })

  it('rejects with OpenCode stderr when the command fails (a missing session exits 1)', async () => {
    const { exec } = fakeExec({ error: new Error('Command failed: exit 1'), stderr: 'Session not found: ses_gone\n' })
    await expect(createOpencodeExportRunner(exec)(['session', 'export', 'ses_gone'])).rejects.toThrow('Session not found: ses_gone')
  })

  it('rejects on a timeout or a spawn error without stderr, and when exec itself throws', async () => {
    const timedOut = fakeExec({ error: new Error('ETIMEDOUT') })
    await expect(createOpencodeExportRunner(timedOut.exec)(['session', 'export', 'ses_a'])).rejects.toThrow('ETIMEDOUT')
    const broken = fakeExec({ throws: new Error('spawn opencode ENOENT') })
    await expect(createOpencodeExportRunner(broken.exec)(['session', 'export', 'ses_a'])).rejects.toThrow('ENOENT')
  })
})
