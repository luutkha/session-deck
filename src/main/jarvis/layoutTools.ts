// Jarvis tool for the sessions sidebar's width (D70/D71): sidebar_width. Main checks the arguments in plain words; the
// window commits the width through the same path as the drag handle (screen + localStorage) and answers what it did.
// Registering the tool is index.ts's job.
import type { JarvisUiAction } from '../../shared/types'
import type { McpTool } from './mcpProtocol'
import { optionalBool, schema } from './toolArgs'
import type { JarvisToolDeps } from './jarvisTools'
import type { ToolContext } from './appTools'

/** Mirrors the D70 limits in src/renderer/shell/sidebarWidth.ts; the window clamps with the real ones. */
const SIDEBAR_WIDTH_MIN = 220
const SIDEBAR_WIDTH_MAX = 640
const SIDEBAR_WIDTH_DEFAULT = 300

export function createLayoutTools(deps: JarvisToolDeps, _ctx: ToolContext): McpTool[] {
  const ui = deps.ui

  return [
    {
      name: 'sidebar_width',
      description: `Width of the sessions sidebar (the session list on the left), ${SIDEBAR_WIDTH_MIN} to ${SIDEBAR_WIDTH_MAX} pixels: give width in pixels to set it, reset true to go back to the usual ${SIDEBAR_WIDTH_DEFAULT}px, or no arguments to report the current width. The width is saved for the next start.`,
      inputSchema: schema({
        width: { type: 'integer', description: `Pixels, ${SIDEBAR_WIDTH_MIN} to ${SIDEBAR_WIDTH_MAX}.` },
        reset: { type: 'boolean', description: `Back to the usual width (${SIDEBAR_WIDTH_DEFAULT}px).` }
      }),
      run: async (args) => {
        const reset = optionalBool(args, 'reset')
        const raw = args.width
        const hasWidth = raw !== undefined && raw !== null
        if (reset === true && hasWidth) throw new Error('Give "width" or "reset", not both.')
        let action: JarvisUiAction
        if (reset === true) {
          action = { kind: 'sidebarWidth', width: 'reset' }
        } else if (!hasWidth) {
          action = { kind: 'sidebarWidth', width: null }
        } else {
          if (typeof raw !== 'number' || !Number.isInteger(raw)) {
            throw new Error(`"width" must be a whole number of pixels, ${SIDEBAR_WIDTH_MIN} to ${SIDEBAR_WIDTH_MAX}.`)
          }
          if (raw < SIDEBAR_WIDTH_MIN || raw > SIDEBAR_WIDTH_MAX) {
            throw new Error(`"width" must be ${SIDEBAR_WIDTH_MIN} to ${SIDEBAR_WIDTH_MAX} pixels; ${raw} is outside that range.`)
          }
          action = { kind: 'sidebarWidth', width: raw }
        }
        const result = await ui(undefined, action)
        if (action.width !== null) deps.log('sidebar_width', action.width === 'reset' ? 'reset' : String(action.width))
        return result
      }
    }
  ]
}
