import { describe, expect, it, vi } from 'vitest'
import type { McpTool } from './mcpProtocol'
import { createSystemTools, tuningHints, type AppLoad, type GpuWithPref, type JarvisSystemDeps, type SystemSnapshot } from './systemTools'

const snapshot = (over: Partial<SystemSnapshot> = {}): SystemSnapshot => ({
  platform: 'win32',
  osRelease: '10.0.22631',
  arch: 'x64',
  cpuModel: 'AMD Ryzen 7 5800X 8-Core Processor',
  cpuCores: 16,
  totalMemoryMB: 32 * 1024,
  freeMemoryMB: 16 * 1024,
  displays: [{ widthPx: 1920, heightPx: 1080, scaleFactor: 1 }],
  ...over
})

const gpu = (over: Partial<GpuWithPref> = {}): GpuWithPref => ({
  mode: 'hardware',
  renderer: 'NVIDIA GeForce RTX 3070',
  accelerationDisabled: false,
  webgl: 'enabled',
  pref: 'auto',
  ...over
})

const softwareGpu = (over: Partial<GpuWithPref> = {}): GpuWithPref => gpu({ mode: 'software', renderer: 'SwiftShader (software)', ...over })

const load = (over: Partial<AppLoad> = {}): AppLoad => ({ sessionsOpen: 4, sessionsRunning: 2, sessionsWorking: 1, ...over })

const tags = (hints: readonly string[]): string[] => hints.map((hint) => hint.slice(0, hint.indexOf(']') + 1))

interface Setup {
  readonly tools: readonly McpTool[]
  readonly setGpuPref: ReturnType<typeof vi.fn>
  readonly log: ReturnType<typeof vi.fn>
}

function setup(over: Partial<JarvisSystemDeps> = {}): Setup {
  const setGpuPref = vi.fn()
  const log = vi.fn()
  const deps: JarvisSystemDeps = {
    systemInfo: () => snapshot(),
    getGpu: async () => gpu(),
    setGpuPref,
    appLoad: () => load(),
    ...over
  }
  return { tools: createSystemTools(deps, log), setGpuPref, log }
}

function tool(tools: readonly McpTool[], name: string): McpTool {
  const found = tools.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`No tool ${name}`)
  return found
}

describe('tuningHints: GPU rule', () => {
  it('software rendering means DOM, reduced effects and acceleration off', () => {
    const hints = tuningHints(snapshot(), softwareGpu(), load())
    const text = hints.join('\n')
    expect(tags(hints)).toContain('[no-gpu]')
    expect(text).toContain('terminal renderer to dom')
    expect(text).toContain('visual effects to reduced')
    expect(text).toContain('GPU acceleration to off')
    expect(text).toContain('1,250%')
    expect(tags(hints)).not.toContain('[gpu]')
  })

  it('a real GPU keeps the renderer and effects on auto', () => {
    const hints = tuningHints(snapshot(), gpu(), load())
    const text = hints.join('\n')
    expect(tags(hints)).toContain('[gpu]')
    expect(text).toContain('NVIDIA GeForce RTX 3070')
    expect(text).toContain('terminal renderer on auto (WebGL)')
    expect(text).toContain('visual effects on auto')
    expect(tags(hints)).not.toContain('[no-gpu]')
  })

  it('an unknown GPU says nothing rather than guessing', () => {
    const hints = tuningHints(snapshot({ totalMemoryMB: Number.NaN }), gpu({ mode: 'unknown', renderer: '' }), load())
    expect(hints).toEqual([])
  })
})

describe('tuningHints: RAM bands', () => {
  it('7.9 GB is the low band', () => {
    const hints = tuningHints(snapshot({ totalMemoryMB: 7.9 * 1024 }), gpu(), load())
    expect(tags(hints)).toContain('[ram-low]')
    expect(hints.join('\n')).toContain('scrollback lines to 3000')
    expect(hints.join('\n')).toContain('sleep idle sessions after 20 minutes')
  })

  it('8 GB starts the middle band with 5000-10000 lines', () => {
    const hints = tuningHints(snapshot({ totalMemoryMB: 8 * 1024 }), gpu(), load())
    expect(tags(hints)).toContain('[ram-mid]')
    expect(hints.join('\n')).toContain('scrollback lines to 5000-10000')
    expect(tags(hints)).not.toContain('[ram-low]')
  })

  it('16 GB is still the middle band', () => {
    expect(tags(tuningHints(snapshot({ totalMemoryMB: 16 * 1024 }), gpu(), load()))).toContain('[ram-mid]')
  })

  it('above 16 GB allows up to 20000 lines', () => {
    const hints = tuningHints(snapshot({ totalMemoryMB: 16 * 1024 + 1 }), gpu(), load())
    expect(tags(hints)).toContain('[ram-high]')
    expect(hints.join('\n')).toContain('up to 20000')
  })
})

describe('tuningHints: cores, load and screens', () => {
  it('3 logical cores ask for reduced effects and fewer working sessions, as advice', () => {
    const hints = tuningHints(snapshot({ cpuCores: 3 }), gpu(), load())
    expect(tags(hints)).toContain('[few-cores]')
    expect(hints.join('\n')).toContain('visual effects to reduced')
    expect(hints.join('\n')).toContain('advice, not a setting')
  })

  it('4 logical cores fire no core rule', () => {
    expect(tags(tuningHints(snapshot({ cpuCores: 4 }), gpu(), load()))).not.toContain('[few-cores]')
  })

  it('10 working sessions mention that auto effects already reduce work; 9 do not', () => {
    expect(tags(tuningHints(snapshot(), gpu(), load({ sessionsWorking: 10 })))).toContain('[many-working]')
    expect(tags(tuningHints(snapshot(), gpu(), load({ sessionsWorking: 9 })))).not.toContain('[many-working]')
  })

  it('a scale factor above 1.5 fires the screen rule; exactly 1.5 does not', () => {
    const at = (scaleFactor: number, widthPx = 1920): SystemSnapshot =>
      snapshot({ displays: [{ widthPx, heightPx: 1080, scaleFactor }] })
    expect(tags(tuningHints(at(1.5), gpu(), load()))).not.toContain('[large-screen]')
    expect(tags(tuningHints(at(1.6), gpu(), load()))).toContain('[large-screen]')
    expect(tuningHints(at(1.6), gpu(), load()).join('\n')).toContain('terminal zoom percent to 110')
  })

  it('a width above 2560 fires the screen rule; exactly 2560 does not', () => {
    const at = (widthPx: number): SystemSnapshot => snapshot({ displays: [{ widthPx, heightPx: 1440, scaleFactor: 1 }] })
    expect(tags(tuningHints(at(2560), gpu(), load()))).not.toContain('[large-screen]')
    expect(tags(tuningHints(at(2561), gpu(), load()))).toContain('[large-screen]')
  })

  it('returns [] when nothing applies', () => {
    const unknown = snapshot({ totalMemoryMB: Number.NaN, cpuCores: Number.NaN, displays: [] })
    expect(tuningHints(unknown, gpu({ mode: 'unknown', renderer: '' }), load())).toEqual([])
  })

  it('never throws on nonsense measurements', () => {
    const odd = snapshot({ totalMemoryMB: Number.NaN, cpuCores: Number.NaN, displays: [] })
    expect(() => tuningHints(odd, gpu(), load({ sessionsWorking: Number.NaN }))).not.toThrow()
    expect(tags(tuningHints(odd, gpu(), load({ sessionsWorking: Number.NaN })))).not.toContain('[ram-low]')
  })
})

