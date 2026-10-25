/**
 * The per-process SessionDeck plugin for OpenCode, as ESM JavaScript source (OpenCode v2 plugin API,
 * verified on v2.1.4).
 *
 * OpenCode v2 loads plugins that are PACKAGE DIRECTORIES exporting one default definition with `id` +
 * `setup` (see writePlugin.ts). The directory is injected through OPENCODE_CONFIG_CONTENT
 * ("plugin": ["C:/.../sessiondeck-opencode-plugin"], see pluginEnv.ts), so nothing is placed into the
 * user's project or global config. In `setup` the plugin subscribes to the event stream
 * (`context.event.subscribe()` — AsyncIterable of `{type, data}` events) and returns a cleanup function
 * that stops its heartbeat/subscription. The source is a string here so the app can write the package at
 * startup, and tests can write + `import()` it with a fake `event.subscribe()` feed, fake `fetch` and env.
 *
 * Behaviour (Post bodies match the Claude hook contract; header `x-token: <SESSIONDECK_TOKEN>`; every body
 * carries `proc`, this process pid, so the app can filter a child worker's events away from its OpenCode
 * owner session):
 * - session.created of a top-level session -> POST /hook/<id>/AgentSession {"session_id": "..."} (sub-agent
 *   sessions, whose data.parentID / info.parentID is set, are ignored).
 * - work start of a session (session.status "busy", or session.execution.started which v2 `run` emits
 *   instead) -> one POST /hook/<id>/UserPromptSubmit per turn.
 * - session end (session.idle, or session.execution.succeeded/failed/interrupted in v2) -> POST
 *   /hook/<id>/Stop. Bookkeeping (one busy transition / one Stop per turn) is shared between all trigger
 *   variants so older and newer OpenCode versions that emit a subset cannot double-announce.
 * - permission.asked / question.asked / question-tool tool start (tool.execute.before in v1,
 *   session.tool.input.started with name "question" in v2) -> POST /hook/<id>/Notification with a short
 *   text of the permission request.
 * - session.usage.updated (v2, per-session totals {cost, tokens}) and message.updated of assistant
 *   messages (v1) -> per-message/session cost tracking and a throttled (>= 1 s apart) POST
 *   /statusline/<id> {"model":{"display_name": ...},"cost":{"total_cost_usd": <cost>}}.
 *
 * The handler must NEVER throw and NEVER block (fire-and-forget fetch with a 2 s timeout, every error swallowed
 * because the app may already be gone) and does nothing when SESSIONDECK_PORT is missing.
 */
/** Directory name of the plugin package (see writePlugin.ts). */
export const PLUGIN_DIR_NAME = 'sessiondeck-opencode-plugin'
/** The v1 layout wrote the plugin as a single .mjs file next to the settings; cleaned up when writing the package. */
export const LEGACY_PLUGIN_FILE_NAME = 'sessiondeck-opencode-plugin.mjs'
/** Version of the generated plugin package.json. */
export const PLUGIN_PACKAGE_VERSION = '1.0.0'

/** Max characters of a Notification message the plugin sends. */
export const MAX_PLUGIN_NOTICE_LENGTH = 200

/** Minimum seconds between two /statusline POSTs for one session. */
export const PLUGIN_USAGE_THROTTLE_MS = 1000

/** Fetch timeout for every plugin request (the app may be gone; never hang). */
export const PLUGIN_FETCH_TIMEOUT_MS = 2000

