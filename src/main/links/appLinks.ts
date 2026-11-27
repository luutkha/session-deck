// The app's link service on Electron (terminal clicks and Jarvis's open_link, D58): one place for the real file
// system and shell, so both open links the same safe way.
import { shell } from 'electron'
import { appendFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createLinkService, type LinkService } from './LinkService'

export function createAppLinkService(getSessionCwd: (sessionId: string) => string | null): LinkService {
  return createLinkService({
    getSessionCwd,
    stat: async (target) => {
      try {
        const info = await stat(target)
        return { isFile: info.isFile(), isDirectory: info.isDirectory() }
      } catch {
        return null // a missing or unreadable path is simply not a link
      }
    },
    openPath: (target) => shell.openPath(target),
    // E2E seam (same variable the Code-mode PR link uses): record the URL instead of opening a browser.
    openExternal: (url) => (process.env.SESSIONDECK_E2E_OPENED_URLS_FILE ? appendFile(process.env.SESSIONDECK_E2E_OPENED_URLS_FILE, `${url}
`, 'utf-8') : shell.openExternal(url)),
    showItemInFolder: (target) => shell.showItemInFolder(target),
    homedir
  })
}
