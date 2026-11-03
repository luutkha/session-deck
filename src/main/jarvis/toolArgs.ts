// Argument helpers shared by every Jarvis tool file (D53/D55): plain checks with messages written for the model.
export function text(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`"${key}" is required.`)
  return value
}

export function optionalText(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`"${key}" must be text.`)
  return value.trim().length === 0 ? undefined : value
}

export function optionalBool(args: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new Error(`"${key}" must be true or false.`)
  return value
}

export function optionalInt(args: Readonly<Record<string, unknown>>, key: string, fallback: number, max: number): number {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`"${key}" must be a positive whole number.`)
  return Math.min(value, max)
}

export const SESSION_PROP = { type: 'string', description: 'Session name (or part of it) or id. Ask the user when a name matches several sessions.' }

export function schema(properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}
