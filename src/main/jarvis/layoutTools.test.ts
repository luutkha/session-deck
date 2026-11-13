import { describe, expect, it, vi } from 'vitest'
import type { JarvisUiAction, UiMode } from '../../shared/types'
import { createLayoutTools } from './layoutTools'
import type { JarvisToolDeps } from './jarvisTools'
import type { ToolContext } from './appTools'

function setup() {
  const calls: Array<{ mode: UiMode | undefined; action: JarvisUiAction }> = []
  const deps = {
    getData: () => ({ sessions: [] }),
    log: vi.fn(),
    ui: vi.fn(async (mode: UiMode | undefined, action: JarvisUiAction): Promise<string> => {
      calls.push({ mode, action })
      return 'The sidebar is now 420px wide.'
    })
  } as unknown as JarvisToolDeps
  const tool = createLayoutTools(deps, {} as unknown as ToolContext).find((t) => t.name === 'sidebar_width')
  if (tool === undefined) throw new Error('The sidebar_width tool is missing.')
  return { tool, calls, log: deps.log as unknown as ReturnType<typeof vi.fn> }
}

describe('layoutTools: sidebar_width (D70)', () => {
  it('rejects a non-integer, a width outside 220-640, or width together with reset', async () => {
    const { tool, calls, log } = setup()
    await expect(tool.run({ width: 420.5 })).rejects.toThrow('whole number of pixels, 220 to 640')
    await expect(tool.run({ width: '300' })).rejects.toThrow('whole number of pixels, 220 to 640')
    await expect(tool.run({ width: 900 })).rejects.toThrow('220 to 640 pixels; 900 is outside')
    await expect(tool.run({ width: 100 })).rejects.toThrow('100 is outside that range')
    await expect(tool.run({ width: 300, reset: true })).rejects.toThrow('not both')
    expect(calls).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('sends the width action and logs only a change', async () => {
    const { tool, calls, log } = setup()
    expect(await tool.run({ width: 420 })).toBe('The sidebar is now 420px wide.')
    expect(calls).toEqual([{ mode: undefined, action: { kind: 'sidebarWidth', width: 420 } }])
    expect(log).toHaveBeenCalledWith('sidebar_width', '420')
    await tool.run({ reset: true })
    expect(calls.at(-1)?.action).toEqual({ kind: 'sidebarWidth', width: 'reset' })
    expect(log).toHaveBeenLastCalledWith('sidebar_width', 'reset')
  })

  it('only reports when given neither width nor reset, and logs nothing', async () => {
    const { tool, calls, log } = setup()
    await tool.run({})
    expect(calls).toEqual([{ mode: undefined, action: { kind: 'sidebarWidth', width: null } }])
    expect(log).not.toHaveBeenCalled()
  })
})
