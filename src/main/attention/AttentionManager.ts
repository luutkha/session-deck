import type { AttentionReason, HookEvent } from '../../shared/types'

export interface AttentionManagerDeps {
  readonly isFocused: (id: string) => boolean
}

export interface AttentionManager {
  raise(id: string, reason: AttentionReason): void
  clear(id: string): void
  get(id: string): AttentionReason | null
  handleHook(event: HookEvent): void
  forget(id: string): void
  onChange(callback: (id: string, reason: AttentionReason | null) => void): () => void
}

const PRIORITY: Record<AttentionReason, number> = {
  permission: 4,
  done: 3,
  idle: 2,
  bell: 1
}

export function createAttentionManager(deps: AttentionManagerDeps): AttentionManager {
  const { isFocused } = deps
  const attention = new Map<string, AttentionReason | null>()
  const listeners = new Set<(id: string, reason: AttentionReason | null) => void>()

  function notify(id: string, reason: AttentionReason | null): void {
    for (const listener of listeners) {
      listener(id, reason)
    }
  }

  function shouldRaise(current: AttentionReason | null, incoming: AttentionReason): boolean {
    if (current === null) return true
    return PRIORITY[incoming] > PRIORITY[current]
  }

  return {
    raise(id: string, reason: AttentionReason): void {
      if (isFocused(id)) return

      const current = attention.get(id) ?? null
      if (shouldRaise(current, reason)) {
        attention.set(id, reason)
        notify(id, reason)
      }
    },

    clear(id: string): void {
      const current = attention.get(id)
      if (current !== undefined && current !== null) {
        attention.set(id, null)
        notify(id, null)
      }
    },

    get(id: string): AttentionReason | null {
      return attention.get(id) ?? null
    },

    handleHook(event: HookEvent): void {
      if (event.event === 'AgentSession') return
      if (event.event === 'Notification') {
        this.raise(event.sessionId, 'permission')
      } else if (event.event === 'Stop') {
        this.raise(event.sessionId, 'done')
      }
    },

    forget(id: string): void {
      const current = attention.get(id)
      if (current !== undefined) {
        attention.delete(id)
        if (current !== null) {
          notify(id, null)
        }
      }
    },

    onChange(callback: (id: string, reason: AttentionReason | null) => void): () => void {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    }
  }
}