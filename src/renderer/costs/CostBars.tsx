// Daily cost columns (D51). One series: one hue (--chart-1), no legend (the title names it), recessive grid, a hover
// and focus tooltip per day. Bars are at most 24px thick with a 4px rounded top and a square baseline.
import { useState, type ReactElement } from 'react'
import { formatCost } from '../usage/usageLogic'
import { dayLabel, niceMax, type DayCost } from './costLogic'

export interface CostBarsProps {
  readonly days: readonly DayCost[]
  readonly height?: number
  /** Compact: no axis labels (the side panel strip). */
  readonly compact?: boolean
  readonly label: string
}

// viewBox units; the 600-unit chart renders ~780px wide in the dialog, so 18 units draw at about 24px.
const MAX_BAR = 18
const GAP = 2
const RADIUS = 4
const AXIS_W = 44
const LABEL_H = 18

/** A column path with a rounded top and a square bottom on the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return ''
  const r = Math.min(RADIUS, w / 2, h)
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
}

export function CostBars({ days, height = 160, compact = false, label }: CostBarsProps): ReactElement {
  const [hover, setHover] = useState<number | null>(null)
  const width = 600
  const left = compact ? 0 : AXIS_W
  const bottom = compact ? 0 : LABEL_H
  const plotW = width - left
  const plotH = height - bottom - 4
  const max = niceMax(Math.max(0, ...days.map((d) => d.total)))
  const slot = plotW / Math.max(1, days.length)
  const barW = Math.min(MAX_BAR, slot - GAP)
  const ticks = compact ? [] : [0, max / 2, max]
  const active = hover === null ? null : days[hover] ?? null

  return (
    <div className="relative w-full" data-cost-chart="">
      <svg viewBox={`0 0 ${width} ${height}`} className="block w-full" style={{ height }} role="img" aria-label={label}>
        {ticks.map((tick) => {
          const y = 4 + plotH - (tick / max) * plotH
          return (
            <g key={tick}>
              <line x1={left} x2={width} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
              <text x={left - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground" fontSize={10}>
                {tick === 0 ? '$0' : formatCost(tick)}
              </text>
            </g>
          )
        })}
        {days.map((day, index) => {
          const h = (day.total / max) * plotH
          const x = left + index * slot + (slot - barW) / 2
          const y = 4 + plotH - h
          return (
            <path
              key={day.dayStart}
              d={columnPath(x, y, barW, h)}
              fill="var(--chart-1)"
              opacity={hover === null || hover === index ? 1 : 0.55}
            />
          )
        })}
        {!compact
          ? days.map((day, index) =>
              index % 2 === (days.length - 1) % 2 ? (
                <text
                  key={`l${day.dayStart}`}
                  x={left + index * slot + slot / 2}
                  y={height - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={10}
                >
                  {dayLabel(day.dayStart)}
                </text>
              ) : null
            )
          : null}
        {days.map((day, index) => (
          <rect
            key={`h${day.dayStart}`}
            x={left + index * slot}
            y={0}
            width={slot}
            height={height - bottom}
            fill="transparent"
            className="outline-none"
            tabIndex={0}
            aria-label={`${dayLabel(day.dayStart)}: ${day.total > 0 ? formatCost(day.total) : 'no cost'}`}
            data-cost-day={index}
            onMouseEnter={(): void => setHover(index)}
            onMouseLeave={(): void => setHover(null)}
            onFocus={(): void => setHover(index)}
            onBlur={(): void => setHover(null)}
          />
        ))}
      </svg>
      {active !== null && hover !== null ? (
        <div
          role="tooltip"
          data-cost-tooltip=""
          className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
          // Centered on the column, but kept inside the chart near either edge.
          style={{
            left: `${((left + hover * slot + slot / 2) / width) * 100}%`,
            transform: hover < 2 ? 'translateX(0)' : hover > days.length - 3 ? 'translateX(-100%)' : 'translateX(-50%)'
          }}
        >
          <span className="font-medium">{dayLabel(active.dayStart)}</span>
          <span className="text-muted-foreground"> · </span>
          {active.total > 0 ? formatCost(active.total) : 'no cost'}
          {active.turns > 0 ? <span className="text-muted-foreground">{` · ${active.turns} ${active.turns === 1 ? 'turn' : 'turns'}`}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
