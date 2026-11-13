// Settings > Terminal (terminal comfort): zoom (live) and scrollback (new panes). Renderer-only profile in
// localStorage (`sessiondeck.termview.v1`), shared app-wide. Right-click (D59): Orca's menu or quick copy/paste.
// Graphics (D62): which xterm renderer, reduced effects, and the GPU acceleration preference (applied at restart).
import { useEffect, useState, type ReactElement } from 'react'
import { useTermView } from '../Terminal/useTermView'
import { SCROLLBACK_MAX, SCROLLBACK_MIN, clampScrollback } from '../Terminal/termView'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { readRightClickMode, storeRightClickMode } from '../Terminal/rightClickPref'
import type { RightClickMode } from '../Terminal/keymap'
import { useGraphicsPrefs } from '../Terminal/graphicsPrefs'
import { refreshGpuInfo, useGpuInfo, type GpuInfoWithPref } from '../Terminal/useGpuInfo'
import type { EffectsPref, RendererPref } from '../Terminal/terminalRenderer'
import type { GpuPref } from '../../shared/types'

const RIGHT_CLICK_CHOICES: readonly { readonly mode: RightClickMode; readonly label: string }[] = [
  { mode: 'menu', label: 'Show menu' },
  { mode: 'paste', label: 'Copy / paste' }
]

const RENDERER_CHOICES: readonly { readonly value: RendererPref; readonly label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'webgl', label: 'WebGL' },
  { value: 'canvas', label: 'Canvas' },
  { value: 'dom', label: 'DOM' }
]

const EFFECTS_CHOICES: readonly { readonly value: EffectsPref; readonly label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'full', label: 'Full' },
  { value: 'reduced', label: 'Reduced' }
]

const GPU_CHOICES: readonly { readonly value: GpuPref; readonly label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' }
]

function asRendererPref(value: string): RendererPref | null {
  return value === 'auto' || value === 'webgl' || value === 'canvas' || value === 'dom' ? value : null
}

function asEffectsPref(value: string): EffectsPref | null {
  return value === 'auto' || value === 'full' || value === 'reduced' ? value : null
}

function asGpuPref(value: string): GpuPref | null {
  return value === 'auto' || value === 'on' || value === 'off' ? value : null
}

/** One read-only line: the adapter, whether Chromium uses a real GPU and whether the GPU process is off. */
function gpuInfoText(info: GpuInfoWithPref | null): string {
  if (info === null) {
    return 'Graphics: detecting this PC…'
  }
  const mode = info.mode === 'hardware' ? 'GPU' : info.mode === 'software' ? 'software rendering' : 'not detected'
  const adapter = info.renderer.trim().length > 0 ? info.renderer : 'unknown adapter'
  return `Graphics: ${adapter} - ${mode} (GPU process ${info.accelerationDisabled ? 'off' : 'on'})`
}

