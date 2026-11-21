// A terminal line as text PLUS the terminal columns of every character (D75 review fix).
// The link provider finds paths in a string, but xterm underlines and activates CELLS: a wide character (CJK, emoji)
// takes two cells and a combining mark takes none, so "character offset + 1" is the wrong column as soon as such a
// character appears before or inside a link (the underline sat left of the text and the tail of a CJK path was dead).

/** The part of xterm's IBufferCell the mapping needs (tests pass fakes). */
export interface CellLike {
  getChars(): string
  getWidth(): number
}

/** The part of xterm's IBufferLine the mapping needs. */
export interface LineLike {
  readonly length: number
  getCell(x: number): CellLike | undefined
}

export interface LineText {
  readonly text: string
  /** For each UTF-16 unit of `text`: the 1-based column of the cell where its character starts. */
  readonly startCells: readonly number[]
  /** For each UTF-16 unit of `text`: the 1-based column of the LAST cell its character covers (2-wide: start + 1). */
  readonly endCells: readonly number[]
}

/** Reads one physical line into text and per-unit columns. Trailing blanks are dropped, like `translateToString(true)`. */
export function readLineText(line: LineLike): LineText {
  let text = ''
  const startCells: number[] = []
  const endCells: number[] = []
  for (let x = 0; x < line.length; x += 1) {
    const cell = line.getCell(x)
    if (cell === undefined) break
    const width = cell.getWidth()
    // The second cell of a wide character carries no character of its own.
    if (width === 0) continue
    const chars = cell.getChars()
    const shown = chars === '' ? ' ' : chars
    for (let unit = 0; unit < shown.length; unit += 1) {
      startCells.push(x + 1)
      endCells.push(x + Math.max(1, width))
    }
    text += shown
  }
  let end = text.length
  while (end > 0 && text[end - 1] === ' ') end -= 1
  if (end === text.length) return { text, startCells, endCells }
  return { text: text.slice(0, end), startCells: startCells.slice(0, end), endCells: endCells.slice(0, end) }
}
