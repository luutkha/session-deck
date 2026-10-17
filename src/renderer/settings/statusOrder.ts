import type { Id, StatusDef } from '../../shared/types'

export type MoveDirection = 'up' | 'down'

const BASE_STATUS_NAME = 'New status'

/**
 * Pure reorder decision for the statuses list. Returns the new id permutation
 * (all status ids, with `id` shifted one step by `direction`), or null when the
 * move is a no-op: the id is unknown or already at the end in that direction.
 */
export function moveStatus(
  statuses: readonly StatusDef[],
  id: Id,
  direction: MoveDirection
): readonly Id[] | null {
  const index = statuses.findIndex((status: StatusDef): boolean => status.id === id)
  if (index === -1) {
    return null
  }
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= statuses.length) {
    return null
  }
  const ids = statuses.map((status: StatusDef): Id => status.id)
  const [moved] = ids.splice(index, 1)
  ids.splice(target, 0, moved)
  return ids
}

/**
 * Default name for an added status: "New status", then "New status 2", etc.,
 * skipping any name already taken by an existing status (case-insensitive,
 * after trimming so a drafts stays unique).
 */
export function nextStatusName(existing: readonly StatusDef[]): string {
  const taken = new Set(
    existing.map((status: StatusDef): string => status.name.trim().toLowerCase())
  )
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? BASE_STATUS_NAME : `${BASE_STATUS_NAME} ${n}`
    if (!taken.has(candidate.toLowerCase())) {
      return candidate
    }
  }
}