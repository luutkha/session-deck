/** Pure helpers for dropping files onto a terminal pane. */

const NEEDS_QUOTES = /[\s"'&()^%!;,=[\]{}$`~#]/

/** One path as the user would type it: quoted when it contains spaces or shell-special characters. */
export function formatDroppedPath(path: string): string {
  const trimmed = path.trim()
  if (!NEEDS_QUOTES.test(trimmed)) {
    return trimmed
  }
  return `"${trimmed.replace(/"/g, '')}"`
}

/** Paths joined by spaces with a trailing space, so the user (or Claude) can keep typing. Empty when there is nothing to paste. */
export function formatDroppedPaths(paths: readonly string[]): string {
  const formatted = paths.map((p) => p.trim()).filter((p) => p.length > 0).map(formatDroppedPath)
  return formatted.length === 0 ? '' : `${formatted.join(' ')} `
}
