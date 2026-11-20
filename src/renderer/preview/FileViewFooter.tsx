// Footer of the preview pane (D73): name, kind and size, plus the cap notice when main cut the file.
import type { ReactElement } from 'react'
import type { FileView } from '../../shared/types'
import { formatBytes, kindLabel } from './fileViewLogic'

export function FileViewFooter({ view }: { readonly view: FileView }): ReactElement {
  return (
    <footer
      data-file-footer=""
      className="flex shrink-0 items-center gap-2 border-t border-sidebar-border px-2 py-1 text-[11px] text-muted-foreground"
    >
      <span className="min-w-0 truncate font-medium text-foreground/80" title={view.path}>
        {view.name}
      </span>
      <span className="shrink-0">{kindLabel(view.kind)}</span>
      <span className="ml-auto shrink-0 tabular-nums">{formatBytes(view.size)}</span>
      {view.truncated ? (
        <span data-file-truncated="" className="shrink-0 text-amber-500">
          cut at the size cap
        </span>
      ) : null}
    </footer>
  )
}
