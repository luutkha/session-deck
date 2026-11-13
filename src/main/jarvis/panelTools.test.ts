import { describe, expect, it, vi } from 'vitest'
import type { JarvisUiAction, UiMode } from '../../shared/types'
import type { JarvisToolDeps } from './jarvisTools'
import type { ToolContext } from './appTools'
import { createPanelTools } from './panelTools'

function setup() {
  const calls: Array<{ mode: UiMode | undefined; action: JarvisUiAction }> = []
  const log = vi.fn()
  const ui = vi.fn(async (mode: UiMode | undefined, action: JarvisUiAction): Promise<string> => {
    calls.push({ mode, action })
    return `the window applied ${action.kind}`
  })
  // Only ui and log are used, like the other window-only tool files.
  const deps = { ui, log } as unknown as JarvisToolDeps
  const tools = createPanelTools(deps, {} as unknown as ToolContext)
  const run = (args: Record<string, unknown> = {}): Promise<string> => tools[0].run(args)
  return { tools, run, calls, log }
}

describe('jarvis_panel_settings tool (D54)', () => {
  it('is one window tool with the panel limits and the Claude-engine note', () => {
    const { tools } = setup()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('jarvis_panel_settings')
    expect(tools[0].description).toContain('Claude engine')
    expect(tools[0].description).toContain('340')
    const schema = tools[0].inputSchema as { properties: Record<string, { type?: string; minimum?: number }>; required: string[] }
    expect(schema.required).toEqual([])
    expect(schema.properties['read_aloud'].type).toBe('boolean')
    expect(schema.properties['panel_width'].type).toBe('integer')
    expect(schema.properties['panel_width'].minimum).toBe(340)
    expect(schema.properties['reset_panel_width'].type).toBe('boolean')
  })

  it('sends every field as one window action, without a mode, and logs it', async () => {
    const t = setup()
    const answer = await t.run({ read_aloud: true, panel_width: 420 })
    expect(answer).toBe('the window applied jarvisPrefs')
    expect(t.calls).toEqual([
      { mode: undefined, action: { kind: 'jarvisPrefs', speak: true, panelWidth: 420 } }
    ])
    expect(t.log).toHaveBeenCalledTimes(1)
    expect(t.log).toHaveBeenCalledWith('jarvis_panel_settings', expect.stringContaining('"panel_width":420'))
  })

  it('sends only the fields given, and reset as the panel width', async () => {
    const t = setup()
    await t.run({ panel_width: 500 })
    expect(t.calls[0].action).toEqual({ kind: 'jarvisPrefs', panelWidth: 500 })
    await t.run({ reset_panel_width: true })
    expect(t.calls[1].action).toEqual({ kind: 'jarvisPrefs', panelWidth: 'reset' })
    await t.run({ read_aloud: false })
    expect(t.calls[2].action).toEqual({ kind: 'jarvisPrefs', speak: false })
  })

  it('only reports (and does not log) when nothing is asked', async () => {
    const t = setup()
    const answer = await t.run()
    expect(answer).toBe('the window applied jarvisPrefs')
    expect(t.calls[0].action).toEqual({ kind: 'jarvisPrefs' })
    expect(t.log).not.toHaveBeenCalled()
  })

  it('refuses values the panel would not offer, and both width fields at once', async () => {
    const t = setup()
    await expect(t.run({ read_aloud: 'yes' })).rejects.toThrow('"read_aloud" must be true or false.')
    await expect(t.run({ panel_width: 100 })).rejects.toThrow('"panel_width" must be at least 340px; 100 is smaller.')
    await expect(t.run({ panel_width: 400.5 })).rejects.toThrow('"panel_width" must be a whole number of pixels, 340 or more.')
    await expect(t.run({ panel_width: '400' })).rejects.toThrow('"panel_width" must be a whole number of pixels, 340 or more.')
    await expect(t.run({ panel_width: 400, reset_panel_width: true })).rejects.toThrow('Give either "panel_width" or "reset_panel_width", not both.')
    expect(t.calls).toHaveLength(0)
    expect(t.log).not.toHaveBeenCalled()
  })
})
