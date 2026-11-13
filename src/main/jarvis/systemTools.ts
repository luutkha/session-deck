// Jarvis tools that look at the PC SessionDeck runs on (D53): its specs, screens and GPU, how loaded the app is, and the
// GPU acceleration preference (gpu-mode.json, applied at the next start). The tuning hints are pure rules so Jarvis can
// answer "tune the settings for this PC" with the settings it can actually change, not guesses.
import { errorMessage } from '../../shared/guards'
import type { GpuInfo, GpuPref } from '../../shared/types'
import type { McpTool } from './mcpProtocol'
import { schema } from './toolArgs'

/** One screen as main reports it: pixels and the Windows scale factor (1.5 = 150%). */
export interface SystemDisplay {
  readonly widthPx: number
  readonly heightPx: number
  readonly scaleFactor: number
}

export interface SystemSnapshot {
  readonly platform: string
  readonly osRelease: string
  readonly arch: string
  readonly cpuModel: string
  /** Logical cores (what the scheduler sees), not physical cores. */
  readonly cpuCores: number
  readonly totalMemoryMB: number
  readonly freeMemoryMB: number
  readonly displays: readonly SystemDisplay[]
}

/** What the app is doing right now; plain counters so this module stays pure. */
export interface AppLoad {
  readonly sessionsOpen: number
  readonly sessionsRunning: number
  readonly sessionsWorking: number
}

/** What the system tools need from main. All IO is injected, so tests pass fakes. */
export interface JarvisSystemDeps {
  readonly systemInfo: () => SystemSnapshot
  readonly getGpu: () => Promise<GpuInfo & { readonly pref: GpuPref }>
  readonly setGpuPref: (pref: GpuPref) => void
  readonly appLoad: () => AppLoad
}

/** GpuInfo together with the saved preference: one call gives Jarvis both. */
export type GpuWithPref = GpuInfo & { readonly pref: GpuPref }

const MB_PER_GB = 1024
/** Both bands are exclusive on the outside: under 8 GB is the low band, 8 to 16 GB inclusive the middle one. */
const RAM_LOW_MB = 8 * MB_PER_GB
const RAM_HIGH_MB = 16 * MB_PER_GB
const CORES_FEW = 4
const SESSIONS_BUSY = 10
const SCREEN_SCALE_HIGH = 1.5
const SCREEN_WIDTH_HIGH = 2560
/** The app keeps at most this many live terminals, each holding its own scrollback. */
const LIVE_TERMINALS_MAX = 12

/** Used for the hints when the GPU could not be read: 'unknown' fires no GPU rule, so nothing is guessed. */
const UNKNOWN_GPU: GpuWithPref = { mode: 'unknown', renderer: '', accelerationDisabled: false, webgl: '', pref: 'auto' }

function gb(megabytes: number): string {
  return (megabytes / MB_PER_GB).toFixed(1)
}

function rendererText(gpu: GpuWithPref): string {
  return gpu.renderer.trim().length > 0 ? ` (${gpu.renderer})` : ''
}

function displayText(displays: readonly SystemDisplay[]): string {
  if (displays.length === 0) return 'none reported'
  return displays.map((d) => `${d.widthPx}x${d.heightPx} @ ${Math.round(d.scaleFactor * 100)}%`).join(', ')
}

/**
 * One line per rule that fires, each tagged with the rule name so Jarvis can name its reason. Pure: no IO, no throws
 * (a missing or nonsensical measurement simply fires no rule). Empty only when nothing applies.
 */
export function tuningHints(snapshot: SystemSnapshot, gpu: GpuWithPref, load: AppLoad): string[] {
  const hints: string[] = []

  if (gpu.mode === 'software') {
    hints.push(
      '[no-gpu] No usable GPU (software rendering): set terminal renderer to dom, visual effects to reduced and GPU acceleration to off. ' +
        'Measured here: WebGL on a CPU burned ~1,250% CPU; DOM was ~65%.'
    )
  } else if (gpu.mode === 'hardware') {
    hints.push(`[gpu] Real GPU${rendererText(gpu)}: keep terminal renderer on auto (WebGL) and visual effects on auto.`)
  }
  // 'unknown' says nothing: guessing from a failed detection is how a machine ends up with the wrong renderer.

  const totalMB = snapshot.totalMemoryMB
  // A missing measurement must not fall into the "lots of RAM" band.
  if (Number.isFinite(totalMB)) {
    if (totalMB < RAM_LOW_MB) {
      hints.push(
        `[ram-low] ${gb(totalMB)} GB of RAM: set terminal scrollback lines to 3000 and turn on sleep idle sessions after 20 minutes ` +
          '(update_settings {"sleep":{"enabled":true,"afterMinutes":20}}). Each live terminal holds its scrollback (at most ' +
          `${LIVE_TERMINALS_MAX} live).`
      )
    } else if (totalMB <= RAM_HIGH_MB) {
      hints.push(
        `[ram-mid] ${gb(totalMB)} GB of RAM: set terminal scrollback lines to 5000-10000. Each live terminal holds its scrollback ` +
          `(at most ${LIVE_TERMINALS_MAX} live).`
      )
    } else {
      hints.push(
        `[ram-high] ${gb(totalMB)} GB of RAM: terminal scrollback up to 20000 lines is fine. Each live terminal holds its scrollback ` +
          `(at most ${LIVE_TERMINALS_MAX} live).`
      )
    }
  }

  if (snapshot.cpuCores < CORES_FEW) {
    hints.push(
      `[few-cores] Only ${snapshot.cpuCores} logical cores: set visual effects to reduced, and run fewer sessions working at once ` +
        '(advice, not a setting).'
    )
  }

  if (load.sessionsWorking >= SESSIONS_BUSY) {
    hints.push(
      `[many-working] ${load.sessionsWorking} sessions are working: visual effects auto already reduces animation work, so leave it on auto.`
    )
  }

  const displays = Array.isArray(snapshot.displays) ? snapshot.displays : []
  const bigScreen = displays.find((d) => d.scaleFactor > SCREEN_SCALE_HIGH || d.widthPx > SCREEN_WIDTH_HIGH)
  if (bigScreen !== undefined) {
    hints.push(
      `[large-screen] ${bigScreen.widthPx} px wide at ${bigScreen.scaleFactor}x: set terminal zoom percent to 110 (range 50-200); ` +
        'go down to 90 if you need more columns.'
    )
  }

  return hints
}

