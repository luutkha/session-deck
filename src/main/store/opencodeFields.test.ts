import { describe, it, expect, vi } from 'vitest'
import type { CreateSessionInput, StoreData } from '../../shared/types'
import { DEFAULT_APP_SETTINGS } from '../../shared/types'
import { parseStoreData } from './persistence'
import { emptyStore, createSession, setOpencodeSessionId, setClaudeSessionId } from './reducers'
import { parseStoredSettings, settingsProblem, updateSettings } from './settings'
import { SessionStore } from './SessionStore'

const META = { id: 's1', now: 42 }
const OC_ID = 'ses_abcdef12345678'

function baseData(): StoreData {
  return emptyStore()
}

function ocInput(overrides: Partial<CreateSessionInput> = {}): CreateSessionInput {
  return { cwd: 'C:/proj', agent: 'opencode', model: 'opencode/deepseek-v4.1-flash-free', ...overrides }
}

describe('createSession reducer: agent / model fields', () => {
  it('an opencode session stores agent and a non-empty model, and no Claude conversation id', () => {
    const { data, session } = createSession(baseData(), ocInput(), META)
    const stored = data.sessions[0]
    expect(stored.agent).toBe('opencode')
    expect(stored.model).toBe('opencode/deepseek-v4.1-flash-free')
    expect(stored.opencodeSessionId).toBeUndefined()
    expect(stored.claudeSessionId).toBeUndefined()
    expect(session).toBe(stored)
  })

  it('an empty model means OpenCode\'s own default (field absent)', () => {
    const { data } = createSession(baseData(), ocInput({ model: '' }), META)
    expect(data.sessions[0].model).toBeUndefined()
    const { data: data2 } = createSession(baseData(), ocInput({ model: undefined }), META)
    expect(data2.sessions[0].model).toBeUndefined()
  })

  it('claude sessions (agent absent) stay byte-for-byte like before: claudeSessionId = the new id, no agent field', () => {
    const { data } = createSession(baseData(), { cwd: 'C:/proj' }, META)
    const stored = data.sessions[0]
    expect(stored.agent).toBeUndefined()
    expect(stored.model).toBeUndefined()
    expect(stored.claudeSessionId).toBe('s1')
  })

  it('D79: only the opt-in "ask" permission policy is stored (yolo stays implicit)', () => {
    const ask = createSession(baseData(), ocInput({ opencodePermissions: 'ask' }), META)
    expect(ask.data.sessions[0].opencodePermissions).toBe('ask')

    const yolo = createSession(baseData(), ocInput({ opencodePermissions: 'yolo' }), META)
    expect(yolo.data.sessions[0].opencodePermissions).toBeUndefined()

    const claude = createSession(baseData(), { cwd: 'C:/proj', opencodePermissions: 'ask' }, META)
    expect(claude.data.sessions[0].opencodePermissions).toBeUndefined()
  })

  it('an explicit claude agent behaves like the default', () => {
    const { data } = createSession(baseData(), { cwd: 'C:/proj', agent: 'claude', model: 'p/m' }, META)
    expect(data.sessions[0].agent).toBeUndefined()
    expect(data.sessions[0].model).toBeUndefined()
    expect(data.sessions[0].claudeSessionId).toBe('s1')
  })
})

describe('setOpencodeSessionId reducer', () => {
  it('stores the reported OpenCode conversation id on the right session', () => {
    const { data } = createSession(baseData(), ocInput(), META)
    const next = setOpencodeSessionId(data, 's1', OC_ID)
    expect(next.sessions[0].opencodeSessionId).toBe(OC_ID)
  })

  it('the same id again returns the SAME data (no save)', () => {
    const { data } = createSession(baseData(), ocInput(), META)
    const once = setOpencodeSessionId(data, 's1', OC_ID)
    expect(setOpencodeSessionId(once, 's1', OC_ID)).toBe(once)
  })

  it('rejects a value that is not ses_[A-Za-z0-9]{8,64}', () => {
    const { data } = createSession(baseData(), ocInput(), META)
    expect(() => setOpencodeSessionId(data, 's1', 'abc')).toThrow('Invalid opencodeSessionId')
    expect(() => setOpencodeSessionId(data, 's1', 'ses_short')).toThrow('Invalid opencodeSessionId')
    expect(() => setOpencodeSessionId(data, 's1', `ses_${'x'.repeat(65)}`)).toThrow('Invalid opencodeSessionId')
  })

  it('claude conversation ids keep their own validation (moved field check)', () => {
    const { data } = createSession(baseData(), ocInput(), META)
    expect(() => setClaudeSessionId(data, 's1', 'definitely-not-a-uuid')).toThrow('Invalid claudeSessionId')
  })
})

