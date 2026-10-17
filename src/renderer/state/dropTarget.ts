import type { StoreData, Group, Session, Id } from '../../shared/types'

export type DragItem = { readonly kind: 'session' | 'group'; readonly id: Id }
export type DropOver = { readonly kind: 'session' | 'group' | 'ungrouped'; readonly id?: Id; readonly position: 'before' | 'after' | 'inside' }
export type DropAction =
  | { readonly type: 'moveSession'; readonly sessionId: Id; readonly groupId: Id | null; readonly index: number }
  | { readonly type: 'reorderGroups'; readonly order: readonly Id[] }

function getSession(store: StoreData, id: Id): Session | undefined {
  return store.sessions.find(s => s.id === id)
}

function getGroup(store: StoreData, id: Id | null): Group | undefined {
  if (id === null) return undefined
  return store.groups.find(g => g.id === id)
}

function getSessionsInGroup(store: StoreData, groupId: Id | null): readonly Session[] {
  return store.sessions
    .filter(s => s.groupId === groupId)
    .sort((a, b) => a.order - b.order)
}

function findSessionIndex(sessions: readonly Session[], sessionId: Id): number {
  return sessions.findIndex(s => s.id === sessionId)
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

export function computeDrop(drag: DragItem, over: DropOver, data: StoreData): DropAction | null {
  if (drag.kind === 'session') {
    const session = getSession(data, drag.id)
    if (!session) return null

    if (over.kind === 'group') {
      if (over.position !== 'inside') return null
      const groupId = over.id ?? null
      const group = getGroup(data, groupId)
      if (!group) return null
      if (session.groupId === groupId) {
        const sessionsInGroup = getSessionsInGroup(data, groupId)
        const currentIndex = findSessionIndex(sessionsInGroup, drag.id)
        const targetIndex = sessionsInGroup.length
        if (currentIndex === targetIndex - 1) return null
      }
      const sessionsInGroup = getSessionsInGroup(data, groupId)
      return {
        type: 'moveSession',
        sessionId: drag.id,
        groupId,
        index: sessionsInGroup.length
      }
    }

    if (over.kind === 'session') {
      const targetSession = getSession(data, over.id!)
      if (!targetSession) return null
      if (drag.id === targetSession.id) return null

      const targetGroupId = targetSession.groupId
      const sessionsInTargetGroup = getSessionsInGroup(data, targetGroupId)
      const targetIndex = findSessionIndex(sessionsInTargetGroup, targetSession.id)
      if (targetIndex === -1) return null

      let newIndex = over.position === 'before' ? targetIndex : targetIndex + 1

      if (session.groupId === targetGroupId) {
        const currentIndex = findSessionIndex(sessionsInTargetGroup, drag.id)
        if (currentIndex !== -1 && currentIndex < newIndex) {
          newIndex -= 1
        }
        if (currentIndex === newIndex) return null
      }

      return {
        type: 'moveSession',
        sessionId: drag.id,
        groupId: targetGroupId,
        index: newIndex
      }
    }

    if (over.kind === 'ungrouped') {
      if (over.position !== 'inside') return null
      const ungroupedSessions = getSessionsInGroup(data, null)
      if (session.groupId === null) {
        const currentIndex = findSessionIndex(ungroupedSessions, drag.id)
        if (currentIndex === ungroupedSessions.length - 1) return null
      }
      return {
        type: 'moveSession',
        sessionId: drag.id,
        groupId: null,
        index: ungroupedSessions.length
      }
    }

    return null
  }

  if (drag.kind === 'group') {
    const group = getGroup(data, drag.id)
    if (!group) return null

    if (over.kind === 'group' && (over.position === 'before' || over.position === 'after')) {
      const targetGroup = getGroup(data, over.id!)
      if (!targetGroup) return null
      if (drag.id === targetGroup.id) return null

      const currentOrder = data.groupOrder
      const dragIndex = currentOrder.indexOf(drag.id)
      const targetIndex = currentOrder.indexOf(targetGroup.id)
      if (dragIndex === -1 || targetIndex === -1) return null

      const newOrder = [...currentOrder]
      newOrder.splice(dragIndex, 1)
      const newTargetIndex = newOrder.indexOf(targetGroup.id)
      const insertIndex = over.position === 'before' ? newTargetIndex : newTargetIndex + 1

      if (dragIndex === insertIndex) return null

      newOrder.splice(insertIndex, 0, drag.id)

      if (arraysEqual(newOrder, currentOrder)) return null

      return { type: 'reorderGroups', order: newOrder }
    }

    return null
  }

  return null
}