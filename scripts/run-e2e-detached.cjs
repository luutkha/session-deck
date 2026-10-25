// Launches an e2e script DETACHED from this process tree (its own process group), so opencode server
// restarts that kill the agent's shells cannot abort the run. Usage:
//   node scripts/run-e2e-detached.cjs e2e-opencode.cjs
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const script = process.argv[2]
if (!script || !fs.existsSync(path.join(__dirname, script))) {
  console.error('usage: node run-e2e-detached.cjs <e2e-script-in-scripts-dir>')
  process.exit(1)
}
const base = path.basename(script, '.cjs')
const logPath = path.join(__dirname, base + '-last.log')
const log = fs.openSync(logPath, 'w')
const child = spawn(process.execPath, [path.join(__dirname, script)], {
  detached: true,
  stdio: ['ignore', log, log]
})
child.unref()
console.log('detached pid', child.pid, 'log', logPath)
