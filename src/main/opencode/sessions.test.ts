import { describe, expect, it, vi } from 'vitest'
import {
  listOpencodeSessions,
  parseOpencodeSessionList,
  pickSessionToAdopt,
  SESSION_ADOPT_SLACK_MS,
  type OpencodeSessionInfo
} from './sessions'

const NOW = 1_800_000_000_000

function info(overrides: Partial<OpencodeSessionInfo> & { id: string }): OpencodeSessionInfo {
  return { directory: 'C:\\works\\repo', created: NOW, updated: NOW, ...overrides }
}

function pick(
  sessions: readonly OpencodeSessionInfo[],
  overrides: { cwd?: string; startedAtMs?: number; knownIds?: ReadonlySet<string> } = {}
) {
  return pickSessionToAdopt({
    cwd: overrides.cwd ?? 'C:\\works\\repo',
    startedAtMs: overrides.startedAtMs ?? NOW,
    knownIds: overrides.knownIds ?? new Set<string>(),
    sessions
  })
}

describe('parseOpencodeSessionList', () => {
  it('reads the fields of a real v2.1.4 row and drops the ones it does not use', () => {
    const parsed = parseOpencodeSessionList([
      {
        id: 'ses_e00dba028ffeGOZPynIPdAfllC',
        title: 'OpenCode plugin permission and health',
        updated: 1795281941898,
        created: 1795281936498,
        projectId: '6ca83a676edf5f8a4b216ac8020144bf7cfbb047',
        directory: 'C:\\works\\session-deck\\session-deck'
      }
    ])
    expect(parsed).toEqual([
      {
        id: 'ses_e00dba028ffeGOZPynIPdAfllC',
        title: 'OpenCode plugin permission and health',
        updated: 1795281941898,
        created: 1795281936498,
        directory: 'C:\\works\\session-deck\\session-deck'
      }
    ])
  })

  it('skips rows without a valid ses_ id and keeps the valid ones', () => {
    const parsed = parseOpencodeSessionList([
      { id: 'not-a-session', directory: 'C:\\works\\repo' },
      { id: 'ses_bad id', directory: 'C:\\works\\repo' },
      { id: 42 },
      null,
      'row',
      { title: 'no id' },
      { id: 'ses_abcdefgh1234', directory: 'C:\\works\\repo', created: NOW, updated: NOW }
    ])
    expect(parsed.map((s) => s.id)).toEqual(['ses_abcdefgh1234'])
  })

  it('ignores wrong field types instead of throwing', () => {
    const parsed = parseOpencodeSessionList([
      { id: 'ses_abcdefgh1234', title: 7, directory: null, created: 'yesterday', updated: Number.NaN }
    ])
    expect(parsed).toEqual([{ id: 'ses_abcdefgh1234' }])
  })

  it('returns [] for every non-array shape', () => {
    expect(parseOpencodeSessionList(null)).toEqual([])
    expect(parseOpencodeSessionList(undefined)).toEqual([])
    expect(parseOpencodeSessionList({})).toEqual([])
    expect(parseOpencodeSessionList('[]')).toEqual([])
    expect(parseOpencodeSessionList([{ id: 'ses_abcdefgh1234' }])).toHaveLength(1)
  })
})

