// D89: Settings > General theme choice. The repo's Vitest environment has no DOM, so the row is
// checked with react-dom/server markup (the persistence/subscription rules live in themePref.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_APP_SETTINGS } from '../../shared/types'
import type { Theme } from '../theme/themePref'
import { GeneralSection } from './GeneralSection'

function renderGeneral(): string {
  return renderToStaticMarkup(
    <GeneralSection
      settings={DEFAULT_APP_SETTINGS}
      actions={{ updateSettings: async () => DEFAULT_APP_SETTINGS }}
    />
  )
}

/** The opening tag of the theme button with this value, attributes included. */
function themeButton(markup: string, value: Theme): string {
  const marker = `data-theme-choice="${value}"`
  const index = markup.indexOf(marker)
  expect(index, marker).toBeGreaterThanOrEqual(0)
  const start = markup.lastIndexOf('<button', index)
  const end = markup.indexOf('>', index)
  return markup.slice(start, end + 1)
}

afterEach((): void => {
  vi.unstubAllGlobals()
})

describe('GeneralSection theme choice', () => {
  it('shows both choices with Dark pressed by default', () => {
    const markup = renderGeneral()

    expect(markup).toContain('aria-label="Theme"')
    expect(markup).toContain('data-testid="settings-theme"')
    expect(themeButton(markup, 'dark')).toContain('aria-pressed="true"')
    expect(themeButton(markup, 'light')).toContain('aria-pressed="false"')
    expect(markup).toContain('Dark is the default')
  })

  it('shows Light pressed when the stored preference is light', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string): string | null => (key === 'sessiondeck.theme' ? 'light' : null),
      setItem: (): void => undefined
    })
    const markup = renderGeneral()

    expect(themeButton(markup, 'light')).toContain('aria-pressed="true"')
    expect(themeButton(markup, 'dark')).toContain('aria-pressed="false"')
  })
})
