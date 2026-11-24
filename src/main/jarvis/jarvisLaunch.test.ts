import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { jarvisLaunchArgs, jarvisOpencodeConfig, jarvisSystemPrompt, jarvisPaths, mcpConfigText } from './jarvisLaunch'

describe('jarvis launch', () => {
  const paths = jarvisPaths('C:/data')

  it('keeps every Jarvis file in <userData>/jarvis', () => {
    expect(paths).toEqual({
      dir: join('C:/data', 'jarvis'),
      mcpConfig: join('C:/data', 'jarvis', 'mcp.json'),
      prompt: join('C:/data', 'jarvis', 'system-prompt.md'),
      log: join('C:/data', 'jarvis', 'actions.log'),
      schedules: join('C:/data', 'jarvis', 'schedules.json')
    })
  })

  it('passes the MCP config, the prompt file and the model; an empty model is left to Claude', () => {
    expect(jarvisLaunchArgs(paths, 'sonnet')).toEqual(['--mcp-config', paths.mcpConfig, '--append-system-prompt-file', paths.prompt, '--model', 'sonnet'])
    expect(jarvisLaunchArgs(paths, '')).toEqual(['--mcp-config', paths.mcpConfig, '--append-system-prompt-file', paths.prompt])
  })

  it('points Claude at the local HTTP server with the bearer token', () => {
    expect(JSON.parse(mcpConfigText(4321, 'tok'))).toEqual({
      mcpServers: { sessiondeck: { type: 'http', url: 'http://127.0.0.1:4321/mcp', headers: { Authorization: 'Bearer tok' } } }
    })
  })

  it('gives OpenCode the same server as a remote MCP entry plus the instructions file (D54)', () => {
    expect(jarvisOpencodeConfig(4321, 'tok', 'C:/data/jarvis/system-prompt.md')).toEqual({
      mcp: { sessiondeck: { type: 'remote', url: 'http://127.0.0.1:4321/mcp', headers: { Authorization: 'Bearer tok' }, enabled: true } },
      instructions: ['C:/data/jarvis/system-prompt.md']
    })
  })

  it('names the tools in the system prompt', () => {
    const prompt = jarvisSystemPrompt(['list_sessions', 'wait_for_session'])
    expect(prompt).toContain('list_sessions, wait_for_session.')
    expect(prompt).toContain('mcp__sessiondeck__')
  })

  it('says the app runs Cursor sessions too (D81)', () => {
    expect(jarvisSystemPrompt([])).toContain('Claude Code, OpenCode, Cursor and shell sessions')
  })
})
