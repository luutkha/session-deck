import type { ReactElement } from 'react'
import { Coffee } from 'lucide-react'
import type { AgentKind, Session } from '../../shared/types'
import { Badge } from './ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/** The agent a session runs; absent on stored sessions = 'claude'. */
export function sessionAgent(session: Pick<Session, 'agent'>): AgentKind {
  return session.agent ?? 'claude'
}

export interface AgentBadgeProps {
  /** The session's agent; absent = 'claude'. Claude sessions stay unmarked. */
  readonly agent?: AgentKind
  /** True while Remote Control is active for the running session (claude.ai/code or the phone app can drive it). */
  readonly remote?: boolean
  /** True when the user turned automatic sleep off for this session. */
  readonly keepAwake?: boolean
}

/**
 * A quiet pill naming the OpenCode agent. Renders nothing for Claude sessions so
 * the default stays visually unchanged; only OpenCode is called out.
 */
export function AgentBadge({ agent, remote = false, keepAwake = false }: AgentBadgeProps): ReactElement | null {
  const openCode = (agent ?? 'claude') === 'opencode'
  if (!openCode && !remote && !keepAwake) {
    return null
  }
  return (
    <>
      {openCode ? <OpenCodePill /> : null}
      {remote ? <RemotePill /> : null}
      {keepAwake ? <KeepAwakePill /> : null}
    </>
  )
}

function KeepAwakePill(): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="hostContext"
          aria-label="Keep awake"
          className="h-4 px-1 text-[9px] font-semibold leading-none tracking-tight"
        >
          <Coffee className="size-2.5" aria-hidden="true" />
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        Keep awake: this session is never put to sleep automatically
      </TooltipContent>
    </Tooltip>
  )
}

function RemotePill(): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="hostContext"
          aria-label="Remote Control active"
          className="h-4 px-1 text-[9px] font-semibold leading-none tracking-tight"
        >
          RC
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        Remote Control active: this session stays awake and can be used from claude.ai/code or the Claude app
      </TooltipContent>
    </Tooltip>
  )
}

function OpenCodePill(): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="hostContext"
          aria-label="OpenCode"
          className="h-4 px-1 text-[9px] font-semibold leading-none tracking-tight"
        >
          OC
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        OpenCode
      </TooltipContent>
    </Tooltip>
  )
}