describe('SessionStore.setOpencodeSessionId', () => {
  function makeStore() {
    const schedule = vi.fn()
    const listener = vi.fn()
    const store = new SessionStore(baseData(), { schedule }, { newId: () => 's1', now: () => 42 })
    store.createSession(ocInput())
    store.subscribe(listener)
    return { store, schedule, listener }
  }

  it('persists and notifies; a duplicate id saves nothing', () => {
    const { store, schedule, listener } = makeStore()
    const savesBefore = schedule.mock.calls.length
    store.setOpencodeSessionId('s1', OC_ID)
    expect(schedule).toHaveBeenCalledTimes(savesBefore + 1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.get().sessions[0].opencodeSessionId).toBe(OC_ID)

    store.setOpencodeSessionId('s1', OC_ID)
    expect(schedule).toHaveBeenCalledTimes(savesBefore + 1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('invalid ids throw and neither save nor notify', () => {
    const { store, schedule, listener } = makeStore()
    const savesBefore = schedule.mock.calls.length
    expect(() => store.setOpencodeSessionId('s1', 'ses_bad char')).toThrow('Invalid opencodeSessionId')
    expect(schedule).toHaveBeenCalledTimes(savesBefore)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('persistence: opencode fields in stored sessions', () => {
  it('old store files without the new fields load as claude sessions (unchanged behaviour)', () => {
    const old = {
      version: 1,
      sessions: [
        {
          id: 's1',
          name: 'n',
          cwd: 'C:/p',
          groupId: null,
          statusId: null,
          order: 0,
          createdAt: 1,
          claudeArgs: [],
          claudeSessionId: '11111111-2222-3333-4444-555555555555'
        }
      ],
      groups: [],
      statuses: [],
      groupOrder: []
    }
    const data = parseStoreData(old)
    expect(data.sessions[0].agent).toBeUndefined()
    expect(data.sessions[0].opencodeSessionId).toBeUndefined()
    expect(data.sessions[0].model).toBeUndefined()
  })

  it('a round-trip of an opencode session parses back with all fields', () => {
    const { data } = createSession(baseData(), ocInput({ opencodePermissions: 'ask' }), META)
    const withId = setOpencodeSessionId(data, 's1', OC_ID)
    const parsed = parseStoreData(JSON.parse(JSON.stringify(withId)))
    expect(parsed.sessions[0]).toEqual(withId.sessions[0])
    expect(parsed.sessions[0].opencodePermissions).toBe('ask')
  })

  it('D79: an invalid stored permission policy is dropped, never failing the file', () => {
    const parsed = parseStoreData({
      version: 1,
      sessions: [
        {
          id: 's1', name: 'n', cwd: 'C:/p', groupId: null, statusId: null,
          order: 0, createdAt: 1, claudeArgs: [], agent: 'opencode', opencodePermissions: 'always'
        }
      ],
      groups: [], statuses: [], groupOrder: []
    })
    expect(parsed.sessions[0].opencodePermissions).toBeUndefined()
  })

  it('an opencode session may be stored without a model, with a model, closed, with a checklist (combinable)', () => {
    const parsed = parseStoreData({
      version: 1,
      sessions: [
        {
          id: 's1',
          name: 'oc',
          cwd: 'C:/p',
          groupId: null,
          statusId: null,
          order: 0,
          createdAt: 1,
          claudeArgs: [],
          agent: 'opencode',
          opencodeSessionId: OC_ID,
          model: 'p/m'
        }
      ],
      groups: [],
      statuses: [],
      groupOrder: []
    })
    expect(parsed.sessions[0]).toMatchObject({ agent: 'opencode', opencodeSessionId: OC_ID, model: 'p/m' })
  })

  it('agent+"claude" explicitly is normalized away (absent = claude)', () => {
    const parsed = parseStoreData({
      version: 1,
      sessions: [
        {
          id: 's1', name: 'n', cwd: 'C:/p', groupId: null, statusId: null,
          order: 0, createdAt: 1, claudeArgs: [], agent: 'claude', model: 'p/m'
        }
      ],
      groups: [], statuses: [], groupOrder: []
    })
    expect(parsed.sessions[0]).not.toHaveProperty('agent')
    expect(parsed.sessions[0]).not.toHaveProperty('model')
  })

  it('an empty stored model means the OpenCode default (absent)', () => {
    const parsed = parseStoreData({
      version: 1,
      sessions: [
        {
          id: 's1', name: 'n', cwd: 'C:/p', groupId: null, statusId: null,
          order: 0, createdAt: 1, claudeArgs: [], agent: 'opencode', model: ''
        }
      ],
      groups: [], statuses: [], groupOrder: []
    })
    expect(parsed.sessions[0]).not.toHaveProperty('model')
  })

  it('invalid agent / opencodeSessionId / model values invalidate the store like other required fields', () => {
    const make = (session: Record<string, unknown>): unknown => ({
      version: 1,
      sessions: [
        { id: 's1', name: 'n', cwd: 'C:/p', groupId: null, statusId: null, order: 0, createdAt: 1, claudeArgs: [], ...session }
      ],
      groups: [], statuses: [], groupOrder: []
    })
    expect(() => parseStoreData(make({ agent: 'gpt' }))).toThrow('agent')
    expect(() => parseStoreData(make({ agent: 'opencode', opencodeSessionId: 'nope' }))).toThrow('opencodeSessionId')
    expect(() => parseStoreData(make({ agent: 'opencode', model: 'bad model&' }))).toThrow('model')
  })
})

describe('settings: agents section', () => {
  it('defaults are valid and applied when absent', () => {
    expect(settingsProblem(DEFAULT_APP_SETTINGS)).toBeNull()
    const parsed = parseStoredSettings({}, [])
    expect(parsed?.agents).toEqual(DEFAULT_APP_SETTINGS.agents)
  })

  it('a stored agents section is accepted and kept', () => {
    const parsed = parseStoredSettings(
      { agents: { defaultAgent: 'opencode', opencodeModel: 'opencode/deepseek-v4.1-flash-free' } },
      []
    )
    expect(parsed?.agents).toEqual({ defaultAgent: 'opencode', opencodeModel: 'opencode/deepseek-v4.1-flash-free' })
  })

  it('wrong types are dropped', () => {
    expect(parseStoredSettings({ agents: { defaultAgent: 'gpt' } }, [])).toBeUndefined()
    expect(parseStoredSettings({ agents: { opencodeModel: 5 } }, [])).toBeUndefined()
    expect(parseStoredSettings({ agents: { opencodeModel: 'a b' } }, [])).toBeUndefined()
    expect(parseStoredSettings({ agents: { opencodeModel: 'x'.repeat(201) } }, [])).toBeUndefined()
  })

  it('an empty opencodeModel is the OpenCode default and allowed', () => {
    const parsed = parseStoredSettings({ agents: { opencodeModel: '' } }, [])
    expect(parsed?.agents).toEqual({ defaultAgent: 'claude', opencodeModel: '' })
  })

  it('updateSettings merges the agents section like the others', () => {
    const next = updateSettings(baseData(), { agents: { defaultAgent: 'opencode' } })
    expect(next.settings?.agents).toEqual({ defaultAgent: 'opencode', opencodeModel: '' })
    const second = updateSettings(next, { agents: { opencodeModel: 'p/m' } })
    expect(second.settings?.agents).toEqual({ defaultAgent: 'opencode', opencodeModel: 'p/m' })
  })

  it('an invalid agents patch throws without changing anything', () => {
    const before = JSON.stringify(baseData())
    expect(() => updateSettings(baseData(), { agents: { defaultAgent: 'gpt' } as never })).toThrow('Invalid settings: agents.defaultAgent')
    expect(() => updateSettings(baseData(), { agents: { opencodeModel: 'x'.repeat(201) } })).toThrow('Invalid settings: agents.opencodeModel')
    expect(JSON.stringify(baseData())).toBe(before)
  })
})
