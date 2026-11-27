import { describe, expect, it } from 'vitest'
import { CLI_AGENTS, cliAgentById, cliLaunchArgs, isCliAgentId } from './cliAgents'

describe('CLI agent registry', () => {
  it('has a full, uniquely identified list of extra agents', () => {
    expect(CLI_AGENTS.length).toBeGreaterThanOrEqual(35)
    const ids = CLI_AGENTS.map((def) => def.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id, id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    }
  })

  it('gives every agent a unique 2-3 letter badge that never collides with the native agents', () => {
    const badges = CLI_AGENTS.map((def) => def.badge)
    expect(new Set(badges).size).toBe(badges.length)
    for (const badge of badges) {
      expect(badge, badge).toMatch(/^[A-Z]{2,3}$/)
      expect(badge).not.toBe('OC')
      expect(badge).not.toBe('CU')
    }
  })

  it('uses one executable name per launch command', () => {
    for (const def of CLI_AGENTS) {
      expect(def.command, def.id).not.toMatch(/\s/)
      expect(def.command.length, def.id).toBeGreaterThan(0)
    }
  })

  it('excludes agents SessionDeck launches natively', () => {
    const ids = CLI_AGENTS.map((def) => def.id)
    for (const native of ['claude', 'cursor', 'opencode', 'opencode2', 'shell']) {
      expect(ids).not.toContain(native)
    }
  })

  it('joins fixed launch arguments and yolo arguments in that order', () => {
    for (const def of CLI_AGENTS) {
      expect(cliLaunchArgs(def), def.id).toEqual([...def.args, ...def.yoloArgs])
    }
    expect(cliLaunchArgs(cliAgentById('kiro')!)).toEqual(['chat', '--tui', '--trust-all-tools'])
    expect(cliLaunchArgs(cliAgentById('goose')!)).toEqual([])
  })

  it('copies Codex, Goose and Kiro launch details from Orca', () => {
    expect(cliAgentById('codex')?.yoloArgs).toEqual([
      '--dangerously-bypass-approvals-and-sandbox'
    ])
    expect(cliAgentById('goose')?.yoloEnv).toEqual({ GOOSE_MODE: 'auto' })
    expect(cliAgentById('kiro')?.command).toBe('kiro-cli')
  })

  it('looks ids up by name and rejects unknown ids', () => {
    expect(cliAgentById('codex')?.label).toBe('Codex')
    expect(cliAgentById('unknown')).toBeUndefined()
    expect(cliAgentById(undefined)).toBeUndefined()
    expect(isCliAgentId('opencode')).toBe(false)
    expect(isCliAgentId('claude')).toBe(false)
    expect(isCliAgentId(42)).toBe(false)
    expect(isCliAgentId(undefined)).toBe(false)
    expect(isCliAgentId('copilot')).toBe(true)
    const id: unknown = 'droid'
    if (isCliAgentId(id)) {
      expect(cliAgentById(id)?.label).toBe('Droid')
    }
  })
})
