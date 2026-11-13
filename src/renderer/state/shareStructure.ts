// Structural sharing for the renderer's store snapshot: a store broadcast replaces the whole
// `StoreData` with brand-new objects, which makes every memo'd component see "changed" data. This
// keeps the previous reference wherever a subtree is deeply equal, so only the changed path is new.
// Plain JSON-like data only (objects, arrays, primitives); undefined values are treated as missing keys.

import { isRecord } from '../../shared/guards'

function shareArray(previous: readonly unknown[], next: readonly unknown[]): readonly unknown[] {
  if (previous.length !== next.length) {
    return buildArray(previous, next)
  }
  for (let index = 0; index < next.length; index += 1) {
    if (!Object.is(shareValue(previous[index], next[index]), previous[index])) {
      return buildArray(previous, next)
    }
  }
  return previous
}

function buildArray(previous: readonly unknown[], next: readonly unknown[]): readonly unknown[] {
  const result: unknown[] = []
  for (let index = 0; index < next.length; index += 1) {
    result.push(shareValue(previous[index], next[index]))
  }
  return result
}

function shareObject(previous: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  // A key whose value is undefined is equivalent to a missing key, so { a: 1 } equals { a: 1, b: undefined }.
  for (const key of Object.keys(previous)) {
    if (previous[key] !== undefined && next[key] === undefined) {
      return buildObject(previous, next)
    }
  }
  for (const key of Object.keys(next)) {
    if (!Object.is(shareValue(previous[key], next[key]), previous[key])) {
      return buildObject(previous, next)
    }
  }
  return previous
}

function buildObject(previous: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(next)) {
    result[key] = shareValue(previous[key], next[key])
  }
  return result
}

function shareValue(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous
  if (Array.isArray(previous) && Array.isArray(next)) return shareArray(previous, next)
  if (isRecord(previous) && isRecord(next)) return shareObject(previous, next)
  return next
}

/**
 * Returns `previous` itself when `next` is deeply equal, otherwise a new value in which every
 * unchanged object/array subtree is the same reference as in `previous`. Linear in the input size,
 * never mutates either input.
 */
export function shareStructure<T>(previous: T, next: T): T {
  return shareValue(previous, next) as T
}
