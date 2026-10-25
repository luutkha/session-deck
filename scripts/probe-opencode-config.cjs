// Probe: does `opencode debug config` include the injected `plugin` entries from OPENCODE_CONFIG_CONTENT?
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-probe-oc-cfg-'))
  const proj = path.join(root, 'proj')
  fs.mkdirSync(proj)
  const pluginFile = path.join(root, 'shapes.mjs')
  fs.writeFileSync(pluginFile, 'export const SessionDeckPlugin = async () => ({})\n')
  const url = 'file:///' + pluginFile.replace(/\\/g, '/').replace(/^\/+/, '')
  const env = {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [url], permission: { '*': 'allow' } })
  }
  for (const args of [['debug', 'config'], ['debug', 'paths']]) {
    const child = spawn(process.env.COMSPEC ?? 'cmd.exe', ['/c', 'opencode', ...args], {
      cwd: proj,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = '', err = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { err += d.toString() })
    const code = await new Promise((r) => { const t = setTimeout(() => child.kill(), 45000); child.on('close', (c) => { clearTimeout(t); r(c) }) })
    console.log(`=== opencode ${args.join(' ')} (exit ${code}) ===`)
    console.log(out.slice(0, 3000))
    if (err.trim()) console.log('stderr:', err.slice(0, 1000))
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
main().then(() => process.exit(0)).catch((e) => { console.log('error', e); process.exit(1) })
