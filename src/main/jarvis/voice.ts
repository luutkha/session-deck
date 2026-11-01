// Jarvis voice input (D54): one spoken sentence -> text, with Windows' built-in offline recognizer (System.Speech,
// through PowerShell). No cloud service, no key. Test seam: SESSIONDECK_VOICE_WAV makes it read a WAV file instead
// of the microphone (the e2e creates one with Windows' own text-to-speech).
import { spawn, type ChildProcess } from 'node:child_process'

/** Seconds of silence before giving up when nothing is said, and the longest sentence. */
export const LISTEN_INITIAL_SILENCE_S = 8
export const LISTEN_MAX_S = 30

/** The PowerShell script: prints a JSON string (the words), or null when nothing was understood. */
export function listenScript(wavFile: string | null): string {
  const input = wavFile === null
    ? '$r.SetInputToDefaultAudioDevice()'
    : `$r.SetInputToWaveFile('${wavFile.replace(/'/g, "''")}')`
  return [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Speech',
    '$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine',
    '$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))',
    input,
    `$r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(${LISTEN_INITIAL_SILENCE_S})`,
    '$r.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.2)',
    `$res = $r.Recognize([TimeSpan]::FromSeconds(${LISTEN_MAX_S}))`,
    '$r.Dispose()',
    'if ($res -ne $null) { [Console]::Out.Write((ConvertTo-Json $res.Text -Compress)) } else { [Console]::Out.Write("null") }'
  ].join('; ')
}

/** The words from the script's output; null when nothing was understood. Throws for output that is not ours. */
export function parseListenOutput(stdout: string): string | null {
  const value: unknown = JSON.parse(stdout.trim() || 'null')
  if (value === null) return null
  if (typeof value !== 'string') throw new Error('Unexpected speech output')
  const text = value.trim()
  return text.length === 0 ? null : text
}

/** A user-readable reason for a failed recognition (PowerShell's error text). */
export function listenErrorMessage(stderr: string): string {
  if (/no recognizer/i.test(stderr)) return 'Windows has no speech recognizer for your language. Add one in Settings > Time & language > Speech.'
  if (/audio|device|microphone/i.test(stderr)) return 'No microphone could be used. Check Settings > Privacy & security > Microphone (allow desktop apps).'
  const line = stderr.split(/\r?\n/).find((l) => l.trim().length > 0) ?? 'unknown error'
  return `Speech recognition failed: ${line.trim().slice(0, 200)}`
}

export interface VoiceListener {
  /** Listens for one sentence. Resolves with the words, or null when nothing was said or it was cancelled. */
  listen(): Promise<string | null>
  cancel(): void
}

export function createVoiceListener(options: { readonly wavFile: () => string | null; readonly platform: NodeJS.Platform }): VoiceListener {
  let current: ChildProcess | null = null
  let cancelled = false

  return {
    listen(): Promise<string | null> {
      if (options.platform !== 'win32') return Promise.reject(new Error('Voice input uses Windows speech recognition and works on Windows only.'))
      if (current !== null) return Promise.reject(new Error('Already listening.'))
      cancelled = false
      return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', listenScript(options.wavFile())], { windowsHide: true })
        current = child
        let out = ''
        let err = ''
        child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
        child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8') })
        child.on('error', (error) => {
          current = null
          reject(error)
        })
        child.on('close', (code) => {
          current = null
          if (cancelled) return resolve(null)
          if (code !== 0) return reject(new Error(listenErrorMessage(err)))
          try {
            resolve(parseListenOutput(out))
          } catch {
            reject(new Error(listenErrorMessage(err || out)))
          }
        })
      })
    },

    cancel(): void {
      if (current === null) return
      cancelled = true
      current.kill()
    }
  }
}