export function TerminalSection(): ReactElement {
  const { termView, setTermView, zoom } = useTermView()
  const [draft, setDraft] = useState(String(termView.scrollbackLines))
  const [error, setError] = useState<string | null>(null)
  const [rightClick, setRightClick] = useState<RightClickMode>((): RightClickMode => readRightClickMode())
  const graphics = useGraphicsPrefs()
  const { info } = useGpuInfo()
  const [gpuPref, setGpuPref] = useState<GpuPref>('auto')

  // The saved preference arrives with the GPU info; the select shows it without a second IPC call.
  useEffect((): void => {
    if (info !== null) {
      setGpuPref(info.pref)
    }
  }, [info])

  function applyScrollback(): void {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || parsed < SCROLLBACK_MIN || parsed > SCROLLBACK_MAX) {
      setError(`Scrollback must be between ${String(SCROLLBACK_MIN)} and ${String(SCROLLBACK_MAX)} lines.`)
      return
    }
    setError(null)
    setTermView({ ...termView, scrollbackLines: clampScrollback(parsed) })
  }

  function changeGpuPref(value: string): void {
    const next = asGpuPref(value)
    if (next === null) {
      return
    }
    setGpuPref(next)
    // Saved now, applied by main at the next start (SESSIONDECK_GPU still overrides it for one run).
    void window.api
      .setGpuPref(next)
      .then((): void => {
        void refreshGpuInfo()
      })
      .catch((error: unknown): void => {
        console.error('SessionDeck: saving the GPU acceleration preference failed', error)
      })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-foreground">Graphics</span>
        <p data-testid="settings-gpu-info" className="text-xs text-muted-foreground">
          {gpuInfoText(info)}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-renderer" className="text-[13px] font-medium text-foreground">
          Terminal renderer
        </Label>
        <Select
          value={graphics.renderer}
          onValueChange={(value: string): void => {
            const next = asRendererPref(value)
            if (next !== null) graphics.setRenderer(next)
          }}
        >
          <SelectTrigger
            id="settings-renderer"
            data-testid="settings-renderer"
            size="sm"
            aria-label="Terminal renderer"
            className="w-full text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {RENDERER_CHOICES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value} className="text-xs">
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Auto uses the DOM renderer when there is no GPU (fastest there); WebGL otherwise</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-effects" className="text-[13px] font-medium text-foreground">
          Visual effects
        </Label>
        <Select
          value={graphics.effects}
          onValueChange={(value: string): void => {
            const next = asEffectsPref(value)
            if (next !== null) graphics.setEffects(next)
          }}
        >
          <SelectTrigger
            id="settings-effects"
            data-testid="settings-effects"
            size="sm"
            aria-label="Visual effects"
            className="w-full text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {EFFECTS_CHOICES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value} className="text-xs">
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Auto reduces animations and shadows when there is no GPU, or while 10 or more agents are busy</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-gpu" className="text-[13px] font-medium text-foreground">
          GPU acceleration
        </Label>
        <Select value={gpuPref} onValueChange={changeGpuPref}>
          <SelectTrigger
            id="settings-gpu"
            data-testid="settings-gpu"
            size="sm"
            aria-label="GPU acceleration"
            className="w-full text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {GPU_CHOICES.map((choice) => (
              <SelectItem key={choice.value} value={choice.value} className="text-xs">
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Takes effect after restarting SessionDeck. Auto turns the GPU off on PCs that only render in software.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-[13px] font-medium text-foreground">Right-click</Label>
        <div className="flex items-center gap-2" role="group" aria-label="Right-click">
          {RIGHT_CLICK_CHOICES.map((choice) => (
            <Button
              key={choice.mode}
              type="button"
              size="xs"
              variant={rightClick === choice.mode ? 'default' : 'outline'}
              aria-pressed={rightClick === choice.mode}
              data-right-click={choice.mode}
              onClick={(): void => {
                storeRightClickMode(choice.mode)
                setRightClick(choice.mode)
              }}
            >
              {choice.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Show menu: Copy, Paste, Select All, Find, Split, Clear and more. Copy / paste: copies the selection or pastes
          right away; Ctrl+right-click still shows the menu.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[13px] font-medium text-foreground">Zoom</Label>
          <span data-testid="termview-zoom" className="text-xs tabular-nums text-muted-foreground">
            {String(termView.zoomPercent)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="xs" aria-label="Zoom out" onClick={(): void => zoom('out')}>
            A−
          </Button>
          <Button type="button" variant="outline" size="xs" aria-label="Reset zoom" onClick={(): void => zoom('reset')}>
            100%
          </Button>
          <Button type="button" variant="outline" size="xs" aria-label="Zoom in" onClick={(): void => zoom('in')}>
            A+
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets; Ctrl+wheel over a terminal works too. Zoom applies to
          every pane immediately.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="term-scrollback" className="text-[13px] font-medium text-foreground">
          Scrollback lines
        </Label>
        <div className="flex items-center gap-2">
          <input
            id="term-scrollback"
            type="number"
            min={SCROLLBACK_MIN}
            max={SCROLLBACK_MAX}
            step={1000}
            value={draft}
            aria-label="Scrollback lines"
            className="h-8 w-32 rounded-md border border-border bg-background px-2 text-xs tabular-nums text-foreground outline-none focus-visible:border-primary"
            onChange={(event): void => {
              setDraft(event.target.value)
              setError(null)
            }}
          />
          <Button type="button" variant="outline" size="xs" onClick={applyScrollback}>
            Apply
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {String(SCROLLBACK_MIN)}..{String(SCROLLBACK_MAX)} lines. Applies to panes created after the change; the
          current ones keep their buffer.
        </p>
        {error !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
