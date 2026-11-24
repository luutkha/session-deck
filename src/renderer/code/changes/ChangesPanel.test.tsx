// D83: the props of the renderer side of the detachable Changes window. No DOM test environment exists in this
// repo, so rendering is checked with react-dom/server (no effects run: the IPC hooks stay in their loading state).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChangesPanel } from './ChangesPanel'
import { CHANGES_WINDOW_FALLBACK_TITLE, ChangesWindow } from './ChangesWindow'

const DETACH_ATTR = 'data-changes-detach'
const LIST_ATTR = 'data-changes-list'

function panel(props: { readonly onDetach?: () => void; readonly layout?: 'stack' | 'split' } = {}): string {
  return renderToStaticMarkup(<ChangesPanel worktreeId="w1" {...props} />)
}

describe('ChangesPanel detach button', () => {
  it('is rendered when onDetach is given', () => {
    const markup = panel({ onDetach: (): void => undefined })
    expect(markup).toContain(DETACH_ATTR)
    expect(markup).toContain('aria-label="Open changes in a separate window"')
  })

  it('is absent without onDetach', () => {
    expect(panel()).not.toContain(DETACH_ATTR)
  })
})

describe('ChangesPanel layout', () => {
  it('defaults to the stacked side panel (list only, no split column)', () => {
    expect(panel()).not.toContain(LIST_ATTR)
  })

  it('split draws the list column next to the diff area', () => {
    const markup = panel({ layout: 'split' })
    expect(markup).toContain(LIST_ATTR)
    expect(markup).toContain('w-[300px]')
  })
})

describe('ChangesWindow', () => {
  afterEach((): void => {
    vi.unstubAllGlobals()
  })

  it('shows the request title and the split panel, without a detach button', () => {
    vi.stubGlobal('window', {
      api: { changesWindowRequest: { worktreeId: 'w1', title: 'Changes · feat-x · SessionDeck' } }
    })
    const markup = renderToStaticMarkup(<ChangesWindow />)
    expect(markup).toContain('Changes · feat-x · SessionDeck')
    expect(markup).toContain(LIST_ATTR)
    expect(markup).not.toContain(DETACH_ATTR)
  })

  it('shows a clear error line when the launch argument has no request', () => {
    vi.stubGlobal('window', { api: { changesWindowRequest: null } })
    const markup = renderToStaticMarkup(<ChangesWindow />)
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('This window has no worktree to show.')
    expect(markup).toContain(CHANGES_WINDOW_FALLBACK_TITLE)
  })
})
