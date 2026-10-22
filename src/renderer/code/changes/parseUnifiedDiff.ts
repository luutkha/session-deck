// Pure parser for one file's `git diff` text. No React, no IPC.
// Hunk bodies are tracked by their line counts, so a removed line such as "-- note" (which reads
// like a "--- " file header) is still a deletion inside a hunk.

export type DiffLineKind = 'context' | 'add' | 'del' | 'hunk' | 'meta' | 'note'

export interface DiffLine {
  readonly kind: DiffLineKind
  /** The line without its leading marker for context/add/del; the whole line otherwise. */
  readonly text: string
  readonly oldNo: number | null
  readonly newNo: number | null
}

interface ParseState {
  readonly oldNo: number
  readonly newNo: number
  /** Old-side lines still expected in the current hunk body. */
  readonly oldLeft: number
  /** New-side lines still expected in the current hunk body. */
  readonly newLeft: number
}

interface StepResult {
  readonly state: ParseState
  readonly line: DiffLine
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const DEFAULT_HUNK_COUNT = 1
const NO_HUNK: ParseState = { oldNo: 0, newNo: 0, oldLeft: 0, newLeft: 0 }
const CARRIAGE_RETURN = /\r$/
const NO_NEWLINE_MARKER = '\\'

function splitLines(diff: string): readonly string[] {
  const lines = diff.split('\n')
  return lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

function hunkCount(count: string | undefined): number {
  return count === undefined ? DEFAULT_HUNK_COUNT : Number(count)
}

function startHunk(match: RegExpExecArray, text: string): StepResult {
  return {
    state: {
      oldNo: Number(match[1]),
      newNo: Number(match[3]),
      oldLeft: hunkCount(match[2]),
      newLeft: hunkCount(match[4])
    },
    line: { kind: 'hunk', text, oldNo: null, newNo: null }
  }
}

function contextLine(state: ParseState, text: string): StepResult {
  return {
    state: { ...state, oldNo: state.oldNo + 1, newNo: state.newNo + 1, oldLeft: state.oldLeft - 1, newLeft: state.newLeft - 1 },
    line: { kind: 'context', text: text.slice(1), oldNo: state.oldNo, newNo: state.newNo }
  }
}

function addLine(state: ParseState, text: string): StepResult {
  return {
    state: { ...state, newNo: state.newNo + 1, newLeft: state.newLeft - 1 },
    line: { kind: 'add', text: text.slice(1), oldNo: null, newNo: state.newNo }
  }
}

function delLine(state: ParseState, text: string): StepResult {
  return {
    state: { ...state, oldNo: state.oldNo + 1, oldLeft: state.oldLeft - 1 },
    line: { kind: 'del', text: text.slice(1), oldNo: state.oldNo, newNo: null }
  }
}

function noteLine(state: ParseState, text: string): StepResult {
  return { state, line: { kind: 'note', text, oldNo: null, newNo: null } }
}

function inHunkBody(state: ParseState): boolean {
  return state.oldLeft > 0 || state.newLeft > 0
}

/** One line of a hunk body, or null when the line does not belong to a body. */
function bodyLine(state: ParseState, text: string): StepResult | null {
  switch (text.charAt(0)) {
    case ' ':
    case '':
      return contextLine(state, text)
    case '+':
      return addLine(state, text)
    case '-':
      return delLine(state, text)
    case NO_NEWLINE_MARKER:
      return noteLine(state, text)
    default:
      return null
  }
}

function stepLine(state: ParseState, raw: string): StepResult {
  const text = raw.replace(CARRIAGE_RETURN, '')
  const header = HUNK_HEADER.exec(text)
  if (header !== null) {
    return startHunk(header, text)
  }
  if (inHunkBody(state)) {
    const body = bodyLine(state, text)
    if (body !== null) {
      return body
    }
  }
  if (text.startsWith(NO_NEWLINE_MARKER)) {
    return noteLine(state, text)
  }
  return { state, line: { kind: 'meta', text, oldNo: null, newNo: null } }
}

/** Parses git's unified diff text of one file into display lines. '' gives []. */
export function parseUnifiedDiff(diff: string): readonly DiffLine[] {
  const lines: DiffLine[] = []
  let state = NO_HUNK
  for (const raw of splitLines(diff)) {
    const step = stepLine(state, raw)
    state = step.state
    lines.push(step.line)
  }
  return lines
}
