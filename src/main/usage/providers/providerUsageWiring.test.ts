import { describe, it, expect } from 'vitest'
import type { Session } from '../../../shared/types'
import { wantedProviders } from './providerUsageWiring'

function session(partial: Partial<Session>): Session {
  return { id: 's', name: 'n', cwd: 'C:/x', agent: 'claude', createdAt: 0, ...partial } as Session
}

describe('wantedProviders', () => {
  it('wants nothing without sessions or when the setting is off', () => {
    expect(wantedProviders([], true).size).toBe(0)
    expect(wantedProviders([session({ agent: 'cursor' })], false).size).toBe(0)
  })

  it('maps a Cursor session and the shell sessions of codex, kimi and grok', () => {
    const wanted = wantedProviders(
      [
        session({ id: 'a', agent: 'cursor' }),
        session({ id: 'b', agent: 'shell', cliAgent: 'codex' }),
        session({ id: 'c', agent: 'shell', cliAgent: 'kimi' }),
        session({ id: 'd', agent: 'shell', cliAgent: 'grok' })
      ],
      true
    )
    expect([...wanted].sort()).toEqual(['codex', 'cursor', 'grok', 'kimi'])
  })

  it('ignores closed sessions, other agents, plain shells and CLI agents without a quota provider', () => {
    const wanted = wantedProviders(
      [
        session({ id: 'a', agent: 'cursor', closedAt: 5 }),
        session({ id: 'b', agent: 'claude' }),
        session({ id: 'c', agent: 'opencode' }),
        session({ id: 'd', agent: 'shell' }),
        session({ id: 'e', agent: 'shell', cliAgent: 'amp' })
      ],
      true
    )
    expect(wanted.size).toBe(0)
  })
})

import { redirectedUrl } from './providerUsageDeps'

describe('redirectedUrl (e2e seam)', () => {
  it('keeps the URL unless a loopback origin is set', () => {
    const url = 'https://chatgpt.com/backend-api/wham/usage?x=1'
    expect(redirectedUrl(url, undefined)).toBe(url)
    expect(redirectedUrl(url, 'https://evil.example')).toBe(url)
    expect(redirectedUrl(url, 'http://evil.example:80')).toBe(url)
    expect(redirectedUrl(url, 'http://127.0.0.1:5555')).toBe('http://127.0.0.1:5555/backend-api/wham/usage?x=1')
    expect(redirectedUrl(url, 'http://localhost:9')).toBe('http://localhost:9/backend-api/wham/usage?x=1')
  })
})
