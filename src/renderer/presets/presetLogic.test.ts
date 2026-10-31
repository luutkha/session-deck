import { describe, expect, it } from 'vitest'
import type { SessionPreset } from '../../shared/types'
import { createInputFromPreset, formFromPreset, presetDetail, presetFromInput, presetIdForName, suggestedPresetName } from './presetLogic'

const claude: SessionPreset = {
  id: 'p1', name: 'Backend', cwd: 'C:/work/api', agent: 'claude', claudeArgs: ['--verbose', '--remote-control'], groupId: 'g1', statusId: 's1'
}

describe('presetFromInput', () => {
  it('keeps the args for Claude and the model for OpenCode', () => {
    expect(presetFromInput({ cwd: 'C:/a', agent: 'claude', claudeArgs: ['--x'], groupId: null, statusId: null }, ' Name ', 'id1')).toEqual({
      id: 'id1', name: 'Name', cwd: 'C:/a', agent: 'claude', claudeArgs: ['--x'], groupId: null, statusId: null
    })
    expect(presetFromInput({ cwd: 'C:/a', agent: 'opencode', model: 'a/b', groupId: 'g', statusId: null }, 'O', 'id2')).toEqual({
      id: 'id2', name: 'O', cwd: 'C:/a', agent: 'opencode', model: 'a/b', claudeArgs: [], groupId: 'g', statusId: null
    })
  })
})

describe('formFromPreset', () => {
  it('splits Remote Control out of the raw args', () => {
    expect(formFromPreset(claude)).toEqual({
      agent: 'claude', folder: 'C:/work/api', groupId: 'g1', statusId: 's1', argsRaw: '--verbose', modelRaw: '', remoteControl: true
    })
  })
})

describe('createInputFromPreset', () => {
  it('builds a session:create input and drops a deleted group or status', () => {
    const data = { groups: [{ id: 'g1', name: 'G', collapsed: false }], statuses: [] }
    expect(createInputFromPreset(claude, data)).toEqual({
      cwd: 'C:/work/api', groupId: 'g1', statusId: null, agent: 'claude', claudeArgs: ['--verbose', '--remote-control']
    })
    expect(createInputFromPreset({ ...claude, agent: 'opencode', model: 'x/y', claudeArgs: [] }, { groups: [], statuses: [] })).toEqual({
      cwd: 'C:/work/api', groupId: null, statusId: null, agent: 'opencode', model: 'x/y'
    })
  })
})

describe('naming helpers', () => {
  it('reuses the id of a preset with the same name (any case)', () => {
    expect(presetIdForName([claude], 'backend ', 'new')).toBe('p1')
    expect(presetIdForName([claude], 'Docs', 'new')).toBe('new')
  })

  it('suggests the typed session name, else the folder name', () => {
    expect(suggestedPresetName(' API work ', 'C:/x/y')).toBe('API work')
    expect(suggestedPresetName('', 'C:/work/api')).toBe('api')
  })

  it('describes a preset by folder and agent', () => {
    expect(presetDetail(claude)).toBe('api · Claude')
    expect(presetDetail({ ...claude, agent: 'opencode', model: 'a/b' })).toBe('api · OpenCode a/b')
    expect(presetDetail({ ...claude, agent: 'shell' })).toBe('api · Shell')
  })
})
