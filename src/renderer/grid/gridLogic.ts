// Pure grid-view layout maths (D32). No React, no DOM, no IPC — same discipline as splitLogic.ts.
// Every function is immutable and returns a new GridLayout. Grid cells hold OPEN sessions only
// (D-c); a session occupies at most one cell (D-b); cell sizes are uniform per preset (D-d).
import type { Id } from '../../shared/types'

/** Preset names are COLUMNS x ROWS: '2x1' = side by side, '1x2' = stacked, '3x2' = 3 wide 2 tall. */
export type GridPreset = '1x1' | '2x1' | '1x2' | '2x2' | '2x3' | '3x2'

export interface GridShape {
  readonly cols: number
  readonly rows: number
}

export interface GridLayout {
  readonly preset: GridPreset
  /** Row-major cell assignments; null = empty cell. Length = cols * rows, never duplicates. */
  readonly cells: readonly (Id | null)[]
}

export const GRID_MAX_CELLS = 6
export const GRID_PRESETS: readonly GridPreset[] = ['1x1', '2x1', '1x2', '2x2', '2x3', '3x2']
export const GRID_STORAGE_KEY = 'sessiondeck.grid.v1'

const SHAPES: Readonly<Record<GridPreset, GridShape>> = {
  '1x1': { cols: 1, rows: 1 },
  '2x1': { cols: 2, rows: 1 },
  '1x2': { cols: 1, rows: 2 },
  '2x2': { cols: 2, rows: 2 },
  '2x3': { cols: 2, rows: 3 },
  '3x2': { cols: 3, rows: 2 }
}

export function isGridPreset(value: unknown): value is GridPreset {
  return typeof value === 'string' && value in SHAPES
}

export function presetShape(preset: GridPreset): GridShape {
  return SHAPES[preset]
}

/** An all-empty grid of the preset's shape. */
export function presetLayout(preset: GridPreset): GridLayout {
  const { cols, rows } = presetShape(preset)
  return { preset, cells: Array.from({ length: cols * rows }, (): null => null) }
}

/** The cells padded/trimmed to the preset's shape, keeping every existing assignment. */
export function resizedCells(cells: readonly (Id | null)[], preset: GridPreset): readonly (Id | null)[] {
  const { cols, rows } = presetShape(preset)
  const size = cols * rows
  const next = Array.from({ length: size }, (__, index): Id | null => cells[index] ?? null)
  return next
}

/**
 * Reconciles a stored grid with the sessions that are actually open: closed/unknown ids become empty
 * cells and a duplicate id keeps its FIRST cell. Cells are never re-ordered or auto-filled (D32).
 */
export function normalizeGrid(
  layout: GridLayout,
  openIds: readonly Id[]
): GridLayout {
  const open = new Set<Id>(openIds)
  const seen = new Set<Id>()
  const cells = layout.cells.map((id): Id | null => {
    if (id === null || !open.has(id) || seen.has(id)) return null
    seen.add(id)
    return id
  })
  return { preset: layout.preset, cells: resizedCells(cells, layout.preset) }
}

/**
 * Assigns a session to one cell. An already-assigned session MOVES there and the cell's current
 * occupant takes the moved session's old cell (a swap — no duplicates, D-b); assigning into an empty
 * occupied cell replaces the occupant (it becomes unassigned); null clears the cell.
 */
export function setCell(
  layout: GridLayout,
  index: number,
  id: Id | null
): GridLayout {
  const { cols, rows } = presetShape(layout.preset)
  const size = cols * rows
  if (!Number.isInteger(index) || index < 0 || index >= size) return layout
  const cells = resizedCells(layout.cells, layout.preset).slice()
  if (id !== null) {
    const existing = cells.indexOf(id)
    if (existing === index) return layout
    if (existing >= 0) cells[existing] = cells[index]
  }
  cells[index] = id
  return { preset: layout.preset, cells }
}

/** The cell index showing this session, or null when it is not in the grid. */
export function cellIndexFor(layout: GridLayout, sessionId: Id | null): number | null {
  if (sessionId === null) return null
  const index = layout.cells.indexOf(sessionId)
  return index < 0 ? null : index
}

/** The ids that no longer fit `preset`'s shape (shrinking): the caller keeps them in the overflow. */
export function collectOverflow(cells: readonly (Id | null)[], preset: GridPreset): readonly Id[] {
  const size = presetShape(preset).cols * presetShape(preset).rows
  return cells.slice(size).filter((id): id is Id => id !== null)
}

/** Fills empty cells from the overflow, in order; ids that do not fit stay in the overflow. */
export function assignOverflow(
  layout: GridLayout,
  overflow: readonly Id[]
): { readonly layout: GridLayout; readonly overflow: readonly Id[] } {
  const cells = resizedCells(layout.cells, layout.preset).slice()
  const kept: Id[] = []
  for (const id of overflow) {
    const free = cells.indexOf(null)
    if (free < 0) {
      kept.push(id)
      continue
    }
    cells[free] = id
  }
  return { layout: { preset: layout.preset, cells }, overflow: kept }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Restores a persisted grid. Any malformed shape becomes null (caller falls back to an empty 1x1). */
export function parseGrid(raw: string | null): GridLayout | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const preset = parsed['preset']
  if (!isGridPreset(preset)) return null
  const rawCells = parsed['cells']
  if (!Array.isArray(rawCells)) return null
  const { cols, rows } = presetShape(preset)
  if (rawCells.length !== cols * rows) return null
  const seen = new Set<Id>()
  const cells: (Id | null)[] = rawCells.map((value) => {
    if (value === null) return null
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) return 'INVALID'
    seen.add(value)
    return value
  })
  if (cells.includes('INVALID')) return null
  return { preset, cells: cells as readonly (Id | null)[] }
}

export function serializeGrid(layout: GridLayout): string {
  return JSON.stringify({ preset: layout.preset, cells: layout.cells })
}
