import { beforeEach, describe, expect, it } from 'vitest'
import {
  createGpuModeStore,
  decideAcceleration,
  DEFAULT_GPU_MODE,
  GPU_MODE_FILE_NAME,
  GPU_PROBE_EVERY_LAUNCHES,
  gpuModeFilePath,
  isGpuPref,
  parseGpuModeFile,
  serializeGpuModeFile,
  shouldRestartForSoftware,
  type GpuModeFile,
  type GpuModeStore
} from './gpuMode'

const FILE = gpuModeFilePath('C:/userData')
/** dirname(FILE) without importing node:path into the test: the folder the store must create. */
const DIRNAME = FILE.slice(0, FILE.length - GPU_MODE_FILE_NAME.length - 1)

describe('parseGpuModeFile', () => {
  it('reads a good file', () => {
    expect(parseGpuModeFile('{"version":1,"pref":"off","lastSoftware":true,"launches":7}')).toEqual({
      version: 1,
      pref: 'off',
      lastSoftware: true,
      launches: 7
    })
  })

  it('falls back to the defaults for a broken or unexpected file', () => {
    expect(parseGpuModeFile('')).toEqual(DEFAULT_GPU_MODE)
    expect(parseGpuModeFile('{oops')).toEqual(DEFAULT_GPU_MODE)
    expect(parseGpuModeFile('null')).toEqual(DEFAULT_GPU_MODE)
    expect(parseGpuModeFile('[]')).toEqual(DEFAULT_GPU_MODE)
    expect(parseGpuModeFile('{"version":2,"pref":"off"}')).toEqual(DEFAULT_GPU_MODE)
  })

  it('drops single bad fields instead of dropping the whole file', () => {
    expect(parseGpuModeFile('{"version":1,"pref":"sometimes","lastSoftware":"yes","launches":-4}')).toEqual({
      version: 1,
      pref: 'auto',
      lastSoftware: false,
      launches: 0
    })
    expect(parseGpuModeFile('{"version":1}')).toEqual(DEFAULT_GPU_MODE)
    expect(parseGpuModeFile('{"version":1,"launches":1.5}').launches).toBe(0)
  })

  it('round-trips through serializeGpuModeFile', () => {
    const file: GpuModeFile = { version: 1, pref: 'on', lastSoftware: true, launches: 12 }
    expect(parseGpuModeFile(serializeGpuModeFile(file))).toEqual(file)
    expect(JSON.parse(serializeGpuModeFile(file))).toEqual({ version: 1, pref: 'on', lastSoftware: true, launches: 12 })
  })

  it('knows the three preferences', () => {
    expect(isGpuPref('auto')).toBe(true)
    expect(isGpuPref('on')).toBe(true)
    expect(isGpuPref('off')).toBe(true)
    expect(isGpuPref('OFF')).toBe(false)
    expect(isGpuPref(undefined)).toBe(false)
  })
})

describe('decideAcceleration', () => {
  const auto = (extra: Partial<GpuModeFile> = {}): GpuModeFile => ({ ...DEFAULT_GPU_MODE, ...extra })

  it('lets the environment decide first', () => {
    expect(decideAcceleration(auto({ pref: 'on', lastSoftware: false }), 'off')).toEqual({ disable: true, probe: false })
    expect(decideAcceleration(auto({ pref: 'off', lastSoftware: true }), 'on')).toEqual({ disable: false, probe: false })
    expect(decideAcceleration(auto({ lastSoftware: true, launches: 5 }), ' OFF ')).toEqual({ disable: true, probe: false })
  })

  it('follows an explicit preference', () => {
    expect(decideAcceleration(auto({ pref: 'off' }), undefined)).toEqual({ disable: true, probe: false })
    expect(decideAcceleration(auto({ pref: 'on', lastSoftware: true }), undefined)).toEqual({ disable: false, probe: false })
    expect(decideAcceleration(auto({ pref: 'on', lastSoftware: true, launches: 10 }), '')).toEqual({ disable: false, probe: false })
  })

  it('auto: disables acceleration after a software run', () => {
    expect(decideAcceleration(auto({ lastSoftware: true, launches: 3 }), undefined)).toEqual({ disable: true, probe: false })
  })

  it('auto: keeps acceleration on when the last run was hardware or unknown', () => {
    expect(decideAcceleration(auto({ lastSoftware: false, launches: 3 }), undefined)).toEqual({ disable: false, probe: false })
  })

  it('auto: a probe launch keeps acceleration enabled so the detection can correct itself', () => {
    const probeLaunch = auto({ lastSoftware: true, launches: GPU_PROBE_EVERY_LAUNCHES })
    expect(decideAcceleration(probeLaunch, undefined)).toEqual({ disable: false, probe: true })
    expect(decideAcceleration(auto({ lastSoftware: true, launches: 20 }), undefined)).toEqual({ disable: false, probe: true })
    expect(decideAcceleration(auto({ lastSoftware: true, launches: 11 }), undefined)).toEqual({ disable: true, probe: false })
  })

  it('auto: an empty file (first launch) does not disable anything', () => {
    expect(decideAcceleration(auto(), undefined)).toEqual({ disable: false, probe: true })
  })

  it('ignores an unknown preference value', () => {
    expect(decideAcceleration(auto({ pref: 'weird' as never, lastSoftware: true, launches: 2 }), undefined)).toEqual({
      disable: true,
      probe: false
    })
  })
})

describe('shouldRestartForSoftware (first run without a GPU)', () => {
  const base = {
    file: { ...DEFAULT_GPU_MODE, launches: 1 } as GpuModeFile,
    env: undefined as string | undefined,
    accelerationDisabled: false,
    softwareSeen: true,
    gpuDecidedByLaunch: false
  }

  it('restarts the first time software rendering is seen in auto mode', () => {
    expect(shouldRestartForSoftware(base)).toBe(true)
  })

  it('does not restart when no software rendering was seen', () => {
    expect(shouldRestartForSoftware({ ...base, softwareSeen: false })).toBe(false)
  })

  it('does not restart when the GPU process is already off for this run', () => {
    expect(shouldRestartForSoftware({ ...base, accelerationDisabled: true })).toBe(false)
  })

  it('does not restart when a launch switch already decided (--disable-gpu, test switch)', () => {
    expect(shouldRestartForSoftware({ ...base, gpuDecidedByLaunch: true })).toBe(false)
  })

  it('does not restart when SESSIONDECK_GPU decides, in either direction', () => {
    expect(shouldRestartForSoftware({ ...base, env: 'on' })).toBe(false)
    expect(shouldRestartForSoftware({ ...base, env: ' OFF ' })).toBe(false)
    expect(shouldRestartForSoftware({ ...base, env: 'whatever' })).toBe(true)
  })

  it('does not restart when the user saved a preference', () => {
    expect(shouldRestartForSoftware({ ...base, file: { ...base.file, pref: 'on' } })).toBe(false)
    expect(shouldRestartForSoftware({ ...base, file: { ...base.file, pref: 'off' } })).toBe(false)
  })

  it('does not restart on a probe run of a PC already known to be software (stays up)', () => {
    expect(shouldRestartForSoftware({ ...base, file: { ...base.file, lastSoftware: true, launches: 10 } })).toBe(false)
  })

  it('never restarts twice', () => {
    expect(shouldRestartForSoftware({ ...base, file: { ...base.file, autoRestarted: true } })).toBe(false)
  })
})

describe('autoRestarted flag in the file', () => {
  it('is kept through parse, serialize and save, and omitted when false', () => {
    const file: GpuModeFile = { version: 1, pref: 'auto', lastSoftware: true, launches: 2, autoRestarted: true }
    expect(parseGpuModeFile(serializeGpuModeFile(file))).toEqual(file)
    expect(JSON.parse(serializeGpuModeFile({ ...file, autoRestarted: false })).autoRestarted).toBeUndefined()
    expect(parseGpuModeFile('{"version":1,"autoRestarted":"yes"}').autoRestarted).toBeUndefined()
    const store = createGpuModeStore({
      filePath: FILE,
      readFileSync: () => serializeGpuModeFile(file),
      writeFileSync: () => undefined,
      mkdirSync: () => undefined
    })
    expect(store.save({ launches: 3 }).autoRestarted).toBe(true)
  })
})

