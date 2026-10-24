/**
 * True when `nextUrl` only changes the fragment of `currentUrl` (or is the same document). Anything else — another
 * origin, path or query — is a real navigation and must be blocked in the app window. A prefix comparison is not
 * enough: `file:///app/index.html.evil` starts with the app URL but is a different file.
 */
export function isSameDocumentNavigation(currentUrl: string, nextUrl: string): boolean {
  try {
    const current = new URL(currentUrl)
    const next = new URL(nextUrl)
    return (
      current.origin === next.origin &&
      current.pathname === next.pathname &&
      current.search === next.search
    )
  } catch {
    return false
  }
}
