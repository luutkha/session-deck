// No DOM test environment here: server markup checks the chips, labels and the empty state.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../shared/types'
import { TagEditor } from './TagEditor'
import { tagHue } from './tagLogic'

const SESSION_ID: Id = 'session-1'

function render(tags: readonly string[]): string {
  return renderToStaticMarkup(<TagEditor sessionId={SESSION_ID} tags={tags} />)
}

describe('TagEditor', () => {
  it('renders a labelled, removable chip per tag and one add input', () => {
    const markup = render(['Work', 'home'])

    expect(markup).toContain('data-tag-editor=""')
    expect(markup).toContain('data-tag="Work"')
    expect(markup).toContain('data-tag="home"')
    expect(markup).toContain('aria-label="Remove tag Work"')
    expect(markup).toContain('aria-label="Remove tag home"')
    expect(markup).toContain('aria-label="Add tag"')
  })

  it('colours each chip from the shared tag style', () => {
    expect(render(['Work'])).toContain(`hsl(${tagHue('Work')}`)
  })

  it('renders only the input when the session has no tags', () => {
    const markup = render([])

    expect(markup).toContain('data-tag-editor=""')
    expect(markup).toContain('aria-label="Add tag"')
    expect(markup).not.toContain('data-tag="')
    expect(markup).not.toContain('aria-label="Remove tag')
  })
})
