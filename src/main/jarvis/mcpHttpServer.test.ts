import { afterEach, describe, expect, it } from 'vitest'
import { createMcpHttpServer, type McpHttpServer } from './mcpHttpServer'

const TOKEN = 'secret-token'
let server: McpHttpServer | null = null

async function start(): Promise<string> {
  server = createMcpHttpServer({
    token: TOKEN,
    tools: () => [{ name: 'hello', description: 'Says hello', inputSchema: { type: 'object' }, run: async () => 'hello!' }]
  })
  const { port } = await server.start()
  return `http://127.0.0.1:${port}`
}

function post(url: string, body: unknown, token: string | null = TOKEN): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token !== null ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })
}

afterEach(async () => {
  await server?.stop()
  server = null
})

describe('createMcpHttpServer', () => {
  it('answers a tools/call with JSON on POST /mcp', async () => {
    const base = await start()
    const response = await post(`${base}/mcp`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'hello' } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'hello!' }] } })
  })

  it('accepts a notification with 202 and no body', async () => {
    const base = await start()
    const response = await post(`${base}/mcp`, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('rejects a missing or wrong token, GET, and other paths', async () => {
    const base = await start()
    expect((await post(`${base}/mcp`, {}, null)).status).toBe(401)
    expect((await post(`${base}/mcp`, {}, 'wrong-token!')).status).toBe(401)
    expect((await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(405)
    expect((await post(`${base}/other`, {})).status).toBe(404)
  })
})
