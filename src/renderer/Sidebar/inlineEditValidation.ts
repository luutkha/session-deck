export function validateName(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: 'Name required' }
  }
  if (trimmed.length > 100) {
    return { ok: false, error: 'Name too long' }
  }
  return { ok: true, value: trimmed }
}