// Jarvis's MCP endpoint (D53): POST /mcp on 127.0.0.1 (random port), "Authorization: Bearer <token>" required.
// Streamable HTTP without the optional event stream: every request is answered with plain JSON, GET gets 405.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import { handleMcpBody, type McpTool } from './mcpProtocol'

export const MCP_PATH = '/mcp'
const MAX_BODY_BYTES = 1024 * 1024

export interface McpHttpServer {
  start(): Promise<{ readonly port: number }>
  stop(): Promise<void>
}

export interface McpHttpServerOptions {
  readonly token: string
  readonly tools: () => readonly McpTool[]
  readonly version?: string
}

function sameToken(expected: string, header: string | undefined): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice('Bearer '.length), 'utf8')
  const wanted = Buffer.from(expected, 'utf8')
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (res.writableEnded) return
  res.statusCode = status
  if (body === undefined) {
    res.end()
    return
  }
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.removeAllListeners('data')
        req.resume()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

export function createMcpHttpServer(options: McpHttpServerOptions): McpHttpServer {
  let server: Server | null = null
  const sockets = new Set<Socket>()

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    if (path !== MCP_PATH) return send(res, 404, { error: 'Not found' })
    if (!sameToken(options.token, req.headers.authorization)) return send(res, 401, { error: 'Unauthorized' })
    // No server-to-client stream and no session to end: the client falls back to plain request/response.
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST')
      return send(res, 405, { error: 'Method not allowed' })
    }
    const body = await readBody(req)
    if (body === null) return send(res, 413, { error: 'Payload too large' })
    const answer = await handleMcpBody(body, options.tools(), options.version)
    if (answer === null) return send(res, 202)
    send(res, 200, answer)
  }

  return {
    start(): Promise<{ readonly port: number }> {
      return new Promise((resolve, reject) => {
        const created = createServer((req, res) => {
          handle(req, res).catch(() => send(res, 500, { error: 'Internal error' }))
        })
        created.on('connection', (socket: Socket) => {
          sockets.add(socket)
          socket.on('close', () => sockets.delete(socket))
        })
        created.once('error', reject)
        created.listen(0, '127.0.0.1', () => {
          const address = created.address()
          if (address === null || typeof address === 'string') {
            reject(new Error('MCP server has no port'))
            return
          }
          server = created
          resolve({ port: address.port })
        })
      })
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        const current = server
        server = null
        if (current === null) {
          resolve()
          return
        }
        for (const socket of sockets) socket.destroy()
        sockets.clear()
        current.close(() => resolve())
      })
    }
  }
}
