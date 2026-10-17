/**
 * The OpenCode "worker" plugin, as ESM JavaScript source. It is injected into every Claude terminal's environment
 * (OPENCODE_CONFIG_CONTENT, see workerPluginEnv.ts), so any `opencode` process started from that terminal, by any
 * script, loads it and reports what it does to the app: the app shows it as a read-only worker tab.
 *
 * Wire format: POST http://127.0.0.1:<SESSIONDECK_PORT>/worker/<claude session id>/event, header `x-token`,
 * body {"v":1,"proc":"<per process id>","kind":...} with kinds
 *   start {oc,dir,title}   busy {oc}   idle {oc}   user {oc,partId,text}   text {oc,partId,text}
 *   tool {oc,partId,tool,state,text}   step {oc,partId,cost,tokens}   model {oc,model}   error {oc,text}   beat {}
 * (`oc` = OpenCode session id; `state` = running | done | error). A heartbeat every 5 s lets the app notice a dead process.
 *
 * Like the status plugin: the handler NEVER throws and NEVER blocks (fire-and-forget fetch with a 2 s timeout, errors
 * swallowed because the app may be gone) and does nothing when the SESSIONDECK_* variables are missing. Sub-agent
 * sessions (info.parentID set) are ignored.
 */
export const WORKER_PLUGIN_FILE_NAME = 'sessiondeck-worker-plugin.mjs'

export const WORKER_HEARTBEAT_MS = 5000
export const WORKER_TEXT_THROTTLE_MS = 300
export const WORKER_FETCH_TIMEOUT_MS = 2000
/** Reports waiting behind a slow or dead app before new ones are dropped. */
export const WORKER_MAX_QUEUE = 200
export const WORKER_TEXT_MAX = 1200
export const WORKER_SUMMARY_MAX = 240

export function buildWorkerPluginSource(): string {
  return `export const SessionDeckWorkerPlugin = async (ctx) => {
  var port = process.env.SESSIONDECK_PORT
  var owner = process.env.SESSIONDECK_SESSION_ID
  var token = process.env.SESSIONDECK_TOKEN
  if (!port || !owner || !token) return {}
  var url = 'http://127.0.0.1:' + port + '/worker/' + encodeURIComponent(owner) + '/event'
  var proc = String(process.pid) + '-' + Date.now().toString(36)
  var dir = ctx && typeof ctx.directory === 'string' ? ctx.directory : ''
  var roles = {}
  var held = {}
  var ignored = {}
  var busy = {}
  var models = {}
  var userSent = {}
  var pendingText = {}
  var timer = null

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
    var keys = ['command', 'filePath', 'path', 'pattern', 'query', 'url', 'description', 'prompt']
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

  function queueText(part) {
    pendingText[part.id] = part
    if (part.time && part.time.end) { flushText(); return }
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
      queueText(part)
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
      if (info.error) post({ kind: 'error', oc: info.sessionID, text: errorText(info.error) })
    }
    var waiting = held[info.id]
    if (waiting) {
      delete held[info.id]
      for (var i = 0; i < waiting.length; i++) handlePart(waiting[i])
    }
  }

  var beat = setInterval(function () { post({ kind: 'beat' }) }, ${WORKER_HEARTBEAT_MS})
  if (beat && typeof beat.unref === 'function') beat.unref()

  return {
    event: async function (context) {
      try {
        var event = context && context.event
        if (!event || typeof event.type !== 'string') return
        var props = (event.properties && typeof event.properties === 'object') ? event.properties : {}
        if (event.type === 'session.created') {
          var info = props.info
          if (!info || typeof info.id !== 'string') return
          if (typeof info.parentID === 'string' && info.parentID.length > 0) { ignored[info.id] = true; return }
          post({ kind: 'start', oc: info.id, dir: typeof info.directory === 'string' ? info.directory : dir, title: typeof info.title === 'string' ? clip(info.title, 120) : '' })
        } else if (event.type === 'session.status') {
          var sid = props.sessionID
          if (typeof sid !== 'string' || ignored[sid]) return
          var isBusy = !!(props.status && props.status.type === 'busy')
          if (isBusy && !busy[sid]) post({ kind: 'busy', oc: sid, dir: dir })
          busy[sid] = isBusy
        } else if (event.type === 'session.idle') {
          var idleId = props.sessionID
          if (typeof idleId !== 'string' || ignored[idleId]) return
          flushText()
          busy[idleId] = false
          post({ kind: 'idle', oc: idleId })
        } else if (event.type === 'session.error') {
          var errId = props.sessionID
          if (typeof errId !== 'string' || ignored[errId]) return
          post({ kind: 'error', oc: errId, text: errorText(props.error) })
        } else if (event.type === 'message.updated') {
          handleMessage(props.info)
        } else if (event.type === 'message.part.updated') {
          handlePart(props.part)
        }
      } catch (error) {}
    }
  }
}
`
}
