import { describe, it, expect } from 'vitest'
import { buildCommandLaunch, buildLaunch } from './launch'

describe('buildCommandLaunch shells', () => {
  it('starts powershell through cmd.exe on win32', () => {
    expect(buildCommandLaunch('win32', 'powershell', [], ['-NoLogo'])).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/c', 'powershell', '-NoLogo']
    })
  })

  it('starts pwsh and cmd through cmd.exe on win32 (cmd gets no internal args)', () => {
    expect(buildCommandLaunch('win32', 'pwsh', [], ['-NoLogo']).args).toEqual(['/d', '/c', 'pwsh', '-NoLogo'])
    expect(buildCommandLaunch('win32', 'cmd', [], []).args).toEqual(['/d', '/c', 'cmd'])
  })

  it('starts the shell directly on other platforms', () => {
    expect(buildCommandLaunch('linux', 'pwsh', [], ['-NoLogo'])).toEqual({ file: 'pwsh', args: ['-NoLogo'] })
  })
})

describe('buildLaunch', () => {
  it('wraps claude in cmd.exe /d /c on win32', () => {
    expect(buildLaunch('win32', ['--continue'])).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/c', 'claude', '--continue']
    })
  })

  it('returns claude directly on non-win32 platforms', () => {
    expect(buildLaunch('linux', ['--continue'])).toEqual({
      file: 'claude',
      args: ['--continue']
    })
    expect(buildLaunch('darwin', ['-p', 'hello'])).toEqual({
      file: 'claude',
      args: ['-p', 'hello']
    })
  })

  it('accepts args made of safe characters', () => {
    expect(() => buildLaunch('win32', ['abc123_@=:,./\\-'])).not.toThrow()
  })

  it('rejects unsafe arguments', () => {
    const unsafe = ['&', '|', '"', '%', ' ', '$', '`']
    for (const arg of unsafe) {
      expect(() => buildLaunch('win32', [arg])).toThrow(
        `Unsafe claude argument: ${arg}`
      )
    }
  })

  it('rejects unsafe characters embedded within an argument', () => {
    expect(() => buildLaunch('win32', ['a&b'])).toThrow(
      'Unsafe claude argument: a&b'
    )
  })

  it('does not mutate the input argument array', () => {
    const args = ['--continue'] as const
    buildLaunch('win32', args)
    expect(args).toEqual(['--continue'])
  })

  it('places internalArgs before claudeArgs on win32', () => {
    expect(buildLaunch('win32', ['--user-arg'], ['--internal-arg'])).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/c', 'claude', '--internal-arg', '--user-arg']
    })
  })

  it('places internalArgs before claudeArgs on non-win32', () => {
    expect(buildLaunch('linux', ['--user-arg'], ['--internal-arg'])).toEqual({
      file: 'claude',
      args: ['--internal-arg', '--user-arg']
    })
  })

  it('internalArgs can contain unsafe characters (trusted)', () => {
    expect(() => buildLaunch('win32', ['--safe'], ['--settings', 'path with spaces'])).not.toThrow()
    const spec = buildLaunch('win32', ['--safe'], ['--settings', 'path with spaces'])
    expect(spec.args).toContain('path with spaces')
  })

  it('claudeArgs still validated when internalArgs present', () => {
    expect(() => buildLaunch('win32', ['--unsafe&arg'], ['--internal'])).toThrow(
      'Unsafe claude argument: --unsafe&arg'
    )
  })

  it('defaults internalArgs to empty array', () => {
    expect(buildLaunch('win32', ['--arg'])).toEqual(
      buildLaunch('win32', ['--arg'], [])
    )
  })

  it('does not mutate internalArgs array', () => {
    const internal = ['--a'] as const
    buildLaunch('win32', ['--b'], internal)
    expect(internal).toEqual(['--a'])
  })
})