describe('pickSessionToAdopt', () => {
  it('adopts the single recent session of the folder', () => {
    expect(pick([info({ id: 'ses_aaaabbbbcccc' })])).toEqual({ kind: 'adopt', id: 'ses_aaaabbbbcccc' })
  })

  it('matches Windows path variants: case, backslashes, forward slashes, trailing slash', () => {
    const variants = ['c:/works/repo', 'C:/Works/Repo/', 'C:\\Works\\Repo\\', 'c:\\works\\repo']
    for (const directory of variants) {
      expect(pick([info({ id: 'ses_aaaabbbbcccc', directory })], { cwd: 'C:\\works\\repo' })).toEqual({
        kind: 'adopt',
        id: 'ses_aaaabbbbcccc'
      })
    }
    // And the other way round: a lower-case forward-slash cwd with a backslash directory on the row.
    expect(pick([info({ id: 'ses_aaaabbbbcccc', directory: 'C:\\Works\\Repo' })], { cwd: 'c:/works/repo/' })).toEqual({
      kind: 'adopt',
      id: 'ses_aaaabbbbcccc'
    })
  })

  it('does not confuse sibling folders that only share a prefix', () => {
    const sessions = [
      info({ id: 'ses_aaaabbbbcccc', directory: 'C:\\works\\repo-two' }),
      info({ id: 'ses_ddddeeeeffff', directory: 'C:\\works\\repo\\nested' })
    ]
    expect(pick(sessions)).toEqual({ kind: 'none' })
  })

  it('reports several recent matches in one folder as ambiguous', () => {
    const sessions = [
      info({ id: 'ses_aaaabbbbcccc' }),
      info({ id: 'ses_ddddeeeeffff', created: NOW - 1000, updated: NOW - 500 })
    ]
    expect(pick(sessions)).toEqual({ kind: 'ambiguous', ids: ['ses_aaaabbbbcccc', 'ses_ddddeeeeffff'] })
  })

  it('does not turn a duplicated row into an ambiguity', () => {
    const sessions = [info({ id: 'ses_aaaabbbbcccc' }), info({ id: 'ses_aaaabbbbcccc', updated: NOW + 5 })]
    expect(pick(sessions)).toEqual({ kind: 'adopt', id: 'ses_aaaabbbbcccc' })
  })

  it('ignores ids known to other SessionDeck sessions, so two sessions never adopt one conversation', () => {
    const sessions = [info({ id: 'ses_aaaabbbbcccc' }), info({ id: 'ses_ddddeeeeffff' })]
    expect(pick(sessions, { knownIds: new Set(['ses_aaaabbbbcccc']) })).toEqual({
      kind: 'adopt',
      id: 'ses_ddddeeeeffff'
    })
    expect(pick(sessions, { knownIds: new Set(['ses_aaaabbbbcccc', 'ses_ddddeeeeffff']) })).toEqual({ kind: 'none' })
  })

  it('uses created or updated, and accepts anything down to the slack window', () => {
    expect(
      pick([info({ id: 'ses_aaaabbbbcccc', created: NOW - 10, updated: NOW - 10 })], {
        startedAtMs: NOW - SESSION_ADOPT_SLACK_MS + 10
      })
    ).toEqual({ kind: 'adopt', id: 'ses_aaaabbbbcccc' })
    // A row created long ago but used during this launch is the resumed conversation.
    expect(pick([info({ id: 'ses_aaaabbbbcccc', created: 1, updated: NOW })])).toEqual({
      kind: 'adopt',
      id: 'ses_aaaabbbbcccc'
    })
  })

  it('ignores sessions older than the launch minus the slack', () => {
    const startedAtMs = NOW + SESSION_ADOPT_SLACK_MS + 1
    expect(pick([info({ id: 'ses_aaaabbbbcccc', created: NOW, updated: NOW })], { startedAtMs })).toEqual({
      kind: 'none'
    })
  })

  it('ignores rows without a directory or without any timestamp (cannot be proven to match)', () => {
    expect(pick([info({ id: 'ses_aaaabbbbcccc', directory: undefined })])).toEqual({ kind: 'none' })
    expect(pick([info({ id: 'ses_aaaabbbbcccc', created: undefined, updated: undefined })])).toEqual({ kind: 'none' })
  })

  it('returns none for an empty list, an empty cwd or a non-finite start time', () => {
    expect(pick([])).toEqual({ kind: 'none' })
    expect(pick([info({ id: 'ses_aaaabbbbcccc' })], { cwd: '   ' })).toEqual({ kind: 'none' })
    expect(pick([info({ id: 'ses_aaaabbbbcccc' })], { startedAtMs: Number.NaN })).toEqual({ kind: 'none' })
  })
})

describe('listOpencodeSessions', () => {
  it('runs the read-only list command with an argument array and parses the output', async () => {
    const run = vi.fn(async (_args: string[]): Promise<string> => JSON.stringify([info({ id: 'ses_aaaabbbbcccc' })]))
    await expect(listOpencodeSessions(run)).resolves.toEqual([info({ id: 'ses_aaaabbbbcccc' })])
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toEqual(['session', 'list', '--format', 'json'])
  })

  it('returns [] when the runner rejects (CLI missing, non-zero exit)', async () => {
    await expect(
      listOpencodeSessions(async (): Promise<string> => {
        throw new Error('exit 1')
      })
    ).resolves.toEqual([])
  })

  it('returns [] for empty or malformed output instead of throwing', async () => {
    await expect(listOpencodeSessions(async (): Promise<string> => '')).resolves.toEqual([])
    await expect(listOpencodeSessions(async (): Promise<string> => 'not json at all')).resolves.toEqual([])
    await expect(listOpencodeSessions(async (): Promise<string> => '[{"id":')).resolves.toEqual([])
    await expect(listOpencodeSessions(async (): Promise<string> => '{"id":"ses_aaaabbbbcccc"}')).resolves.toEqual([])
  })

  it('tolerates log lines printed before the JSON array', async () => {
    const output = `INFO service=session listing\n${JSON.stringify([info({ id: 'ses_aaaabbbbcccc' })])}`
    await expect(listOpencodeSessions(async (): Promise<string> => output)).resolves.toEqual([
      info({ id: 'ses_aaaabbbbcccc' })
    ])
  })

  it('drops ids the store would reject', async () => {
    const output = JSON.stringify([{ id: 'ses_bad id' }, { id: 'ses_aaaabbbbcccc', directory: 'C:\\works\\repo' }])
    await expect(listOpencodeSessions(async (): Promise<string> => output)).resolves.toEqual([
      { id: 'ses_aaaabbbbcccc', directory: 'C:\\works\\repo' }
    ])
  })
})
