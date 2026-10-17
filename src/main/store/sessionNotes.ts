import type { ChecklistItem, Id, StoreData } from '../../shared/types'
import { findSessionIndex } from './reducers'

export const MAX_NOTES_LENGTH = 20000
export const MAX_CHECKLIST_ITEMS = 100
export const MAX_CHECKLIST_ID_LENGTH = 64
export const MAX_CHECKLIST_TEXT_LENGTH = 300

/** Returns the notes unchanged when valid; throws otherwise. Empty string is valid (it clears the notes). */
export function validateNotes(notes: unknown): string {
  if (typeof notes !== 'string') {
    throw new Error('Notes must be a string')
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    throw new Error('Notes too long')
  }
  return notes
}

function invalidChecklist(reason: string): Error {
  return new Error(`Invalid checklist: ${reason}`)
}

/** Returns normalized items ({ id, text trimmed, done }) when valid; throws `Invalid checklist: <reason>` otherwise. */
export function validateChecklist(items: unknown): ChecklistItem[] {
  if (!Array.isArray(items)) {
    throw invalidChecklist('must be an array')
  }
  const list: unknown[] = items
  if (list.length > MAX_CHECKLIST_ITEMS) {
    throw invalidChecklist(`at most ${MAX_CHECKLIST_ITEMS} items`)
  }

  const seen = new Set<string>()
  return list.map((raw, index): ChecklistItem => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw invalidChecklist(`item ${index} must be an object`)
    }
    const obj = raw as Record<string, unknown>

    const id = obj.id
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_CHECKLIST_ID_LENGTH) {
      throw invalidChecklist(`item ${index} id must be a non-empty string up to ${MAX_CHECKLIST_ID_LENGTH} characters`)
    }
    if (seen.has(id)) {
      throw invalidChecklist(`duplicate id "${id}"`)
    }
    seen.add(id)

    if (typeof obj.text !== 'string') {
      throw invalidChecklist(`item ${index} text must be a string`)
    }
    const text = obj.text.trim()
    if (text.length < 1 || text.length > MAX_CHECKLIST_TEXT_LENGTH) {
      throw invalidChecklist(`item ${index} text must be 1 to ${MAX_CHECKLIST_TEXT_LENGTH} characters`)
    }

    if (typeof obj.done !== 'boolean') {
      throw invalidChecklist(`item ${index} done must be a boolean`)
    }

    return { id, text, done: obj.done }
  })
}

/** Sets (or, for an empty string, removes) the session's notes. Unknown session throws. */
export function setSessionNotes(data: StoreData, id: Id, notes: string): StoreData {
  const index = findSessionIndex(data, id)
  const value = validateNotes(notes)
  const sessions = data.sessions.map((s, i) => {
    if (i !== index) return s
    const { notes: _notes, ...rest } = s
    return value === '' ? rest : { ...rest, notes: value }
  })
  return { ...data, sessions }
}

/** Sets (or, for an empty list, removes) the session's checklist. Unknown session throws. */
export function setSessionChecklist(data: StoreData, id: Id, items: unknown): StoreData {
  const index = findSessionIndex(data, id)
  const normalized = validateChecklist(items)
  const sessions = data.sessions.map((s, i) => {
    if (i !== index) return s
    const { checklist: _checklist, ...rest } = s
    return normalized.length === 0 ? rest : { ...rest, checklist: normalized }
  })
  return { ...data, sessions }
}
