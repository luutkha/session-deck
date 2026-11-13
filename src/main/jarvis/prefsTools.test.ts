import { describe, expect, it, vi } from 'vitest'
import type { JarvisUiAction, UiMode } from '../../shared/types'
import type { JarvisToolDeps } from './jarvisTools'
import type { ToolContext } from './appTools'
import { createPrefsTools } from './prefsTools'

function setup() {
  const calls: Array<{ mode: UiMode | undefined; action: JarvisUiAction }> = []
  const log = vi.fn()
  const ui = vi.fn(async (mode: UiMode | undefined, action: JarvisUiAction): Promise<string> => {
    calls.push({ mode, action })
    return `the window applied ${action.kind}`
  })
  // Only ui and log are used, like the other window-only tool files.
  const deps = { ui, log } as unknown as JarvisToolDeps
  const tools = createPrefsTools(deps, {} as unknown as ToolContext)
  const run = (args: Record<string, unknown> = {}): Promise<string> => tools[0].run(args)
  return { tools, run, calls, log }
}

describe('terminal_settings tool (D71)', () => {
  it('is one window tool with the enums and ranges of Settings > Terminal', () => {
    const { tools } = setup()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('terminal_settings')
    const schema = tools[0].inputSchema as { properties: Record<string, { enum?: string[]; minimum?: number; maximum?: number }>; required: string[] }
    expect(schema.required).toEqual([])
    expect(schema.properties['renderer'].enum).toEqual(['auto', 'webgl', 'canvas', 'dom'])
    expect(schema.properties['effects'].enum).toEqual(['auto', 'full', 'reduced'])
    expect(schema.properties['right_click'].enum).toEqual(['menu', 'copy-paste'])
    expect(schema.properties['scrollback_lines'].minimum).toBe(1_000)
    expect(schema.properties['scrollback_lines'].maximum).toBe(100_000)
    expect(schema.properties['zoom_percent'].minimum).toBe(50)
    expect(schema.properties['zoom_percent'].maximum).toBe(200)
  })

  it('sends every field as one window action, without a mode, and logs it', async () => {
    const t = setup()
    const answer = await t.run({ renderer: 'dom', effects: 'reduced', scrollback_lines: 5_000, zoom_percent: 110, right_click: 'copy-paste' })
    expect(answer).toBe('the window applied terminalPrefs')
    expect(t.calls).toEqual([
      {
        mode: undefined,
        action: { kind: 'terminalPrefs', renderer: 'dom', effects: 'reduced', scrollbackLines: 5_000, zoomPercent: 110, rightClick: 'copy-paste' }
      }
    ])
    expect(t.log).toHaveBeenCalledTimes(1)
    expect(t.log).toHaveBeenCalledWith('terminal_settings', expect.stringContaining('"zoom_percent":110'))
  })

  it('sends only the fields given', async () => {
    const t = setup()
    await t.run({ zoom_percent: 120 })
    expect(t.calls[0].action).toEqual({ kind: 'terminalPrefs', zoomPercent: 120 })
    await t.run({ right_click: 'menu' })
    expect(t.calls[1].action).toEqual({ kind: 'terminalPrefs', rightClick: 'menu' })
  })

  it('only reports (and does not log) when nothing is asked', async () => {
    const t = setup()
    const answer = await t.run()
    expect(answer).toBe('the window applied terminalPrefs')
    expect(t.calls[0].action).toEqual({ kind: 'terminalPrefs' })
    expect(t.log).not.toHaveBeenCalled()
  })

  it('refuses values the Settings dialog would not offer', async () => {
    const t = setup()
    await expect(t.run({ renderer: 'vulkan' })).rejects.toThrow('"renderer" must be one of auto, webgl, canvas, dom.')
    await expect(t.run({ effects: 'off' })).rejects.toThrow('"effects" must be one of auto, full, reduced.')
    await expect(t.run({ right_click: 'paste' })).rejects.toThrow('"right_click" must be one of menu, copy-paste.')
    await expect(t.run({ scrollback_lines: 500 })).rejects.toThrow('"scrollback_lines" must be 1000 to 100000 lines; 500 is outside that range.')
    await expect(t.run({ zoom_percent: 500 })).rejects.toThrow('"zoom_percent" must be 50 to 200 percent; 500 is outside that range.')
    await expect(t.run({ zoom_percent: 100.5 })).rejects.toThrow('"zoom_percent" must be a whole number of percent, 50 to 200.')
    await expect(t.run({ scrollback_lines: '5000' })).rejects.toThrow('"scrollback_lines" must be a whole number of lines, 1000 to 100000.')
    expect(t.calls).toHaveLength(0)
    expect(t.log).not.toHaveBeenCalled()
  })
})
