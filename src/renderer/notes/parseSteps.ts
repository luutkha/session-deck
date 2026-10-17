const CHECKBOX_PREFIX = /^\s*(?:[-*+]\s+)?(?:\[[ xX]?\]\s*)?/

/** Splits typed or pasted text into checklist steps, dropping "- [ ]" / "- [x]" / bullet prefixes. */
export function parseSteps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(CHECKBOX_PREFIX, '').trim())
    .filter((line) => line.length > 0)
}

/** Inserts "- [ ] " at the start of the line holding the caret (no-op if the line already has a box). */
export function insertCheckbox(
  text: string,
  caret: number
): { readonly text: string; readonly caret: number } {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1
  const rest = text.slice(lineStart)
  if (/^\s*[-*+]\s+\[[ xX]?\]/.test(rest)) return { text, caret }
  const box = '- [ ] '
  return { text: text.slice(0, lineStart) + box + rest, caret: caret + box.length }
}
