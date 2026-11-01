import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { JARVIS_SYSTEM_PROMPT, jarvisLaunchArgs, jarvisPaths, mcpConfigText } from './jarvisLaunch'

describe('jarvis launch', () => {
  const paths = jarvisPaths('C:/data')

  it('keeps every Jarvis file in <userData>/jarvis', () => {
    expect(paths).toEqual({
      dir: join('C:/data', 'jarvis'),
      mcpConfig: join('C:/data', 'jarvis', 'mcp.json'),
      prompt: join('C:/data', 'jarvis', 'system-prompt.md'),
      log: join('C:/data', 'jarvis', 'actions.log')
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

  it('names the tools in the system prompt', () => {
    for (const tool of ['list_sessions', 'send_prompt', 'wake_session', 'remove_session']) expect(JARVIS_SYSTEM_PROMPT).toContain(tool)
  })
})
