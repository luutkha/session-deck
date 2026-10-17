import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { HookEvent } from '../../shared/types'
import { isOpencodeSessionId } from '../opencode/values'

export interface HookServer {
  start(): Promise<{ port: number }>
  stop(): Promise<void>
}

export interface CreateHookServerOptions {
  readonly token: string
  readonly isKnownSession: (id: string) => boolean
  readonly onEvent: (event: HookEvent) => void
  /** Called with the parsed statusLine JSON object of a known session. */
  readonly onStatusLine?: (sessionId: string, payload: unknown) => void
  /** Called with the parsed JSON payload of an OpenCode worker plugin event for a known Claude session. Returns false to reject it (HTTP 400). */
  readonly onWorkerEvent?: (sessionId: string, payload: unknown) => boolean
}

const MAX_BODY_SIZE = 4096
const MAX_STATUSLINE_BODY_SIZE = 65536
const MAX_HOOK_BODY_SIZE = 65536
const MAX_HOOK_MESSAGE_LENGTH = 300
const STATUSLINE_PATH_RE = /^\/statusline\/([^/?#]+)$/
const HOOK_PATH_RE = /^\/hook\/([^/?#]+)\/([^/?#]+)$/
const WORKER_PATH_RE = /^\/worker\/([^/?#]+)\/event$/
const MAX_WORKER_BODY_SIZE = 32768

/** Claude Code hook events forwarded to the app (route: POST /hook/<sessionId>/<Event>). */
export const HOOK_EVENT_NAMES = ['Notification', 'Stop', 'UserPromptSubmit'] as const
export type HookEventName = (typeof HOOK_EVENT_NAMES)[number]

/** Event names the /hook routes additionally accept: 'AgentSession' comes from the OpenCode plugin, not Claude. */
export const AGENT_SESSION_EVENT = 'AgentSession'
export const ROUTE_EVENT_NAMES = ['Notification', 'Stop', 'UserPromptSubmit', AGENT_SESSION_EVENT] as const
export type RouteEventName = typeof ROUTE_EVENT_NAMES[number]

function isHookEventName(value: unknown): value is RouteEventName {
  return typeof value === 'string' && (ROUTE_EVENT_NAMES as readonly string[]).includes(value)
}

interface HookRoute {
  readonly rawSessionId: string
  readonly rawEvent: string
}

/** Route parts of `/hook/<sessionId>/<Event>`, or null when the path has another shape. */
function hookRoute(url: string | undefined): HookRoute | null {
  const match = url ? HOOK_PATH_RE.exec(url) : null
  if (!match) return null
  return { rawSessionId: match[1], rawEvent: match[2] }
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/**
 * Message of a hook body. The body is optional: empty or invalid JSON, or a body without a string `message`,
 * yields undefined. The message is trimmed and capped at MAX_HOOK_MESSAGE_LENGTH.
 */
function messageFromHookBody(body: string): string | undefined {
  if (body.trim().length === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isJsonObject(parsed) || typeof parsed.message !== 'string') return undefined
  const trimmed = parsed.message.trim()
  return trimmed.length === 0 ? undefined : trimmed.slice(0, MAX_HOOK_MESSAGE_LENGTH)
}

/**
 * The `session_id` an AgentSession payload must carry (an OpenCode session id). Returns undefined when the body
 * is empty, invalid JSON, not an object, or the id does not match the expected shape.
 */
function agentSessionIdFromBody(body: string): string | undefined {
  if (body.trim().length === 0) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isJsonObject(parsed) || !isOpencodeSessionId(parsed.session_id)) return undefined
  return parsed.session_id
}

function parseBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    let received = 0

    req.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > limit) {
        reject(new Error('Body too large'))
        return
      }
      data += chunk.toString('utf8')
    })

    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendResponse(res: ServerResponse, statusCode: number, body?: string): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json')
  res.end(body ?? '')
}

function validateToken(token: string, provided: string | undefined): boolean {
  if (!provided) return false
  try {
    const tokenBuf = Buffer.from(token, 'utf8')
    const providedBuf = Buffer.from(provided, 'utf8')
    if (tokenBuf.length !== providedBuf.length) return false
    return timingSafeEqual(tokenBuf, providedBuf)
  } catch {
    return false
  }
}

/** Session id from `/statusline/<id>`, or null when the path has another shape. */
function statusLineSessionId(url: string | undefined): string | null {
  const match = url ? STATUSLINE_PATH_RE.exec(url) : null
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createHookServer(options: CreateHookServerOptions): HookServer {
  const { token, isKnownSession, onEvent, onStatusLine, onWorkerEvent } = options
  let server: Server | null = null
  const sockets = new Set<import('node:net').Socket>()

  function trackSocket(socket: import('node:net').Socket): void {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  }

  const handleStatusLine = async (req: IncomingMessage, res: ServerResponse, sessionId: string): Promise<void> => {
    const providedToken = req.headers['x-token'] as string | undefined
    if (!validateToken(token, providedToken)) {
      sendResponse(res, 401, JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    let body: string
    try {
      body = await parseBody(req, MAX_STATUSLINE_BODY_SIZE)
    } catch {
      sendResponse(res, 413, JSON.stringify({ error: 'Payload too large' }))
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      sendResponse(res, 400, JSON.stringify({ error: 'Invalid JSON' }))
      return
    }
    if (!isJsonObject(payload)) {
      sendResponse(res, 400, JSON.stringify({ error: 'Expected a JSON object' }))
      return
    }

    if (!isKnownSession(sessionId)) {
      sendResponse(res, 404, JSON.stringify({ error: 'Unknown session' }))
      return
    }

    onStatusLine?.(sessionId, payload)
    sendResponse(res, 204)
  }

  /** POST /worker/<claudeSessionId>/event: one event from the OpenCode worker plugin of a process started in that session. */
  const handleWorkerRoute = async (req: IncomingMessage, res: ServerResponse, rawSessionId: string): Promise<void> => {
    if (!validateToken(token, req.headers['x-token'] as string | undefined)) {
      sendResponse(res, 401, JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    let body: string
    try {
      body = await parseBody(req, MAX_WORKER_BODY_SIZE)
    } catch {
      sendResponse(res, 413, JSON.stringify({ error: 'Payload too large' }))
      return
    }
    const sessionId = decodeSegment(rawSessionId)
    if (sessionId === null || !isKnownSession(sessionId)) {
      sendResponse(res, 404, JSON.stringify({ error: 'Unknown session' }))
      return
    }
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      sendResponse(res, 400, JSON.stringify({ error: 'Invalid JSON' }))
      return
    }
    if (onWorkerEvent === undefined || !onWorkerEvent(sessionId, payload)) {
      sendResponse(res, 400, JSON.stringify({ error: 'Invalid worker event' }))
      return
    }
    sendResponse(res, 204)
  }

  /** POST /hook/<sessionId>/<Event>: the body is the raw Claude Code hook payload (optional JSON). */
  const handleHookRoute = async (req: IncomingMessage, res: ServerResponse, route: HookRoute): Promise<void> => {
    if (!isHookEventName(route.rawEvent)) {
      sendResponse(res, 404, JSON.stringify({ error: 'Not found' }))
      return
    }
    const event = route.rawEvent

    const providedToken = req.headers['x-token'] as string | undefined
    if (!validateToken(token, providedToken)) {
      sendResponse(res, 401, JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    let body: string
    try {
      body = await parseBody(req, MAX_HOOK_BODY_SIZE)
    } catch {
      sendResponse(res, 413, JSON.stringify({ error: 'Payload too large' }))
      return
    }

    const sessionId = decodeSegment(route.rawSessionId)
    if (sessionId === null || !isKnownSession(sessionId)) {
      sendResponse(res, 404, JSON.stringify({ error: 'Unknown session' }))
      return
    }

    const message =
      event === AGENT_SESSION_EVENT
        ? agentSessionIdFromBody(body)
        : messageFromHookBody(body)
    if (event === AGENT_SESSION_EVENT && message === undefined) {
      sendResponse(
        res,
        400,
        JSON.stringify({ error: 'Invalid AgentSession payload: expected session_id ses_[A-Za-z0-9]{8,64}' })
      )
      return
    }
    onEvent({ sessionId, event, ...(message !== undefined ? { message } : {}) })
    sendResponse(res, 204)
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      sendResponse(res, 405, JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    const statusSessionId = statusLineSessionId(req.url)
    if (statusSessionId !== null) {
      await handleStatusLine(req, res, statusSessionId)
      return
    }

    const workerMatch = req.url ? WORKER_PATH_RE.exec(req.url) : null
    if (workerMatch !== null) {
      await handleWorkerRoute(req, res, workerMatch[1])
      return
    }

    const route = hookRoute(req.url)
    if (route !== null) {
      await handleHookRoute(req, res, route)
      return
    }

    if (req.url !== '/hook') {
      sendResponse(res, 404, JSON.stringify({ error: 'Not found' }))
      return
    }

    const providedToken = req.headers['x-token'] as string | undefined
    if (!validateToken(token, providedToken)) {
      sendResponse(res, 401, JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    let body: string
    try {
      body = await parseBody(req, MAX_BODY_SIZE)
    } catch {
      sendResponse(res, 413, JSON.stringify({ error: 'Payload too large' }))
      return
    }

    let event: HookEvent
    try {
      const parsed = JSON.parse(body)
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof parsed.sessionId !== 'string' ||
        !isHookEventName(parsed.event)
      ) {
        throw new Error('Invalid shape')
      }
      event = {
        sessionId: parsed.sessionId,
        event: parsed.event,
        message: typeof parsed.message === 'string' ? parsed.message : undefined
      }
    } catch {
      sendResponse(res, 400, JSON.stringify({ error: 'Invalid JSON' }))
      return
    }

    if (!isKnownSession(event.sessionId)) {
      sendResponse(res, 404, JSON.stringify({ error: 'Unknown session' }))
      return
    }

    onEvent(event)
    sendResponse(res, 204)
  }

  return {
    start(): Promise<{ port: number }> {
      return new Promise((resolve, reject) => {
        server = createServer()
        server.on('connection', trackSocket)

        server.on('request', handler)

        server.listen(0, '127.0.0.1', () => {
          const address = server!.address()
          if (address && typeof address === 'object') {
            resolve({ port: address.port })
          } else {
            reject(new Error('Failed to get server address'))
          }
        })

        server.on('error', reject)
      })
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        if (!server) {
          resolve()
          return
        }

        for (const socket of sockets) {
          socket.destroy()
        }
        sockets.clear()

        server.close((err) => {
          server = null
          if (err) {
            console.error('HookServer stop error:', err)
          }
          resolve()
        })
      })
    }
  }
}