import type { ReactElement } from 'react'
import type { Id, TimelineTurn } from '../../shared/types'
import { ScrollArea } from '../components/ui/scroll-area'
import { useNow } from './useNow'
import { useTimeline } from './useTimeline'
import { isTurnRunning, promptText, turnMeta } from './timelineFormat'

export interface ActivityListProps {
  readonly sessionId: Id
}

export const ACTIVITY_EMPTY_MESSAGE = 'No turns yet. Each prompt you send shows up here.'
const ACTIVITY_LOADING_MESSAGE = 'Loading activity...'

interface TurnRowProps {
  readonly turn: TimelineTurn
  readonly now: number
}

function TurnRow({ turn, now }: TurnRowProps): ReactElement {
  const running = isTurnRunning(turn)
  return (
    <li
      data-turn-id={turn.id}
      className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-accent/40"
    >
      <p className="line-clamp-2 break-words text-[13px] leading-snug text-foreground">
        {promptText(turn)}
      </p>
      <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        {running ? (
          <span
            aria-label="Running"
            className="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-primary"
          />
        ) : null}
        <span className="truncate">{turnMeta(turn, now)}</span>
      </p>
    </li>
  )
}

export function ActivityList({ sessionId }: ActivityListProps): ReactElement {
  const timeline = useTimeline(sessionId)
  const anyRunning = timeline.turns.some(isTurnRunning)
  const now = useNow(anyRunning)

  let content: ReactElement
  if (timeline.error !== null) {
    content = (
      <p role="alert" className="px-3 py-3 text-xs text-destructive">
        {timeline.error}
      </p>
    )
  } else if (timeline.turns.length === 0) {
    content = (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        {timeline.loading ? ACTIVITY_LOADING_MESSAGE : ACTIVITY_EMPTY_MESSAGE}
      </p>
    )
  } else {
    content = (
      <ol className="flex flex-col gap-1 px-2 py-2">
        {timeline.turns.map((turn: TimelineTurn): ReactElement => (
          <TurnRow key={turn.id} turn={turn} now={now} />
        ))}
      </ol>
    )
  }

  return <ScrollArea className="min-h-0 flex-1">{content}</ScrollArea>
}
