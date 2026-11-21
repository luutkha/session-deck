// Settings > Agents: one compact row showing the detected OpenCode version and whether it takes `--standalone`,
// plus "Re-check" after an OpenCode upgrade (D74). Formatting lives in `opencodeInfoLogic.ts`.
import { useEffect, useState, type ReactElement } from 'react'
import type { OpencodeInfo } from '../../shared/types'
import { Button } from '@/components/ui/button'
import { errorMessage } from '../../shared/guards'
import { opencodeAgeText, opencodeHint, opencodeStatusText } from './opencodeInfoLogic'

/** Until the first answer arrives the row says "Checking..." (not a made-up "version unknown"). */
const INITIAL_INFO: OpencodeInfo = { version: null, supportsStandalone: true, checkedAt: 0, probing: true }
const NO_BRIDGE_INFO: OpencodeInfo = { version: null, supportsStandalone: true, checkedAt: 0, probing: false }
const AGE_REFRESH_MS = 30_000
/** While a probe runs the row re-asks this often, at most POLL_MAX_TRIES times (about 30 s). */
const POLL_MS = 700
const POLL_MAX_TRIES = 40

/** The bridge is absent in plain vite dev, so every call goes through this guard instead of `window.api.foo()`. */
function apiOrNull(): Window['api'] | null {
  return typeof window !== 'undefined' && typeof window.api?.getOpencodeInfo === 'function' ? window.api : null
}

export function OpencodeProbeRow(): ReactElement {
  const [info, setInfo] = useState<OpencodeInfo>(INITIAL_INFO)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState<number>((): number => Date.now())

  useEffect((): (() => void) => {
    const api = apiOrNull()
    if (api === null) {
      setInfo(NO_BRIDGE_INFO)
      return (): void => undefined
    }
    let cancelled = false
    api
      .getOpencodeInfo()
      .then((next: OpencodeInfo): void => {
        if (cancelled) return
        setInfo(next)
        setNow(Date.now())
      })
      .catch((): void => {
        if (!cancelled) setInfo(NO_BRIDGE_INFO)
      })
    return (): void => {
      cancelled = true
    }
  }, [])

  // The row asks once on mount. When it opens while the background probe is still running (up to ~8 s if the OpenCode CLI is
  // slow) that answer is "Checking..." and used to stay so until the dialog was reopened: ask again until the probe settles.
  // Capped, so a probe that never finishes cannot make the row poll forever.
  const probing = info.probing
  useEffect((): (() => void) | undefined => {
    if (!probing) return undefined
    const api = apiOrNull()
    if (api === null) return undefined
    let cancelled = false
    let tries = 0
    const timer = window.setInterval((): void => {
      tries += 1
      if (tries > POLL_MAX_TRIES) {
        // Still no answer: stop asking and hand the Re-check button back instead of a row stuck on "Checking...".
        window.clearInterval(timer)
        if (!cancelled) setInfo((previous: OpencodeInfo): OpencodeInfo => ({ ...previous, probing: false }))
        return
      }
      api
        .getOpencodeInfo()
        .then((next: OpencodeInfo): void => {
          if (cancelled) return
          setInfo(next)
          setNow(Date.now())
        })
        .catch((): void => undefined)
    }, POLL_MS)
    return (): void => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [probing])

  // The age text is relative: refresh it while the row is open.
  useEffect((): (() => void) => {
    const timer = window.setInterval((): void => setNow(Date.now()), AGE_REFRESH_MS)
    return (): void => window.clearInterval(timer)
  }, [])

  async function recheck(): Promise<void> {
    const api = apiOrNull()
    if (api === null) return
    setError(null)
    setInfo((previous): OpencodeInfo => ({ ...previous, probing: true }))
    try {
      const next = await api.recheckOpencode()
      setInfo(next)
      setNow(Date.now())
    } catch (err: unknown) {
      setError(errorMessage(err))
      setInfo((previous): OpencodeInfo => ({ ...previous, probing: false }))
    }
  }

  const hint = opencodeHint(info)

  return (
    <div className="flex flex-col gap-1" data-opencode-probe>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-foreground">OpenCode</span>
          <span className="truncate text-xs text-muted-foreground">
            <span data-opencode-status>{opencodeStatusText(info)}</span>
            {' · '}
            <span>{opencodeAgeText(info.checkedAt, now)}</span>
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 text-xs"
          disabled={info.probing}
          aria-label="Re-check the OpenCode version and --standalone support"
          onClick={(): void => void recheck()}
        >
          Re-check
        </Button>
      </div>
      {hint !== null ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
