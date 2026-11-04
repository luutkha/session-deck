// Settings > Terminal (terminal comfort): zoom (live) and scrollback (new panes). Renderer-only profile in
// localStorage (`sessiondeck.termview.v1`), shared app-wide. Right-click (D59): Orca's menu or quick copy/paste.
import { useState, type ReactElement } from 'react'
import { useTermView } from '../Terminal/useTermView'
import { SCROLLBACK_MAX, SCROLLBACK_MIN, clampScrollback } from '../Terminal/termView'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { readRightClickMode, storeRightClickMode } from '../Terminal/rightClickPref'
import type { RightClickMode } from '../Terminal/keymap'

const RIGHT_CLICK_CHOICES: readonly { readonly mode: RightClickMode; readonly label: string }[] = [
  { mode: 'menu', label: 'Show menu' },
  { mode: 'paste', label: 'Copy / paste' }
]

export function TerminalSection(): ReactElement {
  const { termView, setTermView, zoom } = useTermView()
  const [draft, setDraft] = useState(String(termView.scrollbackLines))
  const [error, setError] = useState<string | null>(null)
  const [rightClick, setRightClick] = useState<RightClickMode>((): RightClickMode => readRightClickMode())

  function applyScrollback(): void {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || parsed < SCROLLBACK_MIN || parsed > SCROLLBACK_MAX) {
      setError(`Scrollback must be between ${String(SCROLLBACK_MIN)} and ${String(SCROLLBACK_MAX)} lines.`)
      return
    }
    setError(null)
    setTermView({ ...termView, scrollbackLines: clampScrollback(parsed) })
  }

  return (
    <div className="flex flex-col gap-4">
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
