// The real machine behind ProviderUsageDeps (D96): files, HTTPS and Windows DPAPI. Kept apart from the fetchers so
// they stay pure and testable; this file is deliberately thin and every function swallows its errors into null.
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { ProviderHttpInit, ProviderHttpResponse, ProviderUsageDeps } from './providerUsageTypes'

/** A login file is a few hundred bytes; anything bigger is not one and is not read into memory. */
export const MAX_LOGIN_FILE_BYTES = 256 * 1024
const DPAPI_TIMEOUT_MS = 10_000

/**
 * PowerShell that unprotects a DPAPI blob for the CURRENT user. The blob arrives base64 in an environment variable
 * (never on the command line: it would show up in process listings) and the plain bytes leave as base64 on stdout.
 */
export const DPAPI_SCRIPT =
  "Add-Type -AssemblyName System.Security; " +
  "$b = [Convert]::FromBase64String($env:SESSIONDECK_DPAPI_BLOB); " +
  "$p = [System.Security.Cryptography.ProtectedData]::Unprotect($b, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); " +
  "[Convert]::ToBase64String($p)"

async function readLimited(path: string): Promise<Buffer | null> {
  try {
    const bytes = await readFile(path)
    return bytes.length > MAX_LOGIN_FILE_BYTES ? null : bytes
  } catch {
    return null
  }
}

/**
 * E2E seam: SESSIONDECK_E2E_PROVIDER_USAGE_ORIGIN points every provider call at a local test server. Only a loopback
 * origin is honoured, so a stray variable can never send a login token to a real host.
 */
export function redirectedUrl(url: string, origin: string | undefined): string {
  if (origin === undefined || !/^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(origin)) return url
  try {
    const parsed = new URL(url)
    return origin + parsed.pathname + parsed.search
  } catch {
    return url
  }
}

async function httpRequest(url: string, init: ProviderHttpInit): Promise<ProviderHttpResponse> {
  const response = await fetch(redirectedUrl(url, process.env.SESSIONDECK_E2E_PROVIDER_USAGE_ORIGIN), {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs)
  })
  return {
    status: response.status,
    headers: { get: (name: string): string | null => response.headers.get(name) },
    json: () => response.json() as Promise<unknown>,
    text: () => response.text()
  }
}

function dpapiUnprotect(blob: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', DPAPI_SCRIPT],
        {
          timeout: DPAPI_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, SESSIONDECK_DPAPI_BLOB: blob.toString('base64') }
        },
        (error, stdout) => {
          if (error) {
            resolve(null)
            return
          }
          const text = String(stdout).trim()
          resolve(text.length === 0 ? null : Buffer.from(text, 'base64'))
        }
      )
    } catch {
      resolve(null)
    }
  })
}

/** The production dependencies. `dpapiUnprotect` exists on Windows only, as the contract says. */
export function createProviderUsageDeps(): ProviderUsageDeps {
  return {
    platform: process.platform,
    homeDir: homedir(),
    env: process.env,
    now: () => Date.now(),
    readTextFile: async (path) => {
      const bytes = await readLimited(path)
      return bytes === null ? null : bytes.toString('utf8')
    },
    readBinaryFile: readLimited,
    http: httpRequest,
    ...(process.platform === 'win32' ? { dpapiUnprotect } : {})
  }
}
