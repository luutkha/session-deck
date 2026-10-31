import { describe, expect, it } from 'vitest'
import { PRESET_MAX, PRESET_NAME_MAX, type SessionPreset } from '../../shared/types'
import { emptyStore } from './reducers'
import { parseStoreData } from './persistence'
import { parsePresets, removePreset, upsertPreset, validatePreset } from './presets'

const base: SessionPreset = {
  id: 'p1',
  name: 'Backend',
  cwd: 'C:/work/api',
  agent: 'claude',
  claudeArgs: ['--remote-control'],
  groupId: null,
  statusId: null
}

describe('validatePreset', () => {
  it('trims the name and folder and keeps a valid Claude preset', () => {
    expect(validatePreset({ ...base, name: '  Backend  ', cwd: ' C:/work/api ' })).toEqual(base)
  })

  it('keeps the model only for OpenCode and the args only for Claude', () => {
    expect(validatePreset({ ...base, agent: 'opencode', model: ' opencode/big-pickle ', claudeArgs: ['--x'] })).toEqual({
      ...base, agent: 'opencode', model: 'opencode/big-pickle', claudeArgs: []
    })
    expect(validatePreset({ ...base, agent: 'claude', model: 'x/y' })).not.toHaveProperty('model')
    expect(validatePreset({ ...base, agent: 'shell' }).claudeArgs).toEqual([])
  })

  it.each([
    ['a missing id', { ...base, id: '' }],
    ['a blank name', { ...base, name: '   ' }],
    ['a long name', { ...base, name: 'x'.repeat(PRESET_NAME_MAX + 1) }],
    ['no folder', { ...base, cwd: '' }],
    ['an unknown agent', { ...base, agent: 'gpt' }],
    ['args that are not strings', { ...base, claudeArgs: [1] }],
    ['a bad group id', { ...base, groupId: 5 }],
    ['not an object', 'x']
  ])('rejects %s', (_label, raw) => {
    expect(() => validatePreset(raw)).toThrow('Invalid preset')
  })
})

describe('upsertPreset / removePreset', () => {
  it('adds, replaces in place and removes', () => {
    const one = upsertPreset(emptyStore(), base)
    expect(one.presets).toEqual([base])
    const two = upsertPreset(one, { ...base, id: 'p2', name: 'Docs' })
    const renamed = upsertPreset(two, { ...base, name: 'API' })
    expect(renamed.presets?.map((p) => p.name)).toEqual(['API', 'Docs'])
    const removed = removePreset(renamed, 'p1')
    expect(removed.presets?.map((p) => p.id)).toEqual(['p2'])
    expect(removePreset(removed, 'p2')).not.toHaveProperty('presets')
    expect(removePreset(removed, 'nope')).toBe(removed)
  })

  it(`refuses a new preset beyond ${PRESET_MAX}, but still replaces an existing one`, () => {
    let data = emptyStore()
    for (let i = 0; i < PRESET_MAX; i += 1) data = upsertPreset(data, { ...base, id: `p${i}`, name: `n${i}` })
    expect(() => upsertPreset(data, { ...base, id: 'extra' })).toThrow(`at most ${PRESET_MAX}`)
    expect(upsertPreset(data, { ...base, id: 'p0', name: 'changed' }).presets?.[0]?.name).toBe('changed')
  })
})

describe('parsePresets and persistence', () => {
  it('drops invalid entries and duplicates, and clears a deleted group or status', () => {
    const parsed = parsePresets(
      [base, { ...base }, { id: 'bad' }, { ...base, id: 'p2', groupId: 'gone', statusId: 'st1' }],
      new Set(['g1']),
      new Set(['st1'])
    )
    expect(parsed).toEqual([base, { ...base, id: 'p2', groupId: null, statusId: 'st1' }])
    expect(parsePresets('nope', new Set(), new Set())).toBeUndefined()
    expect(parsePresets([], new Set(), new Set())).toBeUndefined()
  })

  it('round trips through the store file and old files load without presets', () => {
    const data = { ...emptyStore(), presets: [base] }
    expect(parseStoreData(JSON.parse(JSON.stringify(data)))).toEqual(data)
    expect(parseStoreData(JSON.parse(JSON.stringify(emptyStore())))).not.toHaveProperty('presets')
  })
})