describe('createGpuModeStore', () => {
  let disk: Map<string, string>
  let dirs: string[]
  let writes: string[]
  let errors: string[]
  let readCalls: number
  let failRead: Error | null
  let failWrite: Error | null
  let store: GpuModeStore

  beforeEach(() => {
    disk = new Map()
    dirs = []
    writes = []
    errors = []
    readCalls = 0
    failRead = null
    failWrite = null
    store = createGpuModeStore({
      filePath: FILE,
      readFileSync: (filePath) => {
        readCalls += 1
        if (failRead !== null) throw failRead
        const text = disk.get(filePath)
        if (text === undefined) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
        return text
      },
      writeFileSync: (filePath, text) => {
        if (failWrite !== null) throw failWrite
        disk.set(filePath, text)
        writes.push(text)
      },
      mkdirSync: (dirPath) => {
        dirs.push(dirPath)
      },
      onError: (where, error) => {
        errors.push(`${where}: ${String((error as Error).message)}`)
      }
    })
  })

  it('loads the defaults when the file does not exist, without logging an error', () => {
    expect(store.load()).toEqual(DEFAULT_GPU_MODE)
    expect(errors).toEqual([])
    expect(readCalls).toBe(1)
  })

  it('loads the stored file once and caches it', () => {
    disk.set(FILE, '{"version":1,"pref":"off","lastSoftware":true,"launches":4}')
    expect(store.load()).toEqual({ version: 1, pref: 'off', lastSoftware: true, launches: 4 })
    expect(store.load()).toEqual({ version: 1, pref: 'off', lastSoftware: true, launches: 4 })
    expect(readCalls).toBe(1)
  })

  it('uses the defaults for a broken file and keeps going', () => {
    disk.set(FILE, 'not json')
    expect(store.load()).toEqual(DEFAULT_GPU_MODE)
    expect(errors).toEqual([])
  })

  it('logs an unreadable file that is not just missing', () => {
    failRead = Object.assign(new Error('EPERM: denied'), { code: 'EPERM' })
    expect(store.load()).toEqual(DEFAULT_GPU_MODE)
    expect(errors).toEqual(['gpu mode: read: EPERM: denied'])
  })

  it('creates the folder and writes the file on save', () => {
    const saved = store.save({ pref: 'off' })
    expect(saved.pref).toBe('off')
    expect(dirs).toEqual([DIRNAME])
    expect(JSON.parse(writes[writes.length - 1])).toEqual({ version: 1, pref: 'off', lastSoftware: false, launches: 0 })
    expect(disk.get(FILE)).toBe(writes[writes.length - 1])
  })

  it('merges a partial save into the current values and ignores junk', () => {
    store.save({ pref: 'on', lastSoftware: true, launches: 3 })
    const saved = store.save({ launches: Number.NaN, pref: 'sometimes' as never })
    expect(saved).toEqual({ version: 1, pref: 'on', lastSoftware: true, launches: 3 })
  })

  it('keeps the value in memory when the write fails', () => {
    failWrite = new Error('disk full')
    expect(store.save({ pref: 'off' })).toEqual({ version: 1, pref: 'off', lastSoftware: false, launches: 0 })
    expect(store.load().pref).toBe('off')
    expect(errors).toEqual(['gpu mode: save: disk full'])
  })

  it('recordLaunch counts this launch and writes it', () => {
    disk.set(FILE, '{"version":1,"pref":"auto","lastSoftware":false,"launches":9}')
    expect(store.recordLaunch().launches).toBe(10)
    expect(store.recordLaunch().launches).toBe(11)
    expect(disk.get(FILE)).toContain('"launches":11')
  })

  it('recordDetection remembers a software run', () => {
    expect(store.recordDetection('software', false).lastSoftware).toBe(true)
    expect(store.load().lastSoftware).toBe(true)
    expect(store.recordDetection('hardware', false).lastSoftware).toBe(false)
  })

  it('recordDetection keeps the stored value when the GPU was disabled for the run', () => {
    store.save({ lastSoftware: true })
    expect(store.recordDetection('software', true).lastSoftware).toBe(true)
    expect(store.recordDetection('hardware', true).lastSoftware).toBe(true)
  })

  it('recordDetection never changes the value for an unknown mode', () => {
    store.save({ lastSoftware: false })
    expect(store.recordDetection('unknown', false).lastSoftware).toBe(false)
    store.save({ lastSoftware: true })
    expect(store.recordDetection('unknown', false).lastSoftware).toBe(true)
  })

  it('recordDetection does not write a file when nothing changed', () => {
    store.load()
    const before = writes.length
    store.recordDetection('unknown', false)
    store.recordDetection('hardware', true)
    expect(writes).toHaveLength(before)
  })
})
