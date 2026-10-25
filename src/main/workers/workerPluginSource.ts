/**
 * The OpenCode "worker" plugin, as ESM JavaScript source (OpenCode v2 plugin API, verified on v2.1.4). It is
 * injected into every Claude terminal's environment (OPENCODE_CONFIG_CONTENT, see workerPluginEnv.ts), so any
 * `opencode` process started from that terminal, by any script, loads it and reports what it does to the app:
 * the app shows it as a read-only worker tab.
 *
 * Loading: OpenCode v2 loads plugins from PACKAGE DIRECTORIES exporting one default definition with `id` +
 * `setup` (see workerPluginEnv.ts). In `setup` the plugin posts its initial `hello`, starts the heartbeat and
 * subscribes to the event stream (`context.event.subscribe()` — AsyncIterable of `{type, data}` events). It
 * returns a cleanup function that clears the heartbeat. Handlers accept both the v2 `.data` payloads and the
 * older `.properties` layouts so the same source keeps working across OpenCode versions.
 *
 * Wire format: POST http://127.0.0.1:<SESSIONDECK_PORT>/worker/<claude session id>/event, header `x-token`,
 * body {"v":1,"proc":"<process pid>","kind":...} with kinds
 *   hello {}   start {oc,dir,title}   busy {oc,dir}   idle {oc}   user {oc,partId,text}
 *   text {oc,partId,text}   tool {oc,partId,tool,state,text}   step {oc,partId,cost,tokens}
 *   model {oc,model}   error {oc,text}   beat {}
 * (`oc` = OpenCode session id; `state` = running | done | error). A heartbeat every 5 s lets the app notice a dead
 * process. `hello` is posted at initialization so the app learns this process id (the owner seen first for an
 * OpenCode owner session; workers from Claude, Shell and OpenCode terminals are covered).
 *
 * Session events -> kinds (v2 name first, v1 alias in parentheses):
 *   session.created -> start (sub-agent sessions, parentID set, are ignored)   [v1 run may not emit it]
 *   session.inbox.enqueued {type:"user", payload:{text}} -> user            (v1: user text part)
 *   session.status busy / session.execution.started -> busy                (v1: session.status busy)
 *   session.idle / session.execution.succeeded|failed|interrupted -> idle  (at most one per turn)
 *   session.text.ended / text deltas -> text                               (v1: assistant text parts, throttled)
 *   session.tool.input.started+called -> tool running; success/failed -> tool done|error (v1: tool part)
 *   session.step.ended {cost,tokens} -> step                               (v1: step-finish part)
 *   session.step.started {model} -> model (providerID/model)               (v1: assistant message modelID)
 *   session.execution.failed {error} / session.error -> error              (v1: session.error)
 *
 * Like the status plugin: the handler NEVER throws and NEVER blocks (fire-and-forget fetch with a 2 s timeout,
 * errors swallowed because the app may be gone) and does nothing when the SESSIONDECK_* variables are missing.
 */
export const WORKER_PLUGIN_DIR_NAME = 'sessiondeck-worker-plugin'
/** The v1 layout wrote the plugin as a single .mjs file next to the settings; cleaned up when writing the package. */
export const LEGACY_WORKER_PLUGIN_FILE_NAME = 'sessiondeck-worker-plugin.mjs'
/** Version of the generated plugin package.json. */
export const WORKER_PLUGIN_PACKAGE_VERSION = '1.0.0'

export const WORKER_HEARTBEAT_MS = 5000
export const WORKER_TEXT_THROTTLE_MS = 300
export const WORKER_FETCH_TIMEOUT_MS = 2000
/** Reports waiting behind a slow or dead app before new ones are dropped. */
export const WORKER_MAX_QUEUE = 200
export const WORKER_TEXT_MAX = 1200
export const WORKER_SUMMARY_MAX = 240

