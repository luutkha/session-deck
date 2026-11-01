// D53: Jarvis asks before a destructive action (remove a session, worktree or group). Main window only; requests are
// answered one at a time in arrival order.
import { useEffect, useState, type ReactElement } from 'react'
import type { JarvisConfirmRequest } from '../../shared/types'
import { ConfirmDialog } from '../Sidebar/ConfirmDialog'

export function JarvisConfirm(): ReactElement | null {
  const [queue, setQueue] = useState<readonly JarvisConfirmRequest[]>([])

  useEffect(() => window.api?.onJarvisConfirm?.((request): void => setQueue((previous) => [...previous, request])), [])

  const current = queue[0]
  if (current === undefined) return null
  const reply = (yes: boolean): void => {
    setQueue((previous) => previous.slice(1))
    window.api.jarvisConfirmReply(current.id, yes).catch((): void => undefined)
  }
  return (
    <ConfirmDialog
      key={current.id}
      title={current.title}
      message={current.message}
      confirmLabel={current.confirmLabel}
      onConfirm={(): void => reply(true)}
      onCancel={(): void => reply(false)}
    />
  )
}