function gpuPrefArg(args: Readonly<Record<string, unknown>>): GpuPref {
  const value = args.pref
  if (value === undefined || value === null) throw new Error('"pref" is required: auto, on or off.')
  if (typeof value !== 'string') throw new Error('"pref" must be auto, on or off.')
  const pref = value.trim().toLowerCase()
  if (pref !== 'auto' && pref !== 'on' && pref !== 'off') throw new Error(`"pref" must be auto, on or off (got "${value}").`)
  return pref
}

function gpuLine(gpu: GpuWithPref | null, error: string | null): string {
  if (gpu === null) return `GPU: unknown (${error ?? 'not detected'})`
  return (
    `GPU: ${gpu.mode}${rendererText(gpu)}; acceleration disabled: ${gpu.accelerationDisabled ? 'yes' : 'no'}; ` +
    `saved preference: ${gpu.pref}`
  )
}

export function createSystemTools(deps: JarvisSystemDeps, log: (tool: string, detail: string) => void): McpTool[] {
  return [
    {
      name: 'get_system_info',
      description:
        "Reads this PC: OS, CPU and logical cores, RAM, screens, the GPU (hardware / software / unknown, renderer name, whether acceleration is disabled, the saved GPU preference), how loaded SessionDeck is (sessions open, running, working), and tuning hints that name the setting to change. Call it before tuning settings for this PC.",
      inputSchema: schema({}),
      run: async () => {
        const snapshot = deps.systemInfo()
        const load = deps.appLoad()
        let gpu: GpuWithPref | null = null
        let gpuError: string | null = null
        try {
          gpu = await deps.getGpu()
        } catch (error) {
          // A missing GPU reading must not hide the rest of the specs.
          gpuError = errorMessage(error)
        }
        const lines = [
          `PC: ${snapshot.platform} ${snapshot.osRelease} (${snapshot.arch})`,
          `CPU: ${snapshot.cpuModel.trim().length > 0 ? snapshot.cpuModel : 'unknown'} (${snapshot.cpuCores} logical cores)`,
          `Memory: ${gb(snapshot.totalMemoryMB)} GB total, ${gb(snapshot.freeMemoryMB)} GB free`,
          `Displays: ${displayText(snapshot.displays)}`,
          gpuLine(gpu, gpuError),
          `App load: ${load.sessionsOpen} session(s) open (${load.sessionsRunning} running, ${load.sessionsWorking} working)`,
          'Tuning hints for this PC:'
        ]
        const hints = tuningHints(snapshot, gpu ?? UNKNOWN_GPU, load)
        if (hints.length === 0) lines.push('- Nothing to change; the defaults fit this PC.')
        else hints.forEach((hint, index) => lines.push(`${index + 1}. ${hint}`))
        return lines.join('\n')
      }
    },
    {
      name: 'gpu_setting',
      description:
        'Sets the GPU acceleration preference (Settings > Terminal): auto, on or off. It applies after SessionDeck restarts; the current run keeps the setting it started with. auto = acceleration off after a software-only run (on otherwise), on = always on, off = always off.',
      inputSchema: schema({
        pref: { type: 'string', enum: ['auto', 'on', 'off'], description: 'auto = off after a software-only run, on = always on, off = always off.' }
      }, ['pref']),
      run: async (args) => {
        const pref = gpuPrefArg(args)
        deps.setGpuPref(pref)
        log('gpu_setting', pref)
        return (
          `GPU acceleration preference saved as "${pref}". It applies after SessionDeck restarts; this run keeps the setting it started with. ` +
          'auto = acceleration off after a software-only run (on otherwise), on = always on, off = always off.'
        )
      }
    }
  ]
}
