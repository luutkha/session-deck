import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const winptyGypPath = path.resolve(__dirname, '../node_modules/node-pty/deps/winpty/src/winpty.gyp')

let content

try {
  content = readFileSync(winptyGypPath, 'utf8')
} catch {
  console.log('node-pty winpty.gyp not found; skipping patch')
  process.exit(0)
}

const patched = content
  .replace(/cd shared && GetCommitHash\.bat/g, 'cd shared && .\\\\GetCommitHash.bat')
  .replace(/cd shared && UpdateGenVersion\.bat/g, 'cd shared && .\\\\UpdateGenVersion.bat')

if (patched !== content) {
  writeFileSync(winptyGypPath, patched, 'utf8')
  console.log('Patched node-pty winpty.gyp batch-file calls')
}
