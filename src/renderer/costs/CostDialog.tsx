// The cost report (D51): totals, a 14-day chart and a per-session table, from the timeline's per-turn costs.
import { useMemo, type ReactElement } from 'react'
import type { Id, Session } from '../../shared/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { ScrollArea } from '../components/ui/scroll-area'
import { formatCost } from '../usage/usageLogic'
import { CostBars } from './CostBars'
import { costTotals, dailyCosts, sessionCostRows } from './costLogic'
import { useCostTurns } from './useCostTurns'

export interface CostDialogProps {
  readonly open: boolean
  readonly sessions: readonly Session[]
  readonly onOpenChange: (open: boolean) => void
  readonly onOpenSession: (id: Id) => void
}

function money(value: number): string {
  return value > 0 ? formatCost(value) : '$0.00'
}

function Tile({ label, value }: { readonly label: string; readonly value: number }): ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md border border-border px-3 py-2" data-cost-tile={label}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{money(value)}</span>
    </div>
  )
}

export function CostDialog({ open, sessions, onOpenChange, onOpenSession }: CostDialogProps): ReactElement {
  const ids = useMemo(() => sessions.map((s) => s.id), [sessions])
  const { bySession, loading } = useCostTurns(ids, open)
  // The clock is read when the data changes, so "today" is right after midnight on the next refresh.
  const now = useMemo(() => Date.now(), [bySession])
  const all = useMemo(() => [...bySession.values()].flat(), [bySession])
  const totals = useMemo(() => costTotals(all, now), [all, now])
  const days = useMemo(() => dailyCosts(all, now), [all, now])
  const rows = useMemo(() => sessionCostRows(sessions, bySession, now), [sessions, bySession, now])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[680px]"
        data-cost-dialog=""
        // Focus stays on the dialog itself, not the first day of the chart (a focused day shows its tooltip).
        onOpenAutoFocus={(event): void => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Cost</DialogTitle>
          <DialogDescription>
            From the cost Claude Code and OpenCode report for each turn (kept 30 days). Turns with an unknown cost are not
            counted.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Tile label="Today" value={totals.today} />
          <Tile label="Last 7 days" value={totals.week} />
          <Tile label="Last 30 days" value={totals.month} />
        </div>
        <section className="flex flex-col gap-1">
          <h3 className="text-[12px] font-medium">Cost per day, last 14 days</h3>
          <CostBars days={days} label="Cost per day over the last 14 days" />
        </section>
        <section className="flex min-h-0 flex-col gap-1">
          <h3 className="text-[12px] font-medium">By session (last 30 days)</h3>
          {rows.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">{loading ? 'Loading…' : 'No cost recorded in the last 30 days.'}</p>
          ) : (
            <ScrollArea className="max-h-[220px]">
              <table className="w-full text-[12px]" data-cost-table="">
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground">
                    <th className="py-1 font-normal">Session</th>
                    <th className="py-1 text-right font-normal">Today</th>
                    <th className="py-1 text-right font-normal">7 days</th>
                    <th className="py-1 text-right font-normal">30 days</th>
                    <th className="py-1 text-right font-normal">Turns</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      data-cost-row={row.name}
                      className="cursor-pointer border-t border-border hover:bg-accent/40"
                      onClick={(): void => {
                        onOpenSession(row.id)
                        onOpenChange(false)
                      }}
                    >
                      <td className="max-w-[260px] truncate py-1.5 pr-2">{row.name}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(row.today)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(row.week)}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{money(row.month)}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{row.turns}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}
