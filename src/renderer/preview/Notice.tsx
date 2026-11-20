// One-line notices of the preview pane bodies (D73): empty file, no image bytes, and failures keep
// the same styling whether they come from text, a document or a table.
import type { ReactElement } from 'react'
import { cn } from '../lib/utils'

export interface NoticeProps {
  readonly text: string
  readonly failed?: boolean
}

export function Notice({ text, failed }: NoticeProps): ReactElement {
  return (
    <p
      role={failed === true ? 'alert' : undefined}
      className={cn(
        'px-3 py-2 text-xs',
        failed === true ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {text}
    </p>
  )
}
