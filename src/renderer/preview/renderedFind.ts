// Highlights find matches inside rendered HTML (markdown, docx) for the preview pane (D74 #6).
// Only text nodes are touched (TreeWalker), never attributes or <script>/<style> content, and every
// pass first unwraps the previous marks, so changing the query never nests highlights.
import { FIND_HIGHLIGHT_MAX, foldCase, isBlankQuery } from './fileViewFind'

const MATCH_SELECTOR = 'mark[data-find-match]'
const BLOCKED_PARENTS = new Set<string>(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'])
const MATCH_CLASS = 'rounded-sm bg-amber-400/30 text-inherit'
const CURRENT_CLASS = 'rounded-sm bg-amber-400 text-black'

/** Replaces every highlight with its text again; the next pass starts from clean text nodes. */
export function clearFindHighlights(root: HTMLElement): void {
  const marks = Array.from(root.querySelectorAll<HTMLElement>(MATCH_SELECTOR))
  for (const mark of marks) {
    const parent = mark.parentNode
    if (parent === null) continue
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
    parent.normalize()
  }
}

/**
 * Wraps every case-insensitive occurrence of `query` in <mark>, up to the highlight cap, and gives
 * the active one a different style. Returns how many marks were drawn.
 */
export function highlightRendered(root: HTMLElement, query: string, activeIndex: number): number {
  clearFindHighlights(root)
  if (isBlankQuery(query)) return 0
  const needle = foldCase(query)
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node: Node): number => {
      const parent = node.parentElement
      if (parent === null || BLOCKED_PARENTS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
      return (node.nodeValue ?? '').trim() === '' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    }
  })
  let next = walker.nextNode()
  while (next !== null) {
    nodes.push(next as Text)
    next = walker.nextNode()
  }

  let count = 0
  let ordinal = 0
  for (const textNode of nodes) {
    const text = textNode.nodeValue ?? ''
    const haystack = foldCase(text)
    let from = 0
    let index = haystack.indexOf(needle, from)
    if (index < 0) continue
    const fragment = document.createDocumentFragment()
    while (index >= 0) {
      if (count >= FIND_HIGHLIGHT_MAX) {
        fragment.appendChild(document.createTextNode(text.slice(from)))
        from = text.length
        break
      }
      if (index > from) fragment.appendChild(document.createTextNode(text.slice(from, index)))
      const mark = document.createElement('mark')
      mark.setAttribute('data-find-match', '')
      if (ordinal === activeIndex) mark.setAttribute('data-find-current', '')
      mark.className = ordinal === activeIndex ? CURRENT_CLASS : MATCH_CLASS
      mark.textContent = text.slice(index, index + needle.length)
      fragment.appendChild(mark)
      count += 1
      ordinal += 1
      from = index + needle.length
      index = haystack.indexOf(needle, from)
    }
    if (from < text.length) fragment.appendChild(document.createTextNode(text.slice(from)))
    textNode.parentNode?.replaceChild(fragment, textNode)
    if (count >= FIND_HIGHLIGHT_MAX) break
  }
  return count
}

/** Scrolls the active mark into the middle of its scroll container. */
export function scrollFindCurrent(root: HTMLElement): void {
  root
    .querySelector<HTMLElement>('[data-find-current]')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' })
}
