// Jarvis tool for the Jarvis panel's own two settings (D54): "read Jarvis's replies aloud" and the panel width. The
// window keeps them in localStorage, so main only validates the arguments and asks the window to apply them (the same
// round trip as sound_settings and terminal_settings). The tool is registered in index.ts like the other tool files.
import type { JarvisUiAction } from '../../shared/types'
import type { McpTool } from './mcpProtocol'
import { optionalBool, schema } from './toolArgs'
import type { JarvisToolDeps } from './jarvisTools'
import type { ToolContext } from './appTools'

// The panel's own numbers (renderer/jarvis/jarvisLogic.ts); main cannot import renderer code. The maximum is a share
// of the window width, so only the renderer can check it; it clamps a bigger value and says so in the answer.
const PANEL_WIDTH_MIN = 340
const PANEL_WIDTH_DEFAULT = 520

/** A whole number of pixels, at least the panel's minimum; anything else is refused with a message the model can act on. */
function wholePixels(args: Readonly<Record<string, unknown>>, key: string, min: number): number | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`"${key}" must be a whole number of pixels, ${min} or more.`)
  }
  if (value < min) throw new Error(`"${key}" must be at least ${min}px; ${value} is smaller.`)
  return value
}

export function createPanelTools(deps: JarvisToolDeps, _ctx: ToolContext): McpTool[] {
  // _ctx: the shared tool-file signature; every field is reversible from the panel itself and the answer says what changed.
  const ui = deps.ui

  return [
    {
      name: 'jarvis_panel_settings',
      description: `Jarvis's own panel, the two settings of its header and its edge. read_aloud: read Jarvis's replies aloud with the system voice; this only works with the Claude engine Jarvis, the OpenCode engine's replies are never spoken. panel_width: width of the Jarvis side panel in pixels (at least 340; at most 75% of the window, about 1200px on a 1600px window; the window clamps a value outside that and the answer says so). reset_panel_width: back to the default ${PANEL_WIDTH_DEFAULT}px. Give panel_width or reset_panel_width, not both. With no arguments it shows the current values.`,
      inputSchema: schema({
        read_aloud: { type: 'boolean', description: 'Read Jarvis\'s replies aloud with the system voice (Claude engine only).' },
        panel_width: { type: 'integer', minimum: PANEL_WIDTH_MIN, description: 'Panel width in pixels; the window keeps it within 340px and 75% of its width.' },
        reset_panel_width: { type: 'boolean', description: `Back to the default ${PANEL_WIDTH_DEFAULT}px width.` }
      }),
      run: async (args) => {
        const readAloud = optionalBool(args, 'read_aloud')
        const panelWidth = wholePixels(args, 'panel_width', PANEL_WIDTH_MIN)
        const reset = optionalBool(args, 'reset_panel_width')
        if (panelWidth !== undefined && reset !== undefined) {
          throw new Error('Give either "panel_width" or "reset_panel_width", not both.')
        }
        const action: JarvisUiAction = {
          kind: 'jarvisPrefs',
          ...(readAloud !== undefined ? { speak: readAloud } : {}),
          ...(panelWidth !== undefined ? { panelWidth } : reset === true ? { panelWidth: 'reset' } : {})
        }
        // No mode: these belong to the window, shared by Ops and Code (like sound_settings).
        const result = await ui(undefined, action)
        // Only a call that asked for something counts as a change; a bare call just reads the values.
        if (Object.keys(action).length > 1) deps.log('jarvis_panel_settings', JSON.stringify(args))
        return result
      }
    }
  ]
}
