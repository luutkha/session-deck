// The repo has no DOM test environment, so the section is checked with react-dom/server: effects do not run there,
// which is exactly the initial "Checking..." state. The report rendering rules are tested in diagnosticsFormat.test.ts.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CHECKING_TEXT } from './diagnosticsFormat'
import { DiagnosticsSection } from './DiagnosticsSection'

describe('DiagnosticsSection loading state', () => {
  it('renders a compact status line and no report before the fetch resolves', () => {
    const markup = renderToStaticMarkup(<DiagnosticsSection />)

    expect(markup).toContain('data-diagnostics=""')
    expect(markup).toContain('role="status"')
    expect(markup).toContain(CHECKING_TEXT)
    expect(markup).not.toContain('data-diagnostics-tool')
    expect(markup).not.toContain('data-diagnostics-copy')
  })
})
