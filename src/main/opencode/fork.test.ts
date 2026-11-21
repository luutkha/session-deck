import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import type { OpencodeSessionInfo } from './sessions'
import { isSessionExport, parseImportedSessionId, pickNewSessionId, remapExportIds, writeForkFile } from './fork'
import { isOpencodeSessionId } from './values'

const EXPORT = JSON.stringify({
  info: { id: 'ses_parent12345678', title: 'Deploy notes', location: { directory: 'C:\\works\\repo' } },
  messages: [{ id: 'msg_1', type: 'user', text: 'hello' }]
})

function info(id: string, directory?: string): OpencodeSessionInfo {
  return { id, ...(directory !== undefined ? { directory } : {}) }
}

describe('isSessionExport', () => {
  it('accepts the export shape the CLI prints', () => {
    expect(isSessionExport(EXPORT)).toBe(true)
    // Log lines around the JSON (some builds print them) are tolerated.
    expect(isSessionExport(`INFO service=session exporting\n${EXPORT}`)).toBe(true)
    // A bare session object with an id is enough to import.
    expect(isSessionExport('{"id":"ses_parent12345678"}')).toBe(true)
  })

  it('refuses an error page, empty output, an array or plain text', () => {
    expect(isSessionExport('')).toBe(false)
    expect(isSessionExport('Session not found: ses_missing1234567')).toBe(false)
    expect(isSessionExport('[]')).toBe(false)
    expect(isSessionExport('{"messages":"nope"}')).toBe(false)
  })
})

describe('parseImportedSessionId', () => {
  it('reads the id when import prints one id as text', () => {
    expect(parseImportedSessionId('Imported session ses_newfork12345678\n')).toBe('ses_newfork12345678')
    expect(parseImportedSessionId('ses_newfork12345678')).toBe('ses_newfork12345678')
  })

  it('reads the id of an imported session printed as JSON (top level or under info)', () => {
    expect(parseImportedSessionId('{"id":"ses_newfork12345678","title":"copy"}')).toBe('ses_newfork12345678')
    expect(parseImportedSessionId('{"info":{"id":"ses_newfork12345678"}}')).toBe('ses_newfork12345678')
  })

  it('does not guess when several ids are printed as text', () => {
    expect(parseImportedSessionId('Imported ses_parent12345678 as ses_newfork12345678')).toBeNull()
  })

  it('returns null for empty or id-less output, and ignores malformed ids', () => {
    expect(parseImportedSessionId('')).toBeNull()
    expect(parseImportedSessionId('done\n')).toBeNull()
    expect(parseImportedSessionId('ses_bad id')).toBeNull()
    expect(parseImportedSessionId('{"title":"copy"}')).toBeNull()
  })
})

describe('pickNewSessionId', () => {
  it('picks the one row the import added', () => {
    const before = [info('ses_parent12345678', 'C:\\works\\repo')]
    const after = [info('ses_newfork12345678', 'C:\\works\\repo'), ...before]
    expect(pickNewSessionId(before, after)).toBe('ses_newfork12345678')
    expect(pickNewSessionId(before, after, 'c:/works/repo/')).toBe('ses_newfork12345678')
  })

  it('accepts a new row without a directory (the listing already ran in the session folder)', () => {
    expect(pickNewSessionId([], [info('ses_newfork12345678')], 'C:\\works\\repo')).toBe('ses_newfork12345678')
  })

  it('refuses when nothing was added', () => {
    const rows = [info('ses_parent12345678', 'C:\\works\\repo')]
    expect(pickNewSessionId(rows, rows, 'C:\\works\\repo')).toBeNull()
    expect(pickNewSessionId([], [], 'C:\\works\\repo')).toBeNull()
  })

  it('refuses when several rows appeared: it cannot tell which one is the copy', () => {
    expect(pickNewSessionId([], [info('ses_a12345678'), info('ses_b12345678')])).toBeNull()
  })

  it('matches the old rows by id even when the listing prints them again with a new timestamp', () => {
    const before = [info('ses_parent12345678', 'C:\\works\\repo')]
    const after = [{ ...info('ses_parent12345678', 'C:\\works\\repo'), updated: 1 }, info('ses_newfork12345678')]
    expect(pickNewSessionId(before, after)).toBe('ses_newfork12345678')
  })

  it('drops a new row of another folder when the folder is known', () => {
    expect(pickNewSessionId([], [info('ses_other12345678', 'C:\\works\\elsewhere')], 'C:\\works\\repo')).toBeNull()
  })
})

describe('writeForkFile', () => {
  it('writes the export to the temp folder, then removes it (and never throws on a second cleanup)', async () => {
    const file = await writeForkFile(EXPORT)
    expect(dirname(file.path).toLowerCase()).toBe(tmpdir().toLowerCase())
    expect(file.path).not.toContain('C:\\works\\repo')
    expect(readFileSync(file.path, 'utf-8')).toBe(EXPORT)
    await file.cleanup()
    expect(existsSync(file.path)).toBe(false)
    await expect(file.cleanup()).resolves.toBeUndefined()
  })
})

describe('remapExportIds', () => {
  const ses = 'ses_e00c5b60cffeXmDCJigWpbwgnT'
  const msg = 'msg_1ff3a49f5001tVTOeQJId9p60r'
  const text = JSON.stringify({ info: { id: ses }, messages: [{ id: msg, parent: msg }] })

  it('gives every id a fresh tail, keeps the time prefix and the same id maps to the same new id', () => {
    const out = remapExportIds(text)
    expect(out.json).not.toContain(ses)
    expect(out.json).not.toContain(msg)
    expect(out.sessionId).not.toBeNull()
    expect(out.sessionId!.startsWith('ses_e00c5b60cffe')).toBe(true)
    expect(out.sessionId).toHaveLength(ses.length)
    const parsed = JSON.parse(out.json) as { info: { id: string }; messages: { id: string; parent: string }[] }
    expect(parsed.info.id).toBe(out.sessionId)
    expect(parsed.messages[0].id).toBe(parsed.messages[0].parent)
    expect(parsed.messages[0].id.startsWith('msg_1ff3a49f5001')).toBe(true)
    expect(isOpencodeSessionId(parsed.info.id)).toBe(true)
  })

  it('two runs give different ids, and text without ids is returned as it was', () => {
    expect(remapExportIds(text).sessionId).not.toBe(remapExportIds(text).sessionId)
    expect(remapExportIds('{"a":1}')).toEqual({ json: '{"a":1}', sessionId: null })
  })
})
