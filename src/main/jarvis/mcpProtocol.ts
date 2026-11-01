// The small part of the Model Context Protocol that Jarvis needs (D53): initialize, ping, tools/list and tools/call
// over JSON-RPC 2.0. Pure: no HTTP here (see mcpHttpServer.ts), the tools are passed in.
import { errorMessage, isRecord } from '../../shared/guards'

/** Protocol versions this server can speak; an unknown requested version gets the newest one. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const MCP_SERVER_NAME = 'sessiondeck'

export interface McpTool {
  readonly name: string
  readonly description: string
  /** JSON Schema of the arguments object. */
  readonly inputSchema: Readonly<Record<string, unknown>>
  /** The text shown to the model. Throw an Error to report a failed call (its message is shown). */
  readonly run: (args: Readonly<Record<string, unknown>>) => Promise<string>
}

type JsonRpcId = string | number

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0'
  readonly id: JsonRpcId | null
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

function failure(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function requestId(value: unknown): JsonRpcId | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

/**
 * Answers one JSON-RPC message. Returns null for a notification (no id), which gets no response.
 * A tool that throws gives a normal result with `isError: true`, as MCP asks, so the model sees the message.
 */
export async function handleMcpMessage(message: unknown, tools: readonly McpTool[], version = '0.0.0'): Promise<JsonRpcResponse | null> {
  if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return failure(requestId(isRecord(message) ? message.id : undefined) ?? null, INVALID_REQUEST, 'Invalid request')
  }
  const id = requestId(message.id)
  if (id === undefined) return null // notifications/initialized, notifications/cancelled, ...
  const params = isRecord(message.params) ? message.params : {}

  switch (message.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0]
      return success(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version }
      })
    }
    case 'ping':
      return success(id, {})
    case 'tools/list':
      return success(id, {
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
      })
    case 'tools/call': {
      const tool = tools.find((candidate) => candidate.name === params.name)
      if (tool === undefined) return failure(id, INVALID_PARAMS, `Unknown tool: ${String(params.name)}`)
      const args = isRecord(params.arguments) ? params.arguments : {}
      try {
        const text = await tool.run(args)
        return success(id, { content: [{ type: 'text', text }] })
      } catch (error) {
        return success(id, { content: [{ type: 'text', text: errorMessage(error) }], isError: true })
      }
    }
    default:
      return failure(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`)
  }
}

/** Answers a request body: one message or a batch. Null = nothing to send back (only notifications). */
export async function handleMcpBody(body: string, tools: readonly McpTool[], version?: string): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return failure(null, PARSE_ERROR, 'Parse error')
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return failure(null, INVALID_REQUEST, 'Empty batch')
    const answers: JsonRpcResponse[] = []
    for (const item of parsed) {
      const answer = await handleMcpMessage(item, tools, version)
      if (answer !== null) answers.push(answer)
    }
    return answers.length === 0 ? null : answers
  }
  return handleMcpMessage(parsed, tools, version)
}
