import { describe, expect, it } from 'vitest'
import { cleanErrorMessage } from './errorText'

describe('cleanErrorMessage', () => {
  it('keeps only the main-process message of an IPC rejection', () => {
    const error = new Error(
      "Error invoking remote method 'worktree:create': Error: A branch named \"x\" already exists in this repository."
    )
    expect(cleanErrorMessage(error)).toBe('A branch named "x" already exists in this repository.')
  })

  it('returns a plain message unchanged', () => {
    expect(cleanErrorMessage(new Error('Folder required'))).toBe('Folder required')
  })

  it('reads the text after the last marker when the message has several', () => {
    expect(cleanErrorMessage(new Error("Error invoking remote method 'x': Error: outer: Error: inner"))).toBe('inner')
  })

  it('accepts a rejection that is a plain string', () => {
    expect(cleanErrorMessage("Error invoking remote method 'repo:add': Error: Not a git repository.")).toBe(
      'Not a git repository.'
    )
  })

  it('keeps the whole message when nothing follows the marker', () => {
    expect(cleanErrorMessage(new Error("Error invoking remote method 'x': Error: "))).toBe(
      "Error invoking remote method 'x': Error: "
    )
  })

  it('stringifies non-error values', () => {
    expect(cleanErrorMessage(42)).toBe('42')
  })
})