describe('get_system_info', () => {
  it('reports specs, GPU, app load and the tuning hints', async () => {
    const { tools } = setup()
    const text = await tool(tools, 'get_system_info').run({})
    expect(text).toContain('PC: win32 10.0.22631 (x64)')
    expect(text).toContain('CPU: AMD Ryzen 7 5800X 8-Core Processor (16 logical cores)')
    expect(text).toContain('Memory: 32.0 GB total, 16.0 GB free')
    expect(text).toContain('Displays: 1920x1080 @ 100%')
    expect(text).toContain('GPU: hardware (NVIDIA GeForce RTX 3070); acceleration disabled: no; saved preference: auto')
    expect(text).toContain('App load: 4 session(s) open (2 running, 1 working)')
    expect(text).toContain('Tuning hints for this PC:')
    expect(text).toContain('[gpu] Real GPU')
  })

  it('says when there is nothing to tune', async () => {
    const { tools } = setup({
      systemInfo: () => snapshot({ totalMemoryMB: Number.NaN, cpuCores: 8 }),
      getGpu: async () => gpu({ mode: 'unknown', renderer: '' })
    })
    const text = await tool(tools, 'get_system_info').run({})
    expect(text).toContain('- Nothing to change; the defaults fit this PC.')
  })

  it('says when acceleration is disabled and which preference is saved', async () => {
    const { tools } = setup({ getGpu: async () => softwareGpu({ accelerationDisabled: true, pref: 'off' }) })
    const text = await tool(tools, 'get_system_info').run({})
    expect(text).toContain('GPU: software (SwiftShader (software))')
    expect(text).toContain('acceleration disabled: yes; saved preference: off')
    expect(text).toContain('[no-gpu]')
  })

  it('shows "GPU: unknown (reason)" when the GPU reading fails, and still returns the rest', async () => {
    const { tools } = setup({
      getGpu: async () => {
        throw new Error('GPU process did not answer')
      }
    })
    const text = await tool(tools, 'get_system_info').run({})
    expect(text).toContain('GPU: unknown (GPU process did not answer)')
    expect(text).toContain('Memory: 32.0 GB total')
    expect(text).toContain('Tuning hints for this PC:')
    expect(text).toContain('[ram-high]')
    expect(text).not.toContain('visual effects on auto')
  })
})

describe('gpu_setting', () => {
  it('offers exactly auto, on and off and says it applies after a restart', () => {
    const { tools } = setup()
    const gpuTool = tool(tools, 'gpu_setting')
    expect(gpuTool.inputSchema).toMatchObject({
      type: 'object',
      properties: { pref: { type: 'string', enum: ['auto', 'on', 'off'] } },
      required: ['pref']
    })
    expect(gpuTool.description).toContain('restarts')
  })

  it('saves the preference once, logs it, and explains the three values', async () => {
    const { tools, setGpuPref, log } = setup()
    const text = await tool(tools, 'gpu_setting').run({ pref: 'off' })
    expect(setGpuPref).toHaveBeenCalledTimes(1)
    expect(setGpuPref).toHaveBeenCalledWith('off')
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('gpu_setting', 'off')
    expect(text).toContain('applies after SessionDeck restarts')
    expect(text).toContain('auto = acceleration off after a software-only run')
    expect(text).toContain('on = always on')
    expect(text).toContain('off = always off')
  })

  it('accepts padding and upper case', async () => {
    const { tools, setGpuPref } = setup()
    await tool(tools, 'gpu_setting').run({ pref: ' ON ' })
    expect(setGpuPref).toHaveBeenCalledWith('on')
  })

  it('rejects an unknown value with a clear error and saves nothing', async () => {
    const { tools, setGpuPref, log } = setup()
    await expect(tool(tools, 'gpu_setting').run({ pref: 'sometimes' })).rejects.toThrow('"pref" must be auto, on or off (got "sometimes").')
    await expect(tool(tools, 'gpu_setting').run({ pref: 42 })).rejects.toThrow('"pref" must be auto, on or off.')
    await expect(tool(tools, 'gpu_setting').run({})).rejects.toThrow('"pref" is required: auto, on or off.')
    expect(setGpuPref).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
})
