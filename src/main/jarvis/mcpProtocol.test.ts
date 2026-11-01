import { describe, expect, it } from 'vitest'
import { handleMcpBody, handleMcpMessage, MCP_PROTOCOL_VERSIONS, type McpTool } from './mcpProtocol'

const echo: McpTool = {
  name: 'echo',
  description: 'Echoes',
  inputSchema: { type: 'object' },
  run: async (args) => `got ${String(args.text)}`
}
const broken: McpTool = { ...echo, name: 'broken', run: async () => { throw new Error('nope') } }
const tools = [echo, broken]

describe('handleMcpMessage', () => {
  it('answers initialize with the asked version when known, else the newest', async () => {
    const known = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, tools, '1.2.3')
    expect(known?.result).toEqual({ protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'sessiondeck', version: '1.2.3' } })
    const unknown = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, tools)
    expect((unknown?.result as { protocolVersion: string }).protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0])
  })

  it('gives no response to a notification', async () => {
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, tools)).toBeNull()
  })

  it('lists the tools with their schemas', async () => {
    const answer = await handleMcpMessage({ jsonrpc: '2.0', id: 'a', method: 'tools/list' }, tools)
    expect(answer?.result).toEqual({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
  })

  it('runs a tool; a throwing tool is a result with isError, not a protocol error', async () => {
    const ok = await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } }, tools)
    expect(ok?.result).toEqual({ content: [{ type: 'text', text: 'got hi' }] })
    const failed = await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'broken' } }, tools)
    expect(failed?.result).toEqual({ content: [{ type: 'text', text: 'nope' }], isError: true })
  })

  it('reports an unknown tool, an unknown method and an invalid request', async () => {
    expect((await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'x' } }, tools))?.error?.code).toBe(-32602)
    expect((await handleMcpMessage({ jsonrpc: '2.0', id: 6, method: 'resources/list' }, tools))?.error?.code).toBe(-32601)
    expect((await handleMcpMessage({ id: 7, method: 'ping' }, tools))?.error?.code).toBe(-32600)
  })
})

describe('handleMcpBody', () => {
  it('answers a batch, leaving out notifications', async () => {
    const answer = await handleMcpBody(JSON.stringify([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 1, method: 'ping' }
    ]), tools)
    expect(answer).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }])
  })

  it('returns null for notifications only and a parse error for bad JSON', async () => {
    expect(await handleMcpBody(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled' }), tools)).toBeNull()
    expect(await handleMcpBody('{nope', tools)).toMatchObject({ error: { code: -32700 } })
  })
})