export function buildWorkerPluginSource(): string {
  return `export default {
  id: 'sessiondeck-worker',
  setup: async function (context) {
    var port = process.env.SESSIONDECK_PORT
    var owner = process.env.SESSIONDECK_SESSION_ID
    var token = process.env.SESSIONDECK_TOKEN
    if (!port || !owner || !token) return
    var url = 'http://127.0.0.1:' + port + '/worker/' + encodeURIComponent(owner) + '/event'
    var proc = String(process.pid)
    var dir = context && typeof context.directory === 'string' ? context.directory : ''
    var roles = {}
    var held = {}
    var ignored = {}
    var busy = {}
    var idleShown = {}
    // A session that reported an error but never went busy (e.g. it failed at spawn) must still be finalized by
    // its idle event: the hub turns "error + idle" into the failed state (WorkerHub.applyEvent).
    var errored = {}
    var models = {}
    var userSent = {}
    var pendingText = {}
    var toolNames = {}
    var toolInputs = {}
    var textBuffers = {}
    var timer = null
    var stopped = false

    function clip(text, max) {
      var t = String(text)
      return t.length > max ? t.slice(0, max - 1) + '\\u2026' : t
    }

    var chain = Promise.resolve()
    var queued = 0

    // Requests go out one after another so the app sees events in the order they happened.
    function post(body) {
      try {
        if (queued > ${WORKER_MAX_QUEUE}) return
        body.v = 1
        body.proc = proc
        var payload = JSON.stringify(body)
        queued++
        chain = chain.then(function () {
          return fetch(url, {
            method: 'POST',
            headers: { 'x-token': token, 'content-type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(${WORKER_FETCH_TIMEOUT_MS})
          })
        }).catch(function () {}).then(function () { queued-- })
      } catch (error) {}
    }

    function summarize(input) {
      if (!input || typeof input !== 'object') return ''
      var keys = ['command', 'filePath', 'path', 'pattern', 'query', 'url', 'description', 'prompt', 'text']
      for (var i = 0; i < keys.length; i++) {
        var v = input[keys[i]]
        if (typeof v === 'string' && v.length > 0) return clip(v.split(/\\r?\\n/)[0].trim(), ${WORKER_SUMMARY_MAX})
      }
      var json = JSON.stringify(input)
      return json === '{}' ? '' : clip(json, ${WORKER_SUMMARY_MAX})
    }

    function errorText(error) {
      if (!error || typeof error !== 'object') return ''
      var data = error.data
      if (typeof error.message === 'string' && error.message.length > 0) return clip(error.message, ${WORKER_TEXT_MAX})
      if (data && typeof data.message === 'string' && data.message.length > 0) return clip(data.message, ${WORKER_TEXT_MAX})
      return typeof error.name === 'string' ? error.name : 'Error'
    }

    function flushText() {
      timer = null
      var ids = Object.keys(pendingText)
      for (var i = 0; i < ids.length; i++) {
        var p = pendingText[ids[i]]
        delete pendingText[ids[i]]
        post({ kind: 'text', oc: p.sessionID, partId: p.id, text: clip(p.text, ${WORKER_TEXT_MAX}) })
      }
    }

    function queueText(part, immediate) {
      pendingText[part.id] = part
      if (immediate) { flushText(); return }
      if (timer === null) timer = setTimeout(flushText, ${WORKER_TEXT_THROTTLE_MS})
    }

    function handlePart(part) {
      if (!part || typeof part.sessionID !== 'string' || ignored[part.sessionID]) return
      if (part.type === 'text' && typeof part.text === 'string') {
        var role = roles[part.messageID]
        if (!role) {
          var list = held[part.messageID] || (held[part.messageID] = [])
          list.push(part)
          return
        }
        if (role === 'user') {
          if (!userSent[part.id] && part.text.trim().length > 0) {
            userSent[part.id] = true
            post({ kind: 'user', oc: part.sessionID, partId: part.id, text: clip(part.text.trim(), ${WORKER_TEXT_MAX}) })
          }
          return
        }
        queueText(part, !!(part.time && part.time.end))
      } else if (part.type === 'tool') {
        var st = part.state || {}
        var state = st.status === 'completed' ? 'done' : st.status === 'error' ? 'error' : 'running'
        var text = summarize(st.input)
        if (st.status === 'error' && typeof st.error === 'string') text = text + ' \\u2014 ' + clip(st.error.split(/\\r?\\n/)[0], ${WORKER_SUMMARY_MAX})
        post({ kind: 'tool', oc: part.sessionID, partId: part.id, tool: String(part.tool || 'tool'), state: state, text: text })
      } else if (part.type === 'step-finish') {
        var tokens = part.tokens && typeof part.tokens.total === 'number' ? part.tokens.total : 0
        post({ kind: 'step', oc: part.sessionID, partId: part.id, cost: typeof part.cost === 'number' ? part.cost : 0, tokens: tokens })
      }
    }

    function handleMessage(info) {
      if (!info || typeof info.id !== 'string' || typeof info.sessionID !== 'string' || ignored[info.sessionID]) return
      roles[info.id] = info.role
      if (info.role === 'assistant') {
        if (typeof info.modelID === 'string' && info.modelID.length > 0 && models[info.sessionID] !== info.modelID) {
          models[info.sessionID] = info.modelID
          var name = typeof info.providerID === 'string' && info.providerID.length > 0 ? info.providerID + '/' + info.modelID : info.modelID
          post({ kind: 'model', oc: info.sessionID, model: name })
        }
        if (info.error) {
          errored[info.sessionID] = true
          post({ kind: 'error', oc: info.sessionID, text: errorText(info.error) })
        }
      }
      var waiting = held[info.id]
      if (waiting) {
        delete held[info.id]
        for (var i = 0; i < waiting.length; i++) handlePart(waiting[i])
      }
    }

    function tokenTotal(tokens) {
      if (!tokens || typeof tokens !== 'object') return 0
      var total = 0
      var fields = ['input', 'output', 'reasoning']
      for (var i = 0; i < fields.length; i++) {
        if (typeof tokens[fields[i]] === 'number' && Number.isFinite(tokens[fields[i]])) total += tokens[fields[i]]
      }
      var cache = tokens.cache
      if (cache && typeof cache === 'object') {
        if (typeof cache.read === 'number' && Number.isFinite(cache.read)) total += cache.read
        if (typeof cache.write === 'number' && Number.isFinite(cache.write)) total += cache.write
      }
      return total
    }

    function announceSession(id, parent, title, directory) {
      if (typeof parent === 'string' && parent.length > 0) { ignored[id] = true; return }
      post({
        kind: 'start',
        oc: id,
        dir: typeof directory === 'string' && directory.length > 0 ? directory : dir,
        title: typeof title === 'string' && title.length > 0 ? clip(title, 120) : ''
      })
    }

    function markBusy(id) {
      if (idleShown[id]) { idleShown[id] = false }
      if (!busy[id]) post({ kind: 'busy', oc: id, dir: dir })
      busy[id] = true
    }

    function markIdle(id) {
      flushText()
      if (busy[id] || errored[id]) {
        post({ kind: 'idle', oc: id })
        delete errored[id]
      }
      busy[id] = false
      idleShown[id] = true
    }

    function handleEvent(event) {
      try {
        if (!event || typeof event.type !== 'string') return
        // v2 events carry their fields under .data; older layouts under .properties.
        var data = (event.data && typeof event.data === 'object') ? event.data : ((event.properties && typeof event.properties === 'object') ? event.properties : {})
        if (event.type === 'session.created') {
          var info = data.info
          var id = typeof data.sessionID === 'string' ? data.sessionID : (info && typeof info.id === 'string' ? info.id : null)
          if (id === null || ignored[id]) return
          var parent = null
          if (typeof data.parentID === 'string' && data.parentID.length > 0) parent = data.parentID
          else if (info && typeof info.parentID === 'string') parent = info.parentID
          var title = typeof data.title === 'string' ? data.title : (info && typeof info.title === 'string' ? info.title : '')
          var directory = info && typeof info.directory === 'string' ? info.directory : ''
          if (!directory && data.location && typeof data.location === 'object' && typeof data.location.directory === 'string') directory = data.location.directory
          announceSession(id, parent, title, directory)
        } else if (event.type === 'session.status') {
          var sid = data.sessionID
          if (typeof sid !== 'string') sid = ''
          if (sid === '' || ignored[sid]) return
          var isBusy = !!(data.status && data.status.type === 'busy')
          if (isBusy) { markBusy(sid); return }
          if (data.status && data.status.type === 'idle') markIdle(sid)
          busy[sid] = false
        } else if (event.type === 'session.inbox.enqueued') {
          var inboxSid = data.sessionID
          if (typeof inboxSid !== 'string' || ignored[inboxSid]) return
          if (data.type === 'user' && data.payload && typeof data.payload.text === 'string' && data.payload.text.trim().length > 0) {
            post({ kind: 'user', oc: inboxSid, partId: typeof data.id === 'string' ? data.id : '', text: clip(data.payload.text.trim(), ${WORKER_TEXT_MAX}) })
          }
          markBusy(inboxSid)
        } else if (event.type === 'session.execution.started') {
          var runSid = data.sessionID
          if (typeof runSid === 'string' && !ignored[runSid]) markBusy(runSid)
        } else if (event.type === 'session.execution.succeeded' || event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted') {
          var endSid = data.sessionID
          if (typeof endSid === 'string' && !ignored[endSid]) {
            // The error is recorded BEFORE markIdle so the finalizing idle post turns the worker into failed.
            if (event.type === 'session.execution.failed' && data.error) {
              errored[endSid] = true
              post({ kind: 'error', oc: endSid, text: errorText(data.error) })
            }
            markIdle(endSid)
            busy[endSid] = false
          }
        } else if (event.type === 'session.idle') {
          var idleId = data.sessionID
          if (typeof idleId === 'string' && !ignored[idleId]) markIdle(idleId)
        } else if (event.type === 'session.error') {
          var errId = data.sessionID
          if (typeof errId === 'string' && !ignored[errId]) {
            errored[errId] = true
            post({ kind: 'error', oc: errId, text: errorText(data.error) })
          }
        } else if (event.type === 'session.text.delta') {
          var tSid = data.sessionID
          if (typeof tSid !== 'string' || ignored[tSid] || typeof data.assistantMessageID !== 'string') return
          var tKey = tSid + '|' + data.assistantMessageID + '|' + String(data.ordinal)
          if (typeof data.text === 'string' && data.text.length > 0) {
            textBuffers[tKey] = (textBuffers[tKey] || '') + data.text
            queueText({ id: data.assistantMessageID + ':' + String(data.ordinal), sessionID: tSid, messageID: data.assistantMessageID, text: textBuffers[tKey] }, false)
          }
        } else if (event.type === 'session.text.ended') {
          var eSid = data.sessionID
          if (typeof eSid !== 'string' || ignored[eSid] || typeof data.assistantMessageID !== 'string') return
          textBuffers[eSid + '|' + data.assistantMessageID + '|' + String(data.ordinal)] = ''
          if (typeof data.text === 'string' && data.text.length > 0) {
            queueText({ id: data.assistantMessageID + ':' + String(data.ordinal), sessionID: eSid, messageID: data.assistantMessageID, text: data.text }, true)
          }
        } else if (event.type === 'session.tool.input.started') {
          if (typeof data.id === 'string') toolNames[data.id] = typeof data.name === 'string' ? data.name : 'tool'
          if (typeof data.sessionID === 'string' && !ignored[data.sessionID] && data.name === 'question') {
            post({ kind: 'tool', oc: data.sessionID, partId: String(data.id || ''), tool: 'question', state: 'running', text: 'question' })
          }
        } else if (event.type === 'session.tool.called') {
          var cSid = data.sessionID
          if (typeof cSid === 'string' && !ignored[cSid] && typeof data.id === 'string') {
            summarizeToolCall(cSid, data.id, data.input)
          }
        } else if (event.type === 'session.tool.success') {
          var sSid = data.sessionID
          if (typeof sSid === 'string' && !ignored[sSid] && typeof data.id === 'string' && toolInputs[data.id]) {
            var entry = toolInputs[data.id]
            delete toolInputs[data.id]
            post({ kind: 'tool', oc: sSid, partId: data.id, tool: entry.tool, state: 'done', text: entry.text })
          }
        } else if (event.type === 'session.tool.failed') {
          var fSid = data.sessionID
          if (typeof fSid === 'string' && !ignored[fSid] && typeof data.id === 'string' && toolInputs[data.id]) {
            var fEntry = toolInputs[data.id]
            delete toolInputs[data.id]
            var errText = errorText(data.error)
            post({
              kind: 'tool',
              oc: fSid,
              partId: data.id,
              tool: fEntry.tool,
              state: 'error',
              text: fEntry.text + (errText.length > 0 ? ' \\u2014 ' + clip(errText.split(/\\r?\\n/)[0], ${WORKER_SUMMARY_MAX}) : '')
            })
          }
        } else if (event.type === 'session.step.started') {
          var stSid = data.sessionID
          if (typeof stSid === 'string' && !ignored[stSid] && data.model && typeof data.model === 'object' && typeof data.model.id === 'string' && data.model.id.length > 0) {
            var label = typeof data.model.providerID === 'string' && data.model.providerID.length > 0 ? data.model.providerID + '/' + data.model.id : data.model.id
            if (models[stSid] !== label) {
              models[stSid] = label
              post({ kind: 'model', oc: stSid, model: label })
            }
          }
        } else if (event.type === 'session.step.ended') {
          var pSid = data.sessionID
          if (typeof pSid === 'string' && !ignored[pSid]) {
            var cost = typeof data.cost === 'number' && Number.isFinite(data.cost) ? data.cost : 0
            post({
              kind: 'step',
              oc: pSid,
              partId: typeof data.assistantMessageID === 'string' ? data.assistantMessageID : '',
              cost: cost,
              tokens: tokenTotal(data.tokens)
            })
          }
        } else if (event.type === 'message.updated') {
          handleMessage(data.info)
        } else if (event.type === 'message.part.updated') {
          handlePart(data.part)
        }
      } catch (error) {}
    }

    function summarizeToolCall(sessionId, callId, input) {
      if (toolInputs[callId]) return
      var text = summarize(input)
      toolInputs[callId] = { tool: toolNames[callId] || 'tool', text: text }
      post({ kind: 'tool', oc: sessionId, partId: callId, tool: toolNames[callId] || 'tool', state: 'running', text: text })
    }

    // Announce this process before anything else so the app can tell the owner (first report for an OpenCode
    // session) apart from its worker children.
    post({ kind: 'hello' })

    var beat = setInterval(function () { post({ kind: 'beat' }) }, ${WORKER_HEARTBEAT_MS})
    if (beat && typeof beat.unref === 'function') beat.unref()

    void (async function () {
      try {
        if (!context || !context.event || typeof context.event.subscribe !== 'function') return
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
      if (timer !== null) { clearTimeout(timer); timer = null }
      if (beat) clearInterval(beat)
    }
  }
}
`
}
