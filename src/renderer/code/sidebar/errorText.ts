// Turns a rejected IPC call into the text a user should read. No React, no IPC.

/** Electron prefixes a main-process error as "Error invoking remote method 'x': Error: <message>". */
const MAIN_ERROR_MARKER = 'Error: '

/**
 * The user-facing part of an error. For an IPC rejection, that is the text after the last "Error: " (the
 * main-process message). Any other message is returned unchanged.
 */
export function cleanErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const markerAt = raw.lastIndexOf(MAIN_ERROR_MARKER)
  if (markerAt < 0) {
    return raw
  }
  const cleaned = raw.slice(markerAt + MAIN_ERROR_MARKER.length).trim()
  return cleaned.length > 0 ? cleaned : raw
}
