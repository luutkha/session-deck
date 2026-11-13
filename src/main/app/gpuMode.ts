// GPU mode persistence (no-GPU support, part 1): remembers the user's acceleration preference and whether the last
// run rendered in software, so a PC without a GPU starts with hardware acceleration off instead of burning the CPU
// on SwiftShader. Every 10th launch stays enabled (a probe) so a machine that gained a GPU, or a wrong detection,
// corrects itself. All IO comes in through deps; the file is parsed defensively and a broken file is never fatal.
import { dirname, join } from 'node:path'
import { isRecord } from '../../shared/guards'
import type { GpuMode, GpuPref } from '../../shared/types'

export const GPU_MODE_FILE_NAME = 'gpu-mode.json'
/** A probe launch keeps acceleration enabled so the classification can be re-checked (and corrected). */
export const GPU_PROBE_EVERY_LAUNCHES = 10

export interface GpuModeFile {
  readonly version: 1
  readonly pref: GpuPref
  /** The last run (without acceleration disabled by us) rendered in software. */
  readonly lastSoftware: boolean
  /** Launches recorded so far, this one included. Drives the probe. */
  readonly launches: number
  /** The app already restarted itself once to turn the GPU off after its first software detection (never twice). Omitted when false. */
  readonly autoRestarted?: boolean
}

export const DEFAULT_GPU_MODE: GpuModeFile = { version: 1, pref: 'auto', lastSoftware: false, launches: 0 }

export function gpuModeFilePath(userDataDir: string): string {
  return join(userDataDir, GPU_MODE_FILE_NAME)
}

export function isGpuPref(value: unknown): value is GpuPref {
  return value === 'auto' || value === 'on' || value === 'off'
}

function isLaunchCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** The stored file, or defaults for anything unexpected (missing fields, wrong version, junk). Never throws. */
export function parseGpuModeFile(text: string): GpuModeFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ...DEFAULT_GPU_MODE }
  }
  if (!isRecord(raw) || raw.version !== 1) return { ...DEFAULT_GPU_MODE }
  return {
    version: 1,
    pref: isGpuPref(raw.pref) ? raw.pref : 'auto',
    lastSoftware: typeof raw.lastSoftware === 'boolean' ? raw.lastSoftware : false,
    launches: isLaunchCount(raw.launches) ? raw.launches : 0,
    ...(raw.autoRestarted === true ? { autoRestarted: true } : {})
  }
}

export function serializeGpuModeFile(file: GpuModeFile): string {
  return JSON.stringify({
    version: 1,
    pref: file.pref,
    lastSoftware: file.lastSoftware,
    launches: file.launches,
    ...(file.autoRestarted === true ? { autoRestarted: true } : {})
  })
}

export interface FirstRunRestartInput {
  /** The file as it was BEFORE this detection was recorded. */
  readonly file: GpuModeFile
  /** Value of SESSIONDECK_GPU. */
  readonly env: string | undefined
  /** This run already had the GPU process turned off by us. */
  readonly accelerationDisabled: boolean
  /** Software rendering was seen (main's classification or the window's WebGL probe). */
  readonly softwareSeen: boolean
  /** Start-up switches that already decide the GPU mode (--disable-gpu), or the test switch that forbids the restart. */
  readonly gpuDecidedByLaunch: boolean
}

/**
 * First run on a PC without a GPU: the GPU process was started before anything could tell, so one restart with it off is
 * worth it. Only when nothing decided the mode already (a saved preference, SESSIONDECK_GPU, a launch switch), when this
 * is the first time software was seen (a remembered software state means this run was a probe: stay up), and never twice.
 */
export function shouldRestartForSoftware(input: FirstRunRestartInput): boolean {
  if (!input.softwareSeen || input.accelerationDisabled || input.gpuDecidedByLaunch) return false
  const envMode = typeof input.env === 'string' ? input.env.trim().toLowerCase() : ''
  if (envMode === 'on' || envMode === 'off') return false
  if (input.file.pref !== 'auto') return false
  if (input.file.lastSoftware || input.file.autoRestarted === true) return false
  return true
}

