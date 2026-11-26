// D89: the real Electron/OS side of editorOpen.ts. SESSIONDECK_EDITOR_COMMAND replaces `code` (tests use it so no
// real editor opens; users can point it at e.g. `cursor`). It is called as `<command> --goto "<file>:<line>"`.
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { shell } from 'electron'
import type { EditorDeps } from './editorOpen'

const EDITOR_TIMEOUT_MS = 8000

export function createEditorDeps(env: NodeJS.ProcessEnv = process.env): EditorDeps {
  const override = (env.SESSIONDECK_EDITOR_COMMAND ?? '').trim()
  const overridden = override !== ''
  const command = overridden ? override : 'code'
  return {
    runCode: (file, line) => new Promise<boolean>((resolve) => {
      // A shell is needed on Windows (`code` is code.cmd); the file name is quoted and never contains a double quote.
      const child = spawn(`${command} --goto "${file}:${String(line)}"`, { shell: true, windowsHide: true, stdio: 'ignore' })
      const timer = setTimeout(() => { child.kill(); resolve(false) }, EDITOR_TIMEOUT_MS)
      child.once('error', (error) => { clearTimeout(timer); console.warn('[editor] could not start', command, error.message); resolve(false) })
      child.once('exit', (code) => { clearTimeout(timer); if (code !== 0) console.warn('[editor]', command, 'exited with', String(code)); resolve(code === 0) })
    }),
    openPath: (file) => (overridden ? Promise.resolve('the editor command failed') : shell.openPath(file)),
    isFile: async (file) => {
      try { return (await stat(file)).isFile() } catch { return false }
    }
  }
}
