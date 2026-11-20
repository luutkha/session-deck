// The 200-row pager of the file table (D74 #7): Prev / Next and "rows 1-200 of 2000"; the table
// itself only ever renders one page.
import type { ReactElement } from 'react'
import { Button } from '../components/ui/button'
import { pageCount, pageRangeLabel } from './tableLogic'

export interface TablePagerProps {
  readonly page: number
  readonly total: number
  readonly onPage: (page: number) => void
}

export function TablePager({ page, total, onPage }: TablePagerProps): ReactElement {
  return (
    <div className="flex shrink-0 items-center justify-end gap-1 border-t border-sidebar-border px-1 py-0.5 text-[10px] text-muted-foreground">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        aria-label="Previous page"
        disabled={page <= 0}
        onClick={(): void => onPage(page - 1)}
      >
        Prev
      </Button>
      <span data-table-range="" className="min-w-32 text-center tabular-nums">
        {pageRangeLabel(page, total)}
      </span>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        aria-label="Next page"
        disabled={page >= pageCount(total) - 1}
        onClick={(): void => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  )
}
