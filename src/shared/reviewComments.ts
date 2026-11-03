// The prompt that sends diff review comments to a worktree's session (D34). Shared so the Changes panel's Send button
// and Jarvis's send_review_comments (D55) type exactly the same text.

export interface ReviewComment {
  readonly path: string
  /** Line in the file; null = unknown (shown as "?"). */
  readonly line: number | null
  readonly text: string
}

export const REVIEW_HEADER = 'Review comments on the current changes (file — line):'
export const REVIEW_FOOTER = 'Please apply these fixes.'

/** The prompt for the comments; null when there is nothing to send. */
export function formatReviewMessage(comments: readonly ReviewComment[]): string | null {
  if (comments.length === 0) return null
  const lines = comments.map((c) => `- ${c.path}:${c.line === null ? '?' : String(c.line)} — ${c.text}`)
  return [REVIEW_HEADER, ...lines, REVIEW_FOOTER].join('\n')
}
