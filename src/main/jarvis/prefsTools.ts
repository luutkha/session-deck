// Jarvis tool for the terminal / graphics preferences (D71): the renderer, visual effects, scrollback, zoom and
// right-click choices of Settings > Terminal. The window keeps them in localStorage, so main only validates the
// arguments and asks the window to apply them (the same round trip as sound_settings). The tool is registered in
// index.ts like the other tool files.
import type { JarvisUiAction } from '../../shared/types'
import type { McpTool } from './mcpProtocol'
import { optionalText, schema } from './toolArgs'
import type { JarvisToolDeps } from './jarvisTools'
import type { ToolContext } from './appTools'

const RENDERERS = ['auto', 'webgl', 'canvas', 'dom'] as const
const EFFECTS = ['auto', 'full', 'reduced'] as const
const RIGHT_CLICKS = ['menu', 'copy-paste'] as const
type Renderer = typeof RENDERERS[number]
type Effects = typeof EFFECTS[number]
type RightClick = typeof RIGHT_CLICKS[number]

// The same ranges as Settings > Terminal (renderer/Terminal/termView.ts); main cannot import renderer code.
const ZOOM_MIN = 50
const ZOOM_MAX = 200
const SCROLLBACK_MIN = 1_000
const SCROLLBACK_MAX = 100_000

function oneOf<T extends string>(args: Readonly<Record<string, unknown>>, key: string, allowed: readonly T[]): T | undefined {
  const value = optionalText(args, key)
  if (value === undefined) return undefined
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`"${key}" must be one of ${allowed.join(', ')}.`)
  return value as T
}

/** A whole number in range; a bare check with a message the model can act on (out of range is refused, not clamped). */
function wholeInRange(args: Readonly<Record<string, unknown>>, key: string, min: number, max: number, noun: string): number | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`"${key}" must be a whole number of ${noun}, ${min} to ${max}.`)
  }
  if (value < min || value > max) throw new Error(`"${key}" must be ${min} to ${max} ${noun}; ${value} is outside that range.`)
  return value
}

export function createPrefsTools(deps: JarvisToolDeps, _ctx: ToolContext): McpTool[] {
  // _ctx: the shared tool-file signature; this tool needs no undo step or prompt helper (every field is reversible
  // from the Settings dialog and the answer already says what changed).
  const ui = deps.ui

  return [
    {
      name: 'terminal_settings',
      description: `Settings > Terminal, the choices that make the app comfortable on this PC: renderer (auto = WebGL with a GPU and DOM without one, webgl, canvas, dom), effects (auto, full, reduced - reduced removes animations, shadows and the cursor blink), scrollback_lines (1000-100000 lines per terminal; a big buffer costs memory in every terminal, and it applies to terminals opened from now on), zoom_percent (50-200, 100 = normal; applies to every pane at once) and right_click (menu = Copy, Paste, Select All and more, copy-paste = copies the selection or pastes right away). Guidance: auto is the safe choice everywhere; WebGL on a PC without a GPU (a VM, a remote session) burns the CPU (measured about 1,250% vs 65% for DOM), so use dom and reduced effects there. With no arguments it shows the current values.`,
      inputSchema: schema({
        renderer: { type: 'string', enum: [...RENDERERS], description: 'Which renderer draws the terminals. auto picks WebGL on a real GPU and DOM on a PC that only renders in software.' },
        effects: { type: 'string', enum: [...EFFECTS], description: 'reduced removes animations, shadows and the cursor blink.' },
        scrollback_lines: { type: 'integer', minimum: SCROLLBACK_MIN, maximum: SCROLLBACK_MAX, description: 'Lines kept per terminal; applies to terminals opened from now on and uses memory per terminal.' },
        zoom_percent: { type: 'integer', minimum: ZOOM_MIN, maximum: ZOOM_MAX, description: '100 normal; applies to every pane at once.' },
        right_click: { type: 'string', enum: [...RIGHT_CLICKS], description: 'menu shows the terminal menu; copy-paste copies the selection or pastes right away.' }
      }),
      run: async (args) => {
        const renderer: Renderer | undefined = oneOf(args, 'renderer', RENDERERS)
        const effects: Effects | undefined = oneOf(args, 'effects', EFFECTS)
        const rightClick: RightClick | undefined = oneOf(args, 'right_click', RIGHT_CLICKS)
        const scrollbackLines = wholeInRange(args, 'scrollback_lines', SCROLLBACK_MIN, SCROLLBACK_MAX, 'lines')
        const zoomPercent = wholeInRange(args, 'zoom_percent', ZOOM_MIN, ZOOM_MAX, 'percent')
        const action: JarvisUiAction = {
          kind: 'terminalPrefs',
          ...(renderer !== undefined ? { renderer } : {}),
          ...(effects !== undefined ? { effects } : {}),
          ...(scrollbackLines !== undefined ? { scrollbackLines } : {}),
          ...(zoomPercent !== undefined ? { zoomPercent } : {}),
          ...(rightClick !== undefined ? { rightClick } : {})
        }
        // No mode: these are window preferences, shared by Ops and Code (like sound_settings).
        const result = await ui(undefined, action)
        // Only a call that asked for something counts as a change; a bare call just reads the values.
        if (Object.keys(action).length > 1) deps.log('terminal_settings', JSON.stringify(args))
        return result
      }
    }
  ]
}
