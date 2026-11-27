// Pure launch-spec builder. Args come from user input, so every arg is validated
// against a strict allow-list to prevent shell injection via cmd.exe (Windows)
// or the shell (POSIX).
// Internal args are TRUSTED (not validated) and placed BEFORE user claudeArgs.
import type { ShellKind } from '../../shared/types'

const SAFE_ARG = /^[A-Za-z0-9_@=:,./\\-]+$/

const WIN_LAUNCHER = 'cmd.exe'
const WIN_LAUNCHER_ARGS: readonly string[] = ['/d', '/c']

/** D92: an extra agent CLI's command, made only by asCliCommand (plain name, no shell metacharacters). */
export type CliCommand = string & { readonly __cliCommand: true }

/** Which program a session launches: an agent binary, or a plain shell (Code mode Shell sessions). */
export type LaunchCommand = 'claude' | 'opencode' | 'cursor-agent' | 'agent' | ShellKind | CliCommand

export interface LaunchSpec {
  readonly file: string
  readonly args: string[]
}

export function buildCommandLaunch(
  platform: NodeJS.Platform,
  command: LaunchCommand,
  claudeArgs: readonly string[],
  internalArgs: readonly string[] = []
): LaunchSpec {
  for (const arg of claudeArgs) {
    if (!SAFE_ARG.test(arg)) {
      throw new Error(`Unsafe claude argument: ${arg}`)
    }
  }

  if (platform === 'win32') {
    return { file: WIN_LAUNCHER, args: [...WIN_LAUNCHER_ARGS, command, ...internalArgs, ...claudeArgs] }
  }

  return { file: command, args: [...internalArgs, ...claudeArgs] }
}

export function buildLaunch(
  platform: NodeJS.Platform,
  claudeArgs: readonly string[],
  internalArgs: readonly string[] = []
): LaunchSpec {
  return buildCommandLaunch(platform, 'claude', claudeArgs, internalArgs)
}
