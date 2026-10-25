// Rendered preview of one file inside a worktree (Code mode, rich previews). The renderer never touches the
// disk: main reads the bytes (size-capped) and hands them over as base64 (images) or text (markdown/text).
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import {
  PREVIEW_IMAGE_MAX_BYTES,
  PREVIEW_TEXT_MAX_BYTES,
  type FilePreview
} from '../../shared/types'
import type { WorktreeRef } from './worktreeChanges'

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp'
}
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown'])

/** What the preview toggle would show for this path, or null (no preview; svg/pdf/etc. deliberately out of v1). */
export function previewKindFor(filePath: string): 'image' | 'markdown' | null {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0 || dot === filePath.length - 1) return null
  const ext = filePath.slice(dot + 1).toLowerCase()
  if (ext in IMAGE_MIME) return 'image'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  return null
}

/**
 * Resolves `filePath` inside the worktree root and refuses everything else: no absolute paths, no `..`
 * segments, and the RESOLVED path (and its realpath — symlink escape) must stay inside the worktree.
 */
async function resolveInsideWorktree(wt: WorktreeRef, filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('No file path')
  if (isAbsolute(filePath)) throw new Error('File is outside the worktree')
  const target = resolve(wt.path, filePath)
  const root = resolve(wt.path)
  if (target !== root && !target.startsWith(root + sep)) throw new Error('File is outside the worktree')
  const realTarget = await realpath(target).catch(() => null)
  if (realTarget === null) throw new Error('File not found')
  const realRoot = await realpath(root)
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) throw new Error('File is outside the worktree')
  return target
}

async function readCapped(target: string, cap: number, cutTrailingLineBreak: boolean): Promise<{ bytes: Buffer; truncated: boolean }> {
  const size = (await stat(target)).size
  if (size <= cap) {
    const handle = await open(target, 'r')
    try {
      const out = Buffer.alloc(Number(size))
      await handle.read(out, 0, Number(size), 0)
      return { bytes: out, truncated: false }
    } finally {
      await handle.close()
    }
  }
  const handle = await open(target, 'r')
  try {
    const head = Buffer.alloc(cap)
    await handle.read(head, 0, cap, 0)
    if (!cutTrailingLineBreak) return { bytes: head, truncated: true }
    const lastBreak = head.lastIndexOf(0x0a)
    return { bytes: lastBreak < 0 ? Buffer.alloc(0) : head.subarray(0, lastBreak + 1), truncated: true }
  } finally {
    await handle.close()
  }
}

/**
 * The rendered preview of one worktree file. Images over the image cap are refused (a cut image is useless);
 * markdown/text is read up to the text cap and cut at a line break, flagged `truncated`.
 */
export async function readWorktreePreview(wt: WorktreeRef, filePath: string): Promise<FilePreview> {
  // Path safety FIRST: a traversal request is refused whatever the file type.
  const target = await resolveInsideWorktree(wt, filePath)
  const kind = previewKindFor(filePath)
  if (kind === null) throw new Error('File type has no preview')

  if (kind === 'image') {
    const size = (await stat(target)).size
    if (size > PREVIEW_IMAGE_MAX_BYTES) throw new Error('File is too large to preview')
    const { bytes } = await readCapped(target, PREVIEW_IMAGE_MAX_BYTES, false)
    const dot = target.lastIndexOf('.')
    const mime = IMAGE_MIME[target.slice(dot + 1).toLowerCase()]
    return { worktreeId: wt.id, path: filePath, kind, base64: bytes.toString('base64'), content: '', mime, truncated: false }
  }

  const { bytes, truncated } = await readCapped(target, PREVIEW_TEXT_MAX_BYTES, true)
  return {
    worktreeId: wt.id,
    path: filePath,
    kind,
    base64: '',
    content: bytes.toString('utf8'),
    mime: 'text/markdown',
    truncated
  }
}
