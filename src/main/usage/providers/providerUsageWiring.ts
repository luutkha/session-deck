// Connects the provider quota poller to the app (D96): which agents have an open session decides which providers are
// polled, the results go to UsageService, and the "Show Codex, Cursor, Kimi and Grok usage" setting is the master switch.
import type { Session } from '../../../shared/types'
import type { SessionStore } from '../../store'
import type { UsageService } from '../UsageService'
import { fetchCodexUsage } from './codexUsage'
import { fetchCursorUsage } from './cursorUsage'
import { fetchGrokUsage } from './grokUsage'
import { fetchKimiUsage } from './kimiUsage'
import { createProviderUsageDeps } from './providerUsageDeps'
import { createProviderUsagePoller, type ProviderUsagePoller } from './providerUsagePoller'
import type { PolledProvider } from './providerUsageTypes'

/** CLI-agent ids (src/shared/cliAgents.ts) that have a quota provider. */
const CLI_AGENT_PROVIDERS: Readonly<Record<string, PolledProvider>> = { codex: 'codex', kimi: 'kimi', grok: 'grok' }

/**
 * Providers that currently deserve a poll: an OPEN session of that agent exists. Cursor is its own agent kind; the
 * others are shell sessions that carry a cliAgent id. A disabled setting means none.
 */
export function wantedProviders(sessions: readonly Session[], enabled: boolean): ReadonlySet<PolledProvider> {
  const wanted = new Set<PolledProvider>()
  if (!enabled) return wanted
  for (const session of sessions) {
    if (session.closedAt !== undefined) continue
    if (session.agent === 'cursor') wanted.add('cursor')
    else if (session.agent === 'shell' && typeof session.cliAgent === 'string') {
      const provider = CLI_AGENT_PROVIDERS[session.cliAgent]
      if (provider !== undefined) wanted.add(provider)
    }
  }
  return wanted
}

export interface ProviderUsageWiring {
  readonly poller: ProviderUsagePoller
  /** Stops polling and unsubscribes. */
  stop(): void
}

export function wireProviderUsage(
  store: SessionStore,
  usage: UsageService,
  onError: (where: string, error: unknown) => void
): ProviderUsageWiring {
  const enabled = (): boolean => store.getSettings().quota.showAgentUsage ?? true
  const poller = createProviderUsagePoller({
    fetchers: { codex: fetchCodexUsage, cursor: fetchCursorUsage, kimi: fetchKimiUsage, grok: fetchGrokUsage },
    makeDeps: createProviderUsageDeps,
    ingest: (provider, windows) => usage.ingestProviderAccount(provider, windows),
    wanted: () => wantedProviders(store.get().sessions, enabled()),
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    onError
  })
  let previous: ReadonlySet<PolledProvider> = new Set()
  const apply = (): void => {
    try {
      usage.setAgentUsageEnabled(enabled())
      poller.refreshWanted()
      // A bar belongs to a running agent: when the last open session of one goes away its bar goes too.
      const current = wantedProviders(store.get().sessions, enabled())
      for (const provider of previous) {
        if (!current.has(provider)) usage.ingestProviderAccount(provider, null)
      }
      previous = current
    } catch (error) {
      onError('provider usage', error)
    }
  }
  apply()
  const unsubscribe = store.subscribe(apply)
  return {
    poller,
    stop: () => {
      unsubscribe()
      poller.stop()
    }
  }
}
