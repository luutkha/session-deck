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
 *   /statusline/<id> {"model":{"display_name": ...},"cost":{"total_cost_usd": <cost>},
 *   "context_window":{"used_percentage": <0..100>}}.
 * - The user's prompt text (session.inbox.enqueued item.payload.text in v2, the user message parts in
 *   v1) is attached to that turn's UserPromptSubmit body as {prompt}, exactly like the Claude hook.
 * - The model catalog (context.model.list(), cached at setup) supplies the context-window limit and the
 *   display name; context % uses the LATEST step's prompt tokens, never the cumulative session totals.
 * - The OpenCode Go allowance (5-hour rolling / weekly / monthly windows) is read from
 *   https://opencode.ai/zen/go/v1/usage with the credential resolved through the v2 connection API, then
 *   POSTed as {source:'opencode-go', rate_limits:{five_hour, seven_day, monthly}} — at setup and after a
 *   turn ends, at most once per 5 minutes. The Go key never leaves this process and is never logged; any
 *   failure (no login, 401/429, offline, unusable body) posts nothing at all.
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

/** Max characters of the user prompt the plugin forwards (the hook server clamps again). */
export const MAX_PLUGIN_PROMPT_LENGTH = 200

/** Minimum seconds between two /statusline POSTs for one session. */
export const PLUGIN_USAGE_THROTTLE_MS = 1000

/** Minimum time between two OpenCode Go allowance requests from one plugin instance (5 minutes). */
export const PLUGIN_GO_USAGE_THROTTLE_MS = 5 * 60 * 1000

