// The renderer's CSP (index.html meta) is the guard between untrusted content and the window. Code-mode
// image previews are data: URLs; rendered Markdown must still be unable to load remote images and
// scripts must never be inlined or evaled.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const INDEX_HTML = fileURLToPath(new URL('../../index.html', import.meta.url))

/** index.html's CSP meta as directive -> sources, lower-cased directive names. */
function readPolicy(): ReadonlyMap<string, readonly string[]> {
  const html = readFileSync(INDEX_HTML, 'utf8')
  const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html)
  if (meta === null) throw new Error('index.html has no Content-Security-Policy meta')
  const directives = new Map<string, readonly string[]>()
  for (const part of meta[1].split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name !== undefined && name.length > 0) directives.set(name.toLowerCase(), sources)
  }
  return directives
}

describe('the renderer CSP', () => {
  it('allows same-origin and data: images so Code-mode previews render', () => {
    const imgSrc = readPolicy().get('img-src')
    expect(imgSrc).toBeDefined()
    expect(imgSrc).toContain("'self'")
    expect(imgSrc).toContain('data:')
  })

  it('keeps remote and wildcard image sources blocked', () => {
    const imgSrc = readPolicy().get('img-src') ?? []
    const remoteOrWildcard = imgSrc.filter((source) => /^(https?:|\*)/i.test(source))
    expect(remoteOrWildcard).toEqual([])
  })

  it('runs only same-origin scripts (no inline and no eval)', () => {
    expect(readPolicy().get('script-src')).toEqual(["'self'"])
  })

  it('leaves default-src locked to the app origin', () => {
    expect(readPolicy().get('default-src')).toEqual(["'self'"])
  })
})
