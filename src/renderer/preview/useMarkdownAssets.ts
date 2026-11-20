// D75: makes a Markdown preview show its relative images and follow its relative links. MarkdownView
// (shared with the Changes panel) stays untouched: this hooks into the preview's own container.
// Images go through main (`readFileView`) as a data: URL because the window CSP allows only
// `img-src 'self' data:`; remote http(s) images stay blocked on purpose (no tracking pixels).
import { useEffect, useRef, type RefObject } from 'react'
import { fileViewKindFor } from '../../shared/fileViewKind'
import type { FileView, Id } from '../../shared/types'
import { requestFileView } from '../viewer/previewBus'
import { imageSrc } from './fileViewLogic'
import { resolveRelativeAsset } from './markdownAssets'

const MAX_IMAGES = 40
const MAX_CONCURRENT_LOADS = 4
const MISSING_CLASSES: readonly string[] = ['border', 'border-dashed', 'border-border']

const HTTP_LINK = /^https?:\/\//i

interface AssetCache {
  /** The document generation the entries belong to: a changed file refetches its images. */
  readonly docKey: string
  readonly entries: Map<string, string>
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)
}

/** Marks an image whose file could not be read: a dashed box with its name, not an empty hole. */
function markAssetMissing(img: HTMLImageElement, path: string): void {
  const name = fileName(path)
  img.title = name === '' ? 'Image not available' : `Image not available: ${name}`
  img.classList.add(...MISSING_CLASSES)
}

/**
 * Loads the relative images of the rendered document into `img.src` as data URLs. Re-runs when the
 * document changes (live reload), never touches http(s)/data: sources, caps the work per document.
 */
export function useMarkdownImages(
  hostRef: RefObject<HTMLDivElement | null>,
  view: FileView,
  sessionId: Id,
  enabled: boolean
): void {
  const cacheRef = useRef<AssetCache>({ docKey: '', entries: new Map<string, string>() })

  useEffect((): (() => void) => {
    const noop = (): void => undefined
    if (!enabled) return noop
    const root = hostRef.current?.querySelector<HTMLElement>('[data-markdown]') ?? null
    if (root === null) return noop

    const docKey = `${view.path}|${String(view.mtimeMs)}`
    if (cacheRef.current.docKey !== docKey) cacheRef.current = { docKey, entries: new Map<string, string>() }
    const cache = cacheRef.current.entries

    // Several <img> tags may share one file; one read fills them all.
    const jobs = new Map<string, HTMLImageElement[]>()
    for (const img of Array.from(root.querySelectorAll('img')).slice(0, MAX_IMAGES)) {
      const path = resolveRelativeAsset(view.path, img.getAttribute('src') ?? '')
      if (path === null || fileViewKindFor(path) !== 'image') continue
      const cached = cache.get(path)
      if (cached !== undefined) {
        img.src = cached
        continue
      }
      const list = jobs.get(path)
      if (list === undefined) jobs.set(path, [img])
      else list.push(img)
    }

    let disposed = false
    let running = 0
    const queue = [...jobs.entries()]

    function apply(path: string, targets: readonly HTMLImageElement[], dataUrl: string): void {
      cache.set(path, dataUrl)
      for (const img of targets) if (img.isConnected) img.src = dataUrl
    }

    function pump(): void {
      while (!disposed && running < MAX_CONCURRENT_LOADS && queue.length > 0) {
        const job = queue.shift()
        if (job === undefined) return
        const [path, targets] = job
        running += 1
        void window.api
          .readFileView(sessionId, path)
          .then((result): void => {
            if (disposed) return
            const dataUrl = result.ok && result.view.kind === 'image' ? imageSrc(result.view) : ''
            if (dataUrl === '') for (const img of targets) markAssetMissing(img, path)
            else apply(path, targets, dataUrl)
          })
          .catch((): void => {
            if (!disposed) for (const img of targets) markAssetMissing(img, path)
          })
          .finally((): void => {
            running -= 1
            pump()
          })
      }
    }

    pump()
    return (): void => {
      disposed = true
    }
  }, [enabled, hostRef, sessionId, view.content, view.mtimeMs, view.path])
}

/**
 * Handles clicks on rendered links in the capture phase, so MarkdownView's own handler (which only
 * knows http(s)) never runs for a relative path. Nothing is set with innerHTML: only navigation.
 */
export function useMarkdownLinks(
  hostRef: RefObject<HTMLDivElement | null>,
  view: FileView,
  sessionId: Id,
  enabled: boolean
): void {
  useEffect((): (() => void) => {
    const node = hostRef.current
    if (!enabled || node === null) return (): void => undefined
    const container: HTMLDivElement = node

    function onClick(event: MouseEvent): void {
      if (event.defaultPrevented || event.button !== 0) return
      const target = event.target instanceof Element ? event.target : null
      const anchor = target === null ? null : target.closest('a')
      if (anchor === null || !container.contains(anchor)) return
      const href = (anchor.getAttribute('href') ?? '').trim()
      if (href === '' || HTTP_LINK.test(href)) return

      if (href.startsWith('#')) {
        // A fragment cannot scroll our own container; keep the window from navigating.
        event.preventDefault()
        event.stopPropagation()
        return
      }

      const path = resolveRelativeAsset(view.path, href)
      if (path === null) return
      event.preventDefault()
      event.stopPropagation()
      // A kind main can show belongs in the side panel; anything else (no workspace listening too)
      // goes through the open pipeline, which refuses dangerous types itself.
      if (fileViewKindFor(path) !== null && requestFileView({ sessionId, text: path })) return
      void window.api.openLink(sessionId, path, false)
    }

    node.addEventListener('click', onClick, true)
    return (): void => node.removeEventListener('click', onClick, true)
  }, [enabled, hostRef, sessionId, view.path])
}