/** The OpenCode Go allowance endpoint (unofficial; best effort, any failure posts nothing). */
export const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

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
    /** What the last statusline post carried, so a richer follow-up is not lost to the 1 s throttle. */
    var lastPostedModel = null
    var lastPostedPercent = null
    var stopped = false
    var pendingPrompt = null
    /** Prompt tokens of the latest step (input + cache read/write): the context used, not the running total. */
    var lastPromptTokens = null
    /** modelId -> { limit: context window size | null, name: display name | null }; null until listed. */
    var modelCatalog = null
    var catalogLoading = false

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

    /** The prompt as posted: trimmed, capped, or null (never an empty prompt field). */
    function clampPrompt(text) {
      if (typeof text !== 'string') return null
      var trimmed = text.trim()
      if (trimmed.length === 0) return null
      if (trimmed.length > ${MAX_PLUGIN_PROMPT_LENGTH}) return trimmed.slice(0, ${MAX_PLUGIN_PROMPT_LENGTH})
      return trimmed
    }

    /** v2: session.inbox.enqueued carries the user text under item.payload.text. */
    function promptFromInbox(data) {
      var item = data && typeof data.item === 'object' ? data.item : null
      if (!item || Array.isArray(item)) return null
      if (typeof item.type === 'string' && item.type !== 'user') return null
      var payload = item.payload && typeof item.payload === 'object' ? item.payload : null
      if (!payload || Array.isArray(payload)) return null
      return clampPrompt(payload.text)
    }

    /** v1: a user message's parts carry the text (type \"text\"). */
    function promptFromParts(parts) {
      if (!Array.isArray(parts)) return null
      var texts = []
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i]
        if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
          texts.push(part.text)
        }
      }
      return texts.length === 0 ? null : clampPrompt(texts.join(' '))
    }

    /** Prompt tokens of one message/step: input + cache read + write (the context the model saw). */
    function promptTokensOf(tokens) {
      if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null
      var input = tokens.input
      if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) return null
      var cache = tokens.cache && typeof tokens.cache === 'object' && !Array.isArray(tokens.cache) ? tokens.cache : null
      var read = cache !== null && typeof cache.read === 'number' && Number.isFinite(cache.read) && cache.read >= 0 ? cache.read : 0
      var write = cache !== null && typeof cache.write === 'number' && Number.isFinite(cache.write) && cache.write >= 0 ? cache.write : 0
      return input + read + write
    }

    /** Lists the model catalog once (display names + context limits); every failure is swallowed. */
    async function loadModelCatalog() {
      if (catalogLoading) return
      try {
        var model = context && context.model ? context.model : null
        if (!model || typeof model.list !== 'function') return
        catalogLoading = true
        var result = await model.list()
        var list = Array.isArray(result) ? result : (result && Array.isArray(result.data) ? result.data : [])
        var next = {}
        for (var i = 0; i < list.length; i++) {
          var entry = list[i]
          if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.length === 0) continue
          var limit = entry.limit && typeof entry.limit === 'object' && typeof entry.limit.context === 'number' && Number.isFinite(entry.limit.context) && entry.limit.context > 0 ? entry.limit.context : null
          var name = typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : null
          next[entry.id] = { limit: limit, name: name }
        }
        modelCatalog = next
      } catch (error) {
      } finally {
        catalogLoading = false
      }
    }

    function displayNameFor(modelId) {
      if (typeof modelId === 'string' && modelId.length > 0 && modelCatalog !== null && modelCatalog[modelId] && typeof modelCatalog[modelId].name === 'string') {
        return modelCatalog[modelId].name
      }
      return typeof modelId === 'string' && modelId.length > 0 ? modelId : null
    }

    /** The latest step's prompt tokens as a percentage of the model's context window; null when unknown. */
    function contextPercentFor(modelId) {
      if (lastPromptTokens === null || modelCatalog === null) return null
      if (typeof modelId !== 'string' || modelId.length === 0) return null
      var entry = modelCatalog[modelId]
      if (!entry || typeof entry.limit !== 'number' || !Number.isFinite(entry.limit) || entry.limit <= 0) return null
      var percent = Math.round((lastPromptTokens / entry.limit) * 100)
      if (!Number.isFinite(percent)) return null
      return Math.min(100, Math.max(0, percent))
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
        var resolved = typeof modelId === 'string' && modelId.length > 0 ? modelId : currentModel
        var display = displayNameFor(resolved)
        var percent = contextPercentFor(resolved)
        var now = Date.now()
        // v2 posts a cost-only session.usage.updated BEFORE the step's model/tokens exist (recorded order).
        // The throttle must not swallow the richer post that follows it, or the chip stays model/context-less.
        var richer = display !== lastPostedModel || percent !== lastPostedPercent
        if (!richer && now - lastUsagePost < ${PLUGIN_USAGE_THROTTLE_MS}) return
        lastUsagePost = now
        lastPostedModel = display
        lastPostedPercent = percent
        var body = { cost: { total_cost_usd: cost } }
        if (display !== null) body.model = { display_name: display }
        if (percent !== null) body.context_window = { used_percentage: percent }
        body.proc = proc
        post('/statusline/' + encodeURIComponent(sessionId), body)
        // A model we have not catalogued yet (fresh install/new model): refresh once for the next post.
        if (modelCatalog !== null && typeof resolved === 'string' && resolved.length > 0 && !modelCatalog[resolved]) {
          void loadModelCatalog()
        }
      } catch (error) {}
    }

    var goUsageLastAt = 0
    var goUsageInFlight = false

    /** CredentialValue (v2: {type:'key',key} | {type:'oauth',access}) -> bearer string; never logged. */
    function credentialToken(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      var raw = null
      if (value.type === 'key' && typeof value.key === 'string') raw = value.key
      else if (value.type === 'oauth' && typeof value.access === 'string') raw = value.access
      else return null
      var trimmed = raw.trim()
      return trimmed.length === 0 ? null : trimmed
    }

    /**
     * The signed-in OpenCode Go credential, read from the plugin context (v2.1.4: credential only exposes
     * activate; the connection API is context.integration.connection.active + resolve). The key stays in
     * this process and is never stored, posted or logged. Any failure reads as "not signed in".
     */
    async function goCredentialToken() {
      try {
        var integration = context && context.integration ? context.integration : null
        if (!integration || !integration.connection) return null
        if (typeof integration.connection.active !== 'function') return null
        if (typeof integration.connection.resolve !== 'function') return null
        var connection = await integration.connection.active('opencode-go')
        if (!connection || typeof connection !== 'object') return null
        return credentialToken(await integration.connection.resolve(connection))
      } catch (error) {
        return null
      }
    }

    /** One Go window in the statusline shape (percent + resets_at as sent by the endpoint). */
    function goWindow(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      if (typeof value.status === 'string' && value.status.length > 0 && value.status !== 'ok') return null
      var percent = value.percent
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return null
      var resets = typeof value.resetsAt === 'string' || typeof value.resetsAt === 'number' ? value.resetsAt : null
      return { used_percentage: percent, resets_at: resets }
    }

    /** GET /usage body -> the app's existing statusline payload; null when no window is usable. */
    function goUsagePayload(json) {
      var root = json && typeof json === 'object' && !Array.isArray(json) ? json : null
      var usage = root && root.usage && typeof root.usage === 'object' && !Array.isArray(root.usage) ? root.usage : null
      if (!usage) return null
      var fiveHour = goWindow(usage.rolling)
      var sevenDay = goWindow(usage.weekly)
      var monthly = goWindow(usage.monthly)
      if (fiveHour === null && sevenDay === null && monthly === null) return null
      var limits = {}
      if (fiveHour !== null) limits.five_hour = fiveHour
      if (sevenDay !== null) limits.seven_day = sevenDay
      if (monthly !== null) limits.monthly = monthly
      return { source: 'opencode-go', rate_limits: limits, proc: proc }
    }

    /**
     * Reports the OpenCode Go allowance as a statusline body (display only; the app's autopilot still reads
     * Claude's account). Called at setup and after a turn ends, at most once per 5 minutes. Any failure
     * (not signed in, 401/429, offline, unusable body) posts NOTHING: stale or absent bars, never fake ones.
     */
    async function syncUsageAccount(force) {
      if (goUsageInFlight) return
      var now = Date.now()
      if (!force && now - goUsageLastAt < ${PLUGIN_GO_USAGE_THROTTLE_MS}) return
      goUsageInFlight = true
      goUsageLastAt = now
      try {
        var token = await goCredentialToken()
        if (token === null) return
        var response = await fetch('${OPENCODE_GO_USAGE_URL}', {
          method: 'GET',
          headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
          signal: AbortSignal.timeout(${PLUGIN_FETCH_TIMEOUT_MS})
        })
        if (!response) return
        if (response.ok === false) return
        if (typeof response.status === 'number' && (response.status < 200 || response.status >= 300)) return
        var json = typeof response.json === 'function' ? await response.json() : null
        var payload = goUsagePayload(json)
        if (payload !== null) post('/statusline/' + encodeURIComponent(sessionId), payload)
      } catch (error) {
      } finally {
        goUsageInFlight = false
      }
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
            startTurn()
          }
          work = busy
        } else if (event.type === 'session.execution.started') {
          // v2 'run' emits this instead of session.status busy.
          if (!work) {
            startTurn()
          }
          work = true
        } else if (event.type === 'session.inbox.enqueued') {
          // v2: the user's prompt text, recorded for the next UserPromptSubmit (the busy event may come first).
          var enqueued = promptFromInbox(data)
          if (enqueued !== null) pendingPrompt = enqueued
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
        } else if (event.type === 'session.step.ended') {
          // v2: per-step tokens. Context is THIS step's prompt, never the cumulative session totals.
          var stepTokens = promptTokensOf(data.tokens)
          if (stepTokens !== null) lastPromptTokens = stepTokens
        } else if (event.type === 'message.updated') {
          // v1 fallback: user messages carry the prompt; assistant ones carry cost and per-message tokens.
          var info = data.info
          if (!info || typeof info !== 'object') return
          if (info.role === 'user') {
            var userPrompt = promptFromParts(info.parts)
            if (userPrompt !== null) pendingPrompt = userPrompt
            return
          }
          if (info.role !== 'assistant') return
          var messageTokens = promptTokensOf(info.tokens)
          if (messageTokens !== null) lastPromptTokens = messageTokens
          if (
            typeof info.id === 'string' && info.id.length > 0 &&
            typeof info.cost === 'number' && Number.isFinite(info.cost) && info.cost >= 0
          ) {
            syncUsage(info.cost, typeof info.modelID === 'string' ? info.modelID : null)
          }
        }
      } catch (error) {}
    }

    // One UserPromptSubmit per turn, carrying the prompt captured since the last turn (when known).
    function startTurn() {
      try {
        var body = pendingPrompt === null ? undefined : { prompt: pendingPrompt }
        pendingPrompt = null
        stopPosted = false
        postHook('UserPromptSubmit', body)
      } catch (error) {}
    }

    // The app treats Stop as the settle signal of a turn: post at most one per turn no matter which of the
    // idle/execution-end variants this OpenCode version emits.
    function postStop() {
      try {
        if (stopPosted) return
        stopPosted = true
        // A prompt queued mid-turn belongs to no announced turn: never attach it to a later one.
        pendingPrompt = null
        postHook('Stop')
        // The bar should be current when the user looks after a turn; throttled to once per 5 min.
        void syncUsageAccount(false)
      } catch (error) {}
    }

    void loadModelCatalog()
    // First Go allowance as soon as the session starts (silent when OpenCode has no Go login).
    void syncUsageAccount(true)

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
