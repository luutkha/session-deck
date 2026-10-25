// Pure logic for diff annotations (Code mode only, D31 scope): the user comments on a diff line and one
// click sends the comments into the worktree's session as a ready-to-apply prompt. No React, no IPC
// (same discipline as splitLogic.ts); the localStorage helpers are guarded like shellPrefs.ts.

export interface DiffAnnotation {
  /** Runtime id (uuid at call site); removing uses it. */
  readonly id: string
  /** Worktree-relative file path (FileDiff.path). */
  readonly path: string
  /** newNo for context/add lines, oldNo for del lines; null only for numberless lines (never rendered). */
  readonly line: number | null
  /** Which side the comment anchors to: the new file ('new') or the old file ('old', del lines). */
  readonly side: 'new' | 'old'
  /** The comment itself (trimmed, capped at ANNOTATION_MAX_TEXT). */
  readonly text: string
  /** Epoch ms — shown as the time, and the staleness marker (§ staleness). */
  readonly createdAt: number
}

export const ANNOTATION_MAX_TEXT = 500
export const ANNOTATIONS_MAX_PER_WORKTREE = 50

const STORAGE_PREFIX = 'sessiondeck.annotate.v1.'
const FOOTER = 'Please apply these fixes.'
const HEADER = 'Review comments on the current changes (file — line):'

/** localStorage key of one worktree's draft comments; they survive restarts and crashes. */
export function annotationsStorageKey(worktreeId: string): string {
  return STORAGE_PREFIX + worktreeId
}

/** The stored comment text: trimmed and capped; an empty result is nothing to attach. */
export function annotationText(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > ANNOTATION_MAX_TEXT ? trimmed.slice(0, ANNOTATION_MAX_TEXT) : trimmed
}

/** Same path + side + line + text = the same comment; the add is ignored. */
export function sameComment(a: DiffAnnotation, b: Pick<DiffAnnotation, 'path' | 'side' | 'line' | 'text'>): boolean {
  return a.path === b.path && a.side === b.side && a.line === b.line && a.text === b.text
}

/**
 * Adds a comment and returns the next list: duplicates are ignored, the 50-comment cap drops the OLDEST
 * comments first (recent review feedback matters more).
 */
export function addAnnotation(
  existing: readonly DiffAnnotation[],
  input: Pick<DiffAnnotation, 'path' | 'side' | 'line' | 'text'> & { readonly id: string },
  now: number
): readonly DiffAnnotation[] {
  const text = annotationText(input.text)
  if (text === null) return existing
  const candidate = { ...input, text }
  if (existing.some((a) => sameComment(a, candidate))) return existing
  const next = [...existing, { ...candidate, createdAt: now }]
  return next.length > ANNOTATIONS_MAX_PER_WORKTREE ? next.slice(next.length - ANNOTATIONS_MAX_PER_WORKTREE) : next
}

export function removeAnnotation(existing: readonly DiffAnnotation[], id: string): readonly DiffAnnotation[] {
  return existing.filter((a) => a.id !== id)
}

/**
 * The annotation that a rendered diff line shows, or null. context/add anchor to the new side (newNo),
 * del to the old side (oldNo) — matching which line number the row displays.
 */
export function annotationForLine(
  annotations: readonly DiffAnnotation[],
  path: string,
  line: Readonly<{ kind: string; oldNo: number | null; newNo: number | null }>
): DiffAnnotation | null {
  const side = line.kind === 'del' ? 'old' : 'new'
  const number = line.kind === 'del' ? line.oldNo : line.newNo
  if (number === null) return null
  return annotations.find((a) => a.path === path && a.side === side && a.line === number) ?? null
}

/** The prompt the Send button types into the session; null when there is nothing to send. */
export function formatAnnotationMessage(annotations: readonly DiffAnnotation[]): string | null {
  if (annotations.length === 0) return null
  const lines = annotations.map((a) => `- ${a.path}:${a.line === null ? '?' : String(a.line)} — ${a.text}`)
  return [HEADER, ...lines, FOOTER].join('\n')
}

export function serializeAnnotations(annotations: readonly DiffAnnotation[]): string {
  return JSON.stringify(annotations)
}

/** Malformed stored JSON (wrong shape, not an array) → null: the caller starts fresh instead of crashing. */
export function parseAnnotations(raw: string | null): readonly DiffAnnotation[] | null {
  if (raw === null || raw.trim().length === 0) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(value)) return null
  const list: DiffAnnotation[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null
    const a = entry as Record<string, unknown>
    if (
      typeof a.id !== 'string' || typeof a.path !== 'string' ||
      (a.side !== 'new' && a.side !== 'old') ||
      (a.line !== null && typeof a.line !== 'number') ||
      typeof a.text !== 'string' || typeof a.createdAt !== 'number'
    ) return null
    list.push({ id: a.id, path: a.path, line: a.line, side: a.side, text: a.text, createdAt: a.createdAt })
  }
  return list
}

/** Reads one worktree's stored draft comments; unavailable storage or malformed JSON → []. */
export function readStoredAnnotations(worktreeId: string): readonly DiffAnnotation[] {
  if (typeof localStorage === 'undefined') return []
  let raw: string | null = null
  try {
    raw = localStorage.getItem(annotationsStorageKey(worktreeId))
  } catch {
    return []
  }
  return parseAnnotations(raw) ?? []
}

/** Persists one worktree's draft comments; failures (quota, privacy modes) are ignored. */
export function storeAnnotations(worktreeId: string, annotations: readonly DiffAnnotation[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(annotationsStorageKey(worktreeId), serializeAnnotations(annotations))
  } catch {
    // Ignore: drafts are a convenience, never a source of truth.
  }
}
