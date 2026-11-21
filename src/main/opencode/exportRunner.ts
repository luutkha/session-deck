/**
 * The real runner behind OpenCode transcripts (D79): `opencode session export <id>`, injected into
 * exportOpencodeSession (src/main/transcripts/opencodeTranscript.ts) by main. Keeping the process in this small file
 * means the transcript and search modules stay pure and unit-testable with a fake runner.
 *
 * `execFile` (never spawnSync): an export runs while the app is busy, so the main thread must not block. On Windows the
 * installed CLI is `opencode.cmd`, which only the shell resolves (the same reason src/main/opencode/capabilities.ts
 * turns to the shell there), so win32 goes through `shell: true` with a command line built from this module's own
 * tokens; every other platform gets the args array straight to the process. A session id is `ses_` + alphanumerics
 * (validated by exportOpencodeSession before this runner is called) and other tokens are quoted, so no user text
 * reaches a shell unescaped.
 *
 * `--sanitize` is never passed: it redacts exactly the conversation text this app needs.
 */
import { execFile } from 'node:child_process'

/** A hung export must not keep a Jarvis tool or a conversation search waiting. */
export const EXPORT_TIMEOUT_MS = 20_000
/** A long conversation is large; past this the JSON is not worth the main-process memory. */
export const EXPORT_MAX_BUFFER = 20 * 1024 * 1024

/** The subset of execFile options this runner sets (a named shape so tests can inspect it). */
export interface ExportExecOptions {
  readonly timeout: number
  readonly maxBuffer: number
  readonly windowsHide: boolean
  readonly encoding: 'utf8'
  readonly shell: boolean
}

/** The process call, replaceable in tests so no unit test ever starts the real CLI. */
export type ExportExec = (
  file: string,
  args: readonly string[],
  options: ExportExecOptions,
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void

/** `run(args)` for exportOpencodeSession: stdout on success, a rejection on a non-zero exit or a timeout. */
export type OpencodeExportRunner = (args: string[]) => Promise<string>

const defaultExec: ExportExec = (file, args, options, callback) => {
  execFile(file, [...args], options, (error, stdout, stderr) => callback(error, stdout, stderr))
}

/** A shell-safe token: ids and flags need no quotes; anything else is quoted defensively (double quotes, doubled). */
function shellToken(token: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(token) ? token : `"${token.replace(/"/g, '""')}"`
}

/**
 * Builds the injected runner. `windowsHide` keeps a console window from flashing on Windows; `maxBuffer` is 20 MB
 * because a long OpenCode conversation export easily passes Node's 1 MB default. A failed command rejects with
 * OpenCode's own stderr, which the transcript layer turns into "no transcript" (null).
 */
export function createOpencodeExportRunner(exec: ExportExec = defaultExec): OpencodeExportRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      const shell = process.platform === 'win32'
      // Passing arguments to a shell leaves the quoting to the shell, so on Windows the command line is built here from
      // this module's own tokens (the literals above plus a `ses_` id validated before the runner is called), each
      // quoted. Elsewhere the args go straight to the process. Either way the runner's interface is an array.
      const file = shell ? ['opencode', ...args.map(shellToken)].join(' ') : 'opencode'
      const callArgs: readonly string[] = shell ? [] : args
      try {
        exec(
          file,
          callArgs,
          {
            timeout: EXPORT_TIMEOUT_MS,
            maxBuffer: EXPORT_MAX_BUFFER,
            windowsHide: true,
            encoding: 'utf8',
            shell
          },
          (error, stdout, stderr) => {
            if (error !== null) {
              const detail = stderr.trim()
              reject(new Error(`opencode session export failed: ${detail.length > 0 ? detail : error.message}`))
              return
            }
            resolve(stdout)
          }
        )
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
}
