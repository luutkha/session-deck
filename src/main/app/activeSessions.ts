import type { Id, WindowRole } from '../../shared/types'

/** The session each window shows on screen. Main and Code windows can show different sessions. */
export interface ActiveSessions {
  /** Sets the session on screen for a role. Null clears it. */
  set(role: WindowRole, id: Id | null): void
  get(role: WindowRole): Id | null
  /** Distinct session ids on screen across all roles (no nulls, no duplicates). */
  all(): readonly Id[]
  clearRole(role: WindowRole): void
}

export function createActiveSessions(): ActiveSessions {
  const byRole = new Map<WindowRole, Id>()

  return {
    set(role, id) {
      if (id === null) {
        byRole.delete(role)
      } else {
        byRole.set(role, id)
      }
    },
    get(role) {
      return byRole.get(role) ?? null
    },
    all() {
      return [...new Set(byRole.values())]
    },
    clearRole(role) {
      byRole.delete(role)
    }
  }
}
