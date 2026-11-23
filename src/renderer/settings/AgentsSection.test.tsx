// D80: the two opt-in Jarvis rows in Settings > Agents. The repo has no DOM test environment, so rendering is
// checked with react-dom/server and the patch/validation results through the pure helpers the rows use.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_APP_SETTINGS, type AppSettings, type JarvisSettings } from '../../shared/types'
import {
  AgentsSection,
  PLANS_HELP,
  PLANS_LABEL,
  WATCH_HELP,
  WATCH_LABEL,
  WATCH_MINUTES_LABEL,
  WATCH_MINUTES_MESSAGE,
  commitWatchMinutes,
  plansEnabledPatch,
  watchEnabledPatch
} from './AgentsSection'

function settingsWith(jarvis: Partial<JarvisSettings>): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, jarvis: { ...DEFAULT_APP_SETTINGS.jarvis, ...jarvis } }
}

function renderSection(jarvis: Partial<JarvisSettings>): string {
  const settings = settingsWith(jarvis)
  return renderToStaticMarkup(
    <AgentsSection
      settings={settings}
      actions={{ updateSettings: async (): Promise<AppSettings> => settings }}
    />
  )
}

/** The opening tag of the switch with this accessible label, attributes included. */
function switchTag(markup: string, label: string): string {
  const labelIndex = markup.indexOf(`aria-label="${label}"`)
  expect(labelIndex).toBeGreaterThanOrEqual(0)
  const start = markup.lastIndexOf('<button', labelIndex)
  const end = markup.indexOf('>', labelIndex)
  return markup.slice(start, end + 1)
}

/** The opening tag of the input with this accessible label, attributes included. */
function inputTag(markup: string, label: string): string {
  const labelIndex = markup.indexOf(`aria-label="${label}"`)
  expect(labelIndex).toBeGreaterThanOrEqual(0)
  const start = markup.lastIndexOf('<input', labelIndex)
  const end = markup.indexOf('/', labelIndex)
  return markup.slice(start, end + 1)
}

/** HTML-escaped apostrophes, so the visible text can be compared with the source string. */
function visibleText(markup: string): string {
  return markup.replaceAll('&#x27;', "'")
}

describe('AgentsSection opt-in Jarvis rows', () => {
  it('renders both switches off by default, without the minutes field', () => {
    const markup = renderSection({})

    expect(switchTag(markup, WATCH_LABEL)).toContain('aria-checked="false"')
    expect(switchTag(markup, PLANS_LABEL)).toContain('aria-checked="false"')
    expect(visibleText(markup)).toContain(WATCH_HELP)
    expect(visibleText(markup)).toContain(PLANS_HELP)
    expect(markup).not.toContain(`aria-label="${WATCH_MINUTES_LABEL}"`)
  })

  it('sends the exact patch for each switch', () => {
    expect(watchEnabledPatch(true)).toStrictEqual({ jarvis: { watchEnabled: true } })
    expect(watchEnabledPatch(false)).toStrictEqual({ jarvis: { watchEnabled: false } })
    expect(plansEnabledPatch(true)).toStrictEqual({ jarvis: { plansEnabled: true } })
    expect(plansEnabledPatch(false)).toStrictEqual({ jarvis: { plansEnabled: false } })
  })

  it('shows the minutes field with the stored value when watch is on', () => {
    const markup = renderSection({ watchEnabled: true, watchEveryMinutes: 45 })

    expect(switchTag(markup, WATCH_LABEL)).toContain('aria-checked="true"')
    expect(inputTag(markup, WATCH_MINUTES_LABEL)).toContain('value="45"')
  })

  it('commits a valid whole number in range', () => {
    expect(commitWatchMinutes('10', 5)).toStrictEqual({
      patch: { jarvis: { watchEveryMinutes: 10 } },
      error: null
    })
    expect(commitWatchMinutes(' 45 ', 10)).toStrictEqual({
      patch: { jarvis: { watchEveryMinutes: 45 } },
      error: null
    })
    expect(commitWatchMinutes('120', 10)).toStrictEqual({
      patch: { jarvis: { watchEveryMinutes: 120 } },
      error: null
    })
  })

  it('sends nothing when the number is unchanged', () => {
    expect(commitWatchMinutes('10', 10)).toStrictEqual({ patch: null, error: null })
  })

  it('rejects empty, fractional and out-of-range values without sending anything', () => {
    for (const text of ['', '   ', 'soon', '3.5', '0', '-5', '121', '99999']) {
      expect(commitWatchMinutes(text, 10)).toStrictEqual({ patch: null, error: WATCH_MINUTES_MESSAGE })
    }
    expect(WATCH_MINUTES_MESSAGE).toBe('Enter a whole number from 1 to 120.')
  })
})