export interface AccelerationDecision {
  /** Call app.disableHardwareAcceleration() before ready. */
  readonly disable: boolean
  /** This launch keeps acceleration on to re-check the detection (auto mode, every GPU_PROBE_EVERY_LAUNCHES). */
  readonly probe: boolean
}

/**
 * Whether this launch disables hardware acceleration. SESSIONDECK_GPU ('on' | 'off') beats the file, because it is how
 * a user (or a test) overrides a bad detection without editing the file. `auto` disables only after a software run,
 * and a probe launch keeps it enabled so the next detection runs on the real GPU again.
 */
export function decideAcceleration(file: GpuModeFile, env: string | undefined): AccelerationDecision {
  const envMode = typeof env === 'string' ? env.trim().toLowerCase() : ''
  if (envMode === 'off') return { disable: true, probe: false }
  if (envMode === 'on') return { disable: false, probe: false }
  if (file.pref === 'off') return { disable: true, probe: false }
  if (file.pref === 'on') return { disable: false, probe: false }
  const probe = file.launches % GPU_PROBE_EVERY_LAUNCHES === 0
  return { disable: file.lastSoftware && !probe, probe }
}

export interface GpuModeStoreDeps {
  readonly filePath: string
  readonly readFileSync: (filePath: string) => string
  readonly writeFileSync: (filePath: string, text: string) => void
  readonly mkdirSync: (dirPath: string) => void
  /** File problems are logged by the caller (main-errors.log); they must never stop the start. */
  readonly onError?: (where: string, error: unknown) => void
}

export interface GpuModeStore {
  /** The file as last read or written; defaults when it is missing or broken. Cached after the first read. */
  load(): GpuModeFile
  /** Merges the given fields into the file and writes it (a failed write keeps the values in memory). */
  save(partial: Partial<Omit<GpuModeFile, 'version'>>): GpuModeFile
  /** Counts this launch (call once, before decideAcceleration, so the probe test sees it). */
  recordLaunch(): GpuModeFile
  /**
   * Remembers whether the detected run rendered in software. Skipped when the GPU was disabled for this run (a
   * disabled GPU always looks like software, so it would make a wrong choice permanent) and for 'unknown'.
   */
  recordDetection(mode: GpuMode, accelerationWasDisabled: boolean): GpuModeFile
}

export function createGpuModeStore(deps: GpuModeStoreDeps): GpuModeStore {
  let cached: GpuModeFile | null = null

  function load(): GpuModeFile {
    if (cached !== null) return cached
    try {
      cached = parseGpuModeFile(deps.readFileSync(deps.filePath))
    } catch (error) {
      // First launch (no file yet) or an unreadable file: defaults are the safe answer, not a crash.
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (code !== 'ENOENT') deps.onError?.('gpu mode: read', error)
      cached = { ...DEFAULT_GPU_MODE }
    }
    return cached
  }

  function save(partial: Partial<Omit<GpuModeFile, 'version'>>): GpuModeFile {
    const current = load()
    const next: GpuModeFile = {
      version: 1,
      pref: isGpuPref(partial.pref) ? partial.pref : current.pref,
      lastSoftware: typeof partial.lastSoftware === 'boolean' ? partial.lastSoftware : current.lastSoftware,
      launches: isLaunchCount(partial.launches) ? partial.launches : current.launches,
      ...((partial.autoRestarted ?? current.autoRestarted) === true ? { autoRestarted: true } : {})
    }
    cached = next
    try {
      deps.mkdirSync(dirname(deps.filePath))
      deps.writeFileSync(deps.filePath, serializeGpuModeFile(next))
    } catch (error) {
      // In-memory state stays correct for this run; the next launch just starts from the old file.
      deps.onError?.('gpu mode: save', error)
    }
    return next
  }

  return {
    load,

    save,

    recordLaunch(): GpuModeFile {
      return save({ launches: load().launches + 1 })
    },

    recordDetection(mode: GpuMode, accelerationWasDisabled: boolean): GpuModeFile {
      const current = load()
      if (accelerationWasDisabled || mode === 'unknown') return current
      return save({ lastSoftware: mode === 'software' })
    }
  }
}
