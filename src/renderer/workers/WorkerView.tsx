import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { ArrowDown, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { WorkerInfo, WorkerLine } from '../../shared/types'
import { WorkerStatusIcon } from './WorkerTabs'
import { formatCost, formatElapsed, formatTokens, shortModel, statusText } from './workerLogic'

const BOTTOM_SLACK_PX = 24

function useClock(running: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return running ? now : Date.now()
}

function LineRow({ line }: { readonly line: WorkerLine }): ReactElement {
  if (line.kind === 'text') {
    return <p className="whitespace-pre-wrap break-words py-1 text-[13px] font-normal leading-relaxed text-neutral-200">{line.text}</p>
  }
  if (line.kind === 'error') {
    return <p className="whitespace-pre-wrap break-words py-1 text-[12px] text-red-400">{line.text}</p>
  }
  return (
    <div className="flex items-baseline gap-2 py-0.5 text-[12px]">
      <span
        aria-hidden="true"
        className={cn(
          'mt-[3px] size-1.5 shrink-0 self-start rounded-full',
          line.state === 'error' ? 'bg-red-400' : line.state === 'running' ? 'animate-pulse bg-amber-400' : 'bg-emerald-500/80'
        )}
      />
      <span className="shrink-0 rounded bg-white/10 px-1.5 py-px font-medium text-neutral-300">{line.tool}</span>
      <span className={cn('min-w-0 flex-1 truncate', line.state === 'error' ? 'text-red-300' : 'text-neutral-400')} title={line.text}>
        {line.text}
      </span>
    </div>
  )
}

/** Read-only live view of one OpenCode worker's output. Follows the newest line unless the reader scrolls up. */
export function WorkerView({ worker }: { readonly worker: WorkerInfo }): ReactElement {
  const scroller = useRef<HTMLDivElement | null>(null)
  const [following, setFollowing] = useState(true)
  const running = worker.status === 'running'
  const now = useClock(running)
  const elapsed = (worker.finishedAt ?? now) - worker.startedAt

  const scrollToEnd = useCallback((): void => {
    const el = scroller.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [])

  useLayoutEffect(() => {
    if (following) scrollToEnd()
  }, [worker.lines, following, scrollToEnd])

  const onScroll = (): void => {
    const el = scroller.current
    if (el === null) return
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX)
  }

  return (
    <section aria-label={`OpenCode worker ${worker.name}`} data-worker-view={worker.id} className="absolute inset-0 flex flex-col bg-black text-neutral-200">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 bg-neutral-950 px-3 py-2">
        <WorkerStatusIcon status={worker.status} className="size-4" />
        <h2 className="text-[13px] font-semibold text-neutral-50">{worker.name}</h2>
        <Badge variant="hostContext" className="h-4 px-1.5 text-[10px] font-medium leading-none">{shortModel(worker.model)}</Badge>
        <span className={cn('text-xs', worker.status === 'failed' ? 'text-red-400' : 'text-neutral-400')}>{statusText(worker)}</span>
        <span className="ml-auto flex items-center gap-3 text-[11px] tabular-nums text-neutral-400">
          <span>{formatElapsed(elapsed)}</span>
          <span>{formatTokens(worker.tokens)} tokens</span>
          <span>{formatCost(worker.costUsd)}</span>
          <span className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-neutral-300" title="You can watch this worker here; Claude controls it.">
            <Eye className="size-3" aria-hidden="true" />
            Read-only
          </span>
        </span>
      </header>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono font-normal">
        {worker.lines.length === 0 ? (
          <p className="text-xs text-neutral-500">{running ? 'Waiting for the worker’s first output…' : 'This worker wrote no output.'}</p>
        ) : (
          worker.lines.map((line: WorkerLine, index: number): ReactElement => <LineRow key={index} line={line} />)
        )}
      </div>
      {!following ? (
        <Button
          type="button"
          size="xs"
          variant="secondary"
          className="absolute bottom-4 right-6 shadow-lg"
          onClick={(): void => { setFollowing(true); scrollToEnd() }}
        >
          <ArrowDown className="size-3.5" aria-hidden="true" />
          Jump to latest
        </Button>
      ) : null}
    </section>
  )
}
