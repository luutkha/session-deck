// Small runtime helpers shared by main and renderer. No Electron, no Node, no DOM.

/** A plain JSON-like object: not null and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The message of a thrown value: `Error.message`, or the value as a string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
