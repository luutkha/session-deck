import { describe, expect, it } from 'vitest'
import { compareUrl, parseRemoteUrl } from './remoteHost'

describe('parseRemoteUrl (D60)', () => {
  it('reads https, ssh and scp-like GitHub remotes', () => {
    for (const url of ['https://github.com/acme/shop.git', 'https://github.com/acme/shop', 'git@github.com:acme/shop.git', 'ssh://git@github.com/acme/shop.git', 'https://user@github.com/acme/shop/']) {
      expect(parseRemoteUrl(url)).toEqual({ kind: 'github', origin: 'https://github.com', path: 'acme/shop' })
    }
  })

  it('reads GitLab subgroups, Bitbucket and enterprise hosts', () => {
    expect(parseRemoteUrl('git@gitlab.com:group/sub/app.git')).toEqual({ kind: 'gitlab', origin: 'https://gitlab.com', path: 'group/sub/app' })
    expect(parseRemoteUrl('https://bitbucket.org/team/app.git')?.kind).toBe('bitbucket')
    expect(parseRemoteUrl('https://github.acme.corp/team/app')?.kind).toBe('github')
    expect(parseRemoteUrl('ssh://git@gitlab.acme.io:2222/team/app.git')).toEqual({ kind: 'gitlab', origin: 'https://gitlab.acme.io', path: 'team/app' })
  })

  it('returns null for local paths, unknown hosts and junk', () => {
    for (const url of ['C:\\repos\\origin.git', 'C:/repos/origin.git', '/srv/git/app.git', 'file:///C:/repos/app.git', 'https://example.com/a/b.git', 'git@github.com:onlyone', '', 'not a url']) {
      expect(parseRemoteUrl(url)).toBeNull()
    }
  })
})

describe('compareUrl (D60)', () => {
  it('GitHub compare page keeps branch slashes and encodes the rest', () => {
    expect(compareUrl('git@github.com:acme/shop.git', 'main', 'feat/login fix')).toBe('https://github.com/acme/shop/compare/main...feat/login%20fix?expand=1')
  })

  it('GitLab merge request and Bitbucket pull request pages', () => {
    expect(compareUrl('https://gitlab.com/g/app.git', 'main', 'fix-1')).toBe('https://gitlab.com/g/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=fix-1&merge_request%5Btarget_branch%5D=main')
    expect(compareUrl('git@bitbucket.org:team/app.git', 'develop', 'fix/a')).toBe('https://bitbucket.org/team/app/pull-requests/new?source=fix%2Fa&dest=develop')
  })

  it('unknown host = null', () => {
    expect(compareUrl('https://example.com/a/b', 'main', 'x')).toBeNull()
  })
})
