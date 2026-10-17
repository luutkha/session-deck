/**
 * The per-process SessionDeck plugin for OpenCode, as ESM JavaScript source.
 *
 * OpenCode loads it through OPENCODE_CONFIG_CONTENT ("plugin": ["file:///<path>.mjs"], see pluginEnv.ts) so no file
 * is placed into the user's project or global config. The source is a string here so the app can write it next to
 * the Claude settings file at startup, and tests can write + `import()` it with a fake `fetch` and process.env.
 *
 * Behaviour (Post bodies match the Claude hook contract; header `x-token: <SESSIONDECK_TOKEN>`):
 * - session.created of a top-level session -> POST /hook/<id>/AgentSession {"session_id": "..."} (sub-agent
 *   sessions, whose info.parentID is set, are ignored).
 * - session.status type "busy" (only on the non-busy -> busy transition) -> POST /hook/<id>/UserPromptSubmit.
 * - session.idle -> POST /hook/<id>/Stop.
 * - permission.asked / question.asked (and tool.execute.before for the "question" tool) -> POST /hook/<id>/Notification.
 * - message.updated of assistant messages -> per-message cost tracking and a throttled (>= 1 s apart) POST
 *   /statusline/<id> {"model":{"display_name": ...},"cost":{"total_cost_usd": <sum>}}.
 *
 * The handler must NEVER throw and NEVER block (fire-and-forget fetch with a 2 s timeout, every error swallowed
 * because the app may already be gone) and does nothing when SESSIONDECK_PORT is missing.
 */
export const PLUGIN_FILE_NAME = 'sessiondeck-opencode-plugin.mjs'

/** Max characters of a Notification message the plugin sends. */
export const MAX_PLUGIN_NOTICE_LENGTH = 200

/** Minimum seconds between two /statusline POSTs for one session. */
export const PLUGIN_USAGE_THROTTLE_MS = 1000

/** Fetch timeout for every plugin request (the app may be gone; never hang). */
export const PLUGIN_FETCH_TIMEOUT_MS = 2000

export function buildOpencodePluginSource(): string {
  return `export const SessionDeckPlugin = async () => {
  var port = process.env.SESSIONDECK_PORT
  var sessionId = process.env.SESSIONDECK_SESSION_ID
  var token = process.env.SESSIONDECK_TOKEN
  if (!port || !sessionId || !token) return {}
  var base = 'http://127.0.0.1:' + port
  var costByMessage = new Map()
  var lastUsagePost = 0
  var lastBusy = false

  function post(path, body) {
    try {
      var init = {
        method: 'POST',
        headers: { 'x-token': token, 'content-type': 'application/json' },
        body: JSON.stringify(body === undefined ? {} : body),
        signal: AbortSignal.timeout(2000)
      }
      var pending = fetch(base + path, init)
      if (pending && typeof pending.catch === 'function') pending.catch(function () {})
    } catch (error) {}
  }

  function postHook(event, body) {
    post('/hook/' + encodeURIComponent(sessionId) + '/' + event, body)
  }

  function clampText(text) {
    var trimmed = String(text).trim()
    if (trimmed.length === 0) return ''
    if (trimmed.length > ${MAX_PLUGIN_NOTICE_LENGTH}) return trimmed.slice(0, ${MAX_PLUGIN_NOTICE_LENGTH})
    return trimmed
  }

  function permissionText(props) {
    var tool = null
    if (typeof props.permission === 'string' && props.permission.trim().length > 0) tool = props.permission.trim()
    else if (typeof props.question === 'string' && props.question.trim().length > 0) tool = props.question.trim()
    else if (typeof props.title === 'string' && props.title.trim().length > 0) tool = props.title.trim()
    else if (typeof props.tool === 'string' && props.tool.trim().length > 0) tool = props.tool.trim()

    var detail = null
    var meta = props.metadata
    if (meta && typeof meta.command === 'string' && meta.command.trim().length > 0) detail = meta.command.trim()
    else if (typeof props.pattern === 'string' && props.pattern.trim().length > 0) detail = props.pattern.trim()

    var text = 'Permission needed'
    if (tool !== null && detail !== null) text = 'Permission needed: ' + tool + ' (' + detail + ')'
    else if (tool !== null) text = 'Permission needed: ' + tool
    else if (detail !== null) text = 'Permission needed: ' + detail
    return clampText(text)
  }

  function syncUsage(modelId) {
    try {
      var now = Date.now()
      if (now - lastUsagePost < ${PLUGIN_USAGE_THROTTLE_MS}) return
      lastUsagePost = now
      var total = 0
      costByMessage.forEach(function (value) { total += value })
      var body = { cost: { total_cost_usd: total } }
      if (typeof modelId === 'string' && modelId.length > 0) body.model = { display_name: modelId }
      post('/statusline/' + encodeURIComponent(sessionId), body)
    } catch (error) {}
  }

  function handleAssistantMessageUpdated(props) {
    try {
      var info = props.info
      if (!info || typeof info !== 'object' || info.role !== 'assistant') return
      if (
        typeof info.id === 'string' && info.id.length > 0 &&
        typeof info.cost === 'number' && Number.isFinite(info.cost) && info.cost >= 0
      ) {
        costByMessage.set(info.id, info.cost)
        syncUsage(typeof info.modelID === 'string' ? info.modelID : null)
      }
    } catch (error) {}
  }

  return {
    event: async function (context) {
      try {
        var event = context && context.event
        if (!event || typeof event.type !== 'string') return
        var props = (event.properties && typeof event.properties === 'object') ? event.properties : {}
        if (event.type === 'session.created') {
          var info = props.info
          if (info && typeof info === 'object' && typeof info.parentID === 'string' && info.parentID.length > 0) return
          var agentSessionId = null
          if (info && typeof info === 'object' && typeof info.id === 'string' && info.id.length > 0) agentSessionId = info.id
          else if (typeof props.sessionID === 'string' && props.sessionID.length > 0) agentSessionId = props.sessionID
          if (agentSessionId !== null) postHook('AgentSession', { session_id: agentSessionId })
        } else if (event.type === 'session.status') {
          var status = props.status
          var busy = !!(status && typeof status === 'object' && status.type === 'busy')
          if (busy && !lastBusy) postHook('UserPromptSubmit')
          lastBusy = busy
        } else if (event.type === 'session.idle') {
          postHook('Stop')
          lastBusy = false
        } else if (event.type === 'permission.asked' || event.type === 'question.asked') {
          postHook('Notification', { message: permissionText(props) })
        } else if (event.type === 'tool.execute.before') {
          if (props.tool === 'question') postHook('Notification', { message: permissionText(props) })
        } else if (event.type === 'message.updated') {
          handleAssistantMessageUpdated(props)
        }
      } catch (error) {}
    }
  }
}
`
}
