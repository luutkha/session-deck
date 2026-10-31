import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChecklistItem, Session } from '../../shared/types'
import type { SessionActions } from '../state/useSessionStore'
import {
  addItem as addChecklistItem,
  clearDone as clearDoneItems,
  deleteItem as deleteChecklistItem,
  editItem as editChecklistItem,
  makeItemId,
  moveItem as moveChecklistItem,
  normalizeNotes,
  toggleItem as toggleChecklistItem,
  type MoveDirection
} from './checklistLogic'
import { createDebouncedSaver, type DebouncedSaver } from './debounce'
import { errorMessage } from '../../shared/guards'

/** Notes are saved this long after the last keystroke; blur / switch / unmount flush immediately. */
const NOTES_SAVE_DELAY_MS = 600

type NoteActions = Pick<SessionActions, 'setSessionNotes' | 'setSessionChecklist'>

export interface UseSessionNotesResult {
  readonly notes: string
  readonly checklist: readonly ChecklistItem[]
  readonly setNotes: (text: string) => void
  readonly addItem: (text: string) => void
  readonly toggle: (id: string) => void
  readonly edit: (id: string, text: string) => void
  readonly remove: (id: string) => void
  readonly move: (id: string, direction: MoveDirection) => void
  readonly clearDone: () => void
  readonly error: string | null
  readonly flush: () => Promise<void>
}

/**
 * Owns the local mirror of a session's notes and checklist. Text edits are debounced; checklist
 * mutations save immediately. Local state re-syncs when the session id changes or when the stored
 * value changes from outside (e.g. another window). A failed save surfaces `error` and keeps the
 * local value so the user can retry.
 */
export function useSessionNotes(session: Session, actions: NoteActions): UseSessionNotesResult {
  const [notes, setNotesState] = useState<string>(() => normalizeNotes(session.notes ?? ''))
  const [checklist, setChecklistState] = useState<readonly ChecklistItem[]>(
    () => session.checklist ?? []
  )
  const [error, setError] = useState<string | null>(null)

  const sessionIdRef = useRef<string>(session.id)
  const notesRef = useRef<string>(notes)
  const checklistRef = useRef<readonly ChecklistItem[]>(checklist)
  const actionsRef = useRef<NoteActions>(actions)
  actionsRef.current = actions

  const inFlightRef = useRef<Promise<void>>(Promise.resolve())

  const saveNotes = useCallback((value: string): Promise<void> => {
    const id = sessionIdRef.current
    const promise = actionsRef.current.setSessionNotes(id, value).then(
      () => {
        setError(null)
      },
      (err: unknown) => {
        setError(errorMessage(err))
      }
    )
    inFlightRef.current = promise
    return promise
  }, [])

  const saveNotesRef = useRef<(value: string) => Promise<void>>(saveNotes)
  saveNotesRef.current = saveNotes

  const saverRef = useRef<DebouncedSaver<string> | null>(null)
  if (saverRef.current === null) {
    saverRef.current = createDebouncedSaver<string>(NOTES_SAVE_DELAY_MS, (value: string): void => {
      void saveNotesRef.current(value)
    })
  }

  const setNotes = useCallback((text: string): void => {
    const normalized = normalizeNotes(text)
    notesRef.current = normalized
    setNotesState(normalized)
    saverRef.current?.schedule(normalized)
  }, [])

  const flush = useCallback(async (): Promise<void> => {
    saverRef.current?.flush()
    await inFlightRef.current
  }, [])

  const persistChecklist = useCallback(
    (updater: (items: readonly ChecklistItem[]) => readonly ChecklistItem[]): void => {
      const next = updater(checklistRef.current)
      if (next === checklistRef.current) return
      checklistRef.current = next
      setChecklistState(next)
      const id = sessionIdRef.current
      void actionsRef.current.setSessionChecklist(id, next).then(
        () => {
          setError(null)
        },
        (err: unknown) => {
          setError(errorMessage(err))
        }
      )
    },
    []
  )

  const addItem = useCallback(
    (text: string): void => {
      persistChecklist((items) => addChecklistItem(items, text, makeItemId))
    },
    [persistChecklist]
  )
  const toggle = useCallback(
    (id: string): void => {
      persistChecklist((items) => toggleChecklistItem(items, id))
    },
    [persistChecklist]
  )
  const edit = useCallback(
    (id: string, text: string): void => {
      persistChecklist((items) => editChecklistItem(items, id, text))
    },
    [persistChecklist]
  )
  const remove = useCallback(
    (id: string): void => {
      persistChecklist((items) => deleteChecklistItem(items, id))
    },
    [persistChecklist]
  )
  const move = useCallback(
    (id: string, direction: MoveDirection): void => {
      persistChecklist((items) => moveChecklistItem(items, id, direction))
    },
    [persistChecklist]
  )
  const clearDone = useCallback((): void => {
    persistChecklist((items) => clearDoneItems(items))
  }, [persistChecklist])

  // Session switch: flush the outgoing session (its id is still in the ref), then adopt the new one.
  useEffect(() => {
    sessionIdRef.current = session.id
    const nextNotes = normalizeNotes(session.notes ?? '')
    const nextChecklist = session.checklist ?? []
    notesRef.current = nextNotes
    checklistRef.current = nextChecklist
    setNotesState(nextNotes)
    setChecklistState(nextChecklist)
    setError(null)
    return () => {
      saverRef.current?.flush()
    }
  }, [session.id])

  // Adopt stored notes changed from outside (our own save makes the two equal, so this is a no-op).
  useEffect(() => {
    const stored = normalizeNotes(session.notes ?? '')
    if (stored !== notesRef.current) {
      notesRef.current = stored
      setNotesState(stored)
    }
  }, [session.notes])

  // Adopt a stored checklist changed from outside.
  useEffect(() => {
    const stored = session.checklist ?? []
    if (stored !== checklistRef.current) {
      checklistRef.current = stored
      setChecklistState(stored)
    }
  }, [session.checklist])

  return {
    notes,
    checklist,
    setNotes,
    addItem,
    toggle,
    edit,
    remove,
    move,
    clearDone,
    error,
    flush
  }
}