export function buildOpencodePluginSource(): string {
  return `export default {
  id: 'sessiondeck-app',
  setup: async function (context) {
    var port = process.env.SESSIONDECK_PORT
    var sessionId = process.env.SESSIONDECK_SESSION_ID
    var token = process.env.SESSIONDECK_TOKEN
    if (typeof context === 'undefined' || !context || !context.event || typeof context.event.subscribe !== 'function') return
    if (!port || !sessionId || !token) return
    var base = 'http://127.0.0.1:' + port
    var proc = String(process.pid)
    var work = false
    var stopPosted = false
    var currentModel = ''
    var lastUsagePost = 0
    var stopped = false

    function post(path, body) {
      try {
        var init = {
          method: 'POST',
          headers: { 'x-token': token, 'content-type': 'application/json' },
          body: JSON.stringify(body === undefined ? {} : body),
          signal: AbortSignal.timeout(${PLUGIN_FETCH_TIMEOUT_MS})
        }
        var pending = fetch(base + path, init)
        if (pending && typeof pending.catch === 'function') pending.catch(function () {})
      } catch (error) {}
    }

    function postHook(event, body) {
      // 'proc' tells the app which process reported (the owner vs a child worker, see WorkerHub.ownerProcs).
      var withProc = body === undefined ? {} : Object.assign({}, body)
      withProc.proc = proc
      post('/hook/' + encodeURIComponent(sessionId) + '/' + event, withProc)
    }

    function clampText(text) {
      var trimmed = String(text).trim()
      if (trimmed.length === 0) return ''
      if (trimmed.length > ${MAX_PLUGIN_NOTICE_LENGTH}) return trimmed.slice(0, ${MAX_PLUGIN_NOTICE_LENGTH})
      return trimmed
    }

    function permissionText(data) {
      var tool = null
      if (typeof data.action === 'string' && data.action.trim().length > 0) tool = data.action.trim()
      else if (typeof data.permission === 'string' && data.permission.trim().length > 0) tool = data.permission.trim()
      else if (typeof data.question === 'string' && data.question.trim().length > 0) tool = data.question.trim()
      else if (typeof data.title === 'string' && data.title.trim().length > 0) tool = data.title.trim()
      else if (typeof data.tool === 'string' && data.tool.trim().length > 0) tool = data.tool.trim()

      var detail = null
      var meta = data.metadata
      if (meta && typeof meta.command === 'string' && meta.command.trim().length > 0) detail = meta.command.trim()
      else if (typeof data.pattern === 'string' && data.pattern.trim().length > 0) detail = data.pattern.trim()
      else if (typeof data.message === 'string' && data.message.trim().length > 0) detail = data.message.trim()

      var text = 'Permission needed'
      if (tool !== null && detail !== null) text = 'Permission needed: ' + tool + ' (' + detail + ')'
      else if (tool !== null) text = 'Permission needed: ' + tool
      else if (detail !== null) text = 'Permission needed: ' + detail
      return clampText(text)
    }

    function syncUsage(cost, modelId) {
      try {
        var now = Date.now()
        if (now - lastUsagePost < ${PLUGIN_USAGE_THROTTLE_MS}) return
        lastUsagePost = now
        var body = { cost: { total_cost_usd: cost } }
        if (typeof modelId === 'string' && modelId.length > 0) body.model = { display_name: modelId }
        body.proc = proc
        post('/statusline/' + encodeURIComponent(sessionId), body)
      } catch (error) {}
    }

    function handleEvent(event) {
      try {
        if (!event || typeof event.type !== 'string') return
        // v2 events carry their fields under .data; older layouts under .properties.
        // v2 events carry their fields under .data; older layouts under .properties. Neither may be an array.
        var data = (event.data && typeof event.data === 'object' && !Array.isArray(event.data)) ? event.data : ((event.properties && typeof event.properties === 'object' && !Array.isArray(event.properties)) ? event.properties : {})
        if (event.type === 'session.created') {
          var parent = null
          if (typeof data.parentID === 'string' && data.parentID.length > 0) parent = data.parentID
          else if (data.info && typeof data.info === 'object' && typeof data.info.parentID === 'string' && data.info.parentID.length > 0) parent = data.info.parentID
          if (parent !== null) return
          var session = null
          if (typeof data.sessionID === 'string' && data.sessionID.length > 0) session = data.sessionID
          else if (data.info && typeof data.info === 'object' && typeof data.info.id === 'string' && data.info.id.length > 0) session = data.info.id
          else if (typeof data.session_id === 'string' && data.session_id.length > 0) session = data.session_id
          if (session !== null) postHook('AgentSession', { session_id: session })
        } else if (event.type === 'session.status') {
          var status = data.status
          var busy = !!(status && typeof status === 'object' && status.type === 'busy')
          if (busy && !work) {
            postHook('UserPromptSubmit')
            stopPosted = false
          }
          work = busy
        } else if (event.type === 'session.execution.started') {
          // v2 'run' emits this instead of session.status busy.
          if (!work) {
            postHook('UserPromptSubmit')
            stopPosted = false
          }
          work = true
        } else if (event.type === 'session.execution.succeeded' || event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted') {
          postStop()
          work = false
        } else if (event.type === 'session.idle') {
          postStop()
          work = false
        } else if (event.type === 'permission.asked' || event.type === 'question.asked') {
          postHook('Notification', { message: permissionText(data) })
        } else if (event.type === 'tool.execute.before') {
          if (data.tool === 'question') postHook('Notification', { message: permissionText(data) })
        } else if (event.type === 'session.tool.input.started') {
          if (data.name === 'question') postHook('Notification', { message: permissionText(data) })
        } else if (event.type === 'session.usage.updated') {
          var cost = typeof data.cost === 'number' && Number.isFinite(data.cost) && data.cost >= 0 ? data.cost : null
          if (cost !== null) syncUsage(cost, typeof data.modelID === 'string' ? data.modelID : currentModel)
        } else if (event.type === 'session.step.started') {
          var model = (data.model && typeof data.model === 'object' && typeof data.model.id === 'string') ? data.model.id : null
          if (model !== null) currentModel = model
        } else if (event.type === 'message.updated') {
          // v1 fallback: per-message cost tracking.
          var info = data.info
          if (!info || typeof info !== 'object' || info.role !== 'assistant') return
          if (
            typeof info.id === 'string' && info.id.length > 0 &&
            typeof info.cost === 'number' && Number.isFinite(info.cost) && info.cost >= 0
          ) {
            syncUsage(info.cost, typeof info.modelID === 'string' ? info.modelID : null)
          }
        }
      } catch (error) {}
    }

    // The app treats Stop as the settle signal of a turn: post at most one per turn no matter which of the
    // idle/execution-end variants this OpenCode version emits.
    function postStop() {
      try {
        if (stopPosted) return
        stopPosted = true
        postHook('Stop')
      } catch (error) {}
    }

    void (async function () {
      try {
        var stream = await context.event.subscribe()
        for await (var event of stream) {
          if (stopped) break
          handleEvent(event)
        }
      } catch (error) {}
    })()

    return function cleanup() {
      if (stopped) return
      stopped = true
    }
  }
}
`
}
