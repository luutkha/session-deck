// Pure tree building and keyboard navigation for the Changes panel file list. No React, no IPC.
import type { ChangedFile } from '../../../shared/types'
import { splitPath } from './changesFormat'

const PATH_SEPARATOR = '/'
const NEXT = 1
const FIRST = 0
const LAST_OFFSET = -1
const NOT_FOUND = -1

export interface DirNode {
  readonly kind: 'dir'
  readonly path: string
  readonly name: string
  readonly children: readonly TreeNode[]
  /** Files in this directory and all of its descendants. */
  readonly fileCount: number
}

export interface FileNode {
  readonly kind: 'file'
  readonly path: string
  readonly name: string
  readonly file: ChangedFile
}

export type TreeNode = DirNode | FileNode

export interface TreeRow {
  readonly node: TreeNode
  readonly depth: number
}

/** Mutable build-time directory; converted to DirNode once the whole tree is known. */
interface PendingDir {
  readonly path: string
  readonly name: string
  readonly dirs: Map<string, PendingDir>
  readonly files: ChangedFile[]
}

function pendingDir(path: string, name: string): PendingDir {
  return { path, name, dirs: new Map(), files: [] }
}

/** Case-insensitive alphabetical, with the exact name as a tie-break so the order stays stable. */
function compareNames(a: string, b: string): number {
  const lowerA = a.toLowerCase()
  const lowerB = b.toLowerCase()
  if (lowerA < lowerB) {
    return -1
  }
  if (lowerA > lowerB) {
    return 1
  }
  if (a < b) {
    return -1
  }
  if (a > b) {
    return 1
  }
  return 0
}

function joinPath(parentPath: string, name: string): string {
  return parentPath === '' ? name : `${parentPath}${PATH_SEPARATOR}${name}`
}

function toFileNode(file: ChangedFile): FileNode {
  return { kind: 'file', path: file.path, name: splitPath(file.path).name, file }
}

function sortedFileNodes(files: readonly ChangedFile[]): readonly FileNode[] {
  return files
    .slice()
    .sort((a, b) => compareNames(a.path, b.path))
    .map(toFileNode)
}

function insertFile(root: PendingDir, file: ChangedFile): void {
  const segments = file.path.split(PATH_SEPARATOR)
  const fileName = segments[segments.length - 1]
  if (fileName === undefined || fileName === '') {
    return
  }
  let dir = root
  for (const segment of segments.slice(0, -1)) {
    if (segment === '') {
      continue
    }
    const existing = dir.dirs.get(segment)
    if (existing !== undefined) {
      dir = existing
      continue
    }
    const created = pendingDir(joinPath(dir.path, segment), segment)
    dir.dirs.set(segment, created)
    dir = created
  }
  dir.files.push(file)
}

/** Merges single-child directory chains ("a" -> "b" becomes one "a/b" node), like IntelliJ. */
function toDirNode(start: PendingDir): DirNode {
  let path = start.path
  let name = start.name
  let files = start.files
  let dirs = start.dirs

  while (files.length === 0 && dirs.size === NEXT) {
    const only = dirs.values().next().value
    if (only === undefined) {
      break
    }
    name = joinPath(name, only.name)
    path = only.path
    files = only.files
    dirs = only.dirs
  }

  const childDirs = [...dirs.values()]
    .sort((a, b) => compareNames(a.name, b.name))
    .map((dir) => toDirNode(dir))
  const childFiles = sortedFileNodes(files)
  const children: readonly TreeNode[] = [...childDirs, ...childFiles]
  const fileCount = children.reduce(
    (total, child) => total + (child.kind === 'dir' ? child.fileCount : NEXT),
    FIRST
  )
  return { kind: 'dir', path, name, children, fileCount }
}

/** Directories first (alphabetical), then files (alphabetical); single-child dir chains are compacted. */
export function buildTree(files: readonly ChangedFile[]): readonly TreeNode[] {
  const root = pendingDir('', '')
  for (const file of files) {
    insertFile(root, file)
  }
  const dirNodes = [...root.dirs.values()]
    .sort((a, b) => compareNames(a.name, b.name))
    .map((dir) => toDirNode(dir))
  return [...dirNodes, ...sortedFileNodes(root.files)]
}

/** Rows to draw, in order; children of a collapsed directory are left out. */
export function flattenVisible(
  tree: readonly TreeNode[],
  collapsed: ReadonlySet<string>
): readonly TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (nodes: readonly TreeNode[], depth: number): void => {
    for (const node of nodes) {
      rows.push({ node, depth })
      if (node.kind === 'dir' && !collapsed.has(node.path)) {
        walk(node.children, depth + NEXT)
      }
    }
  }
  walk(tree, FIRST)
  return rows
}

/** File rows only, in draw order; the basis for next/previous file navigation. */
export function visibleFilePaths(
  tree: readonly TreeNode[],
  collapsed: ReadonlySet<string>
): readonly string[] {
  return flattenVisible(tree, collapsed).flatMap((row) =>
    row.node.kind === 'file' ? [row.node.path] : []
  )
}

/** Next (1) or previous (-1) path, wrapping around; null current starts at the first/last entry. */
export function stepFile(
  paths: readonly string[],
  current: string | null,
  delta: 1 | -1
): string | null {
  const count = paths.length
  if (count === 0) {
    return null
  }
  const index = current === null ? NOT_FOUND : paths.indexOf(current)
  if (index === NOT_FOUND) {
    return delta === NEXT ? paths[FIRST] : paths[count + LAST_OFFSET]
  }
  return paths[(index + delta + count) % count]
}

/** Returns a new set with the directory's collapsed flag flipped; the input set is never changed. */
export function toggleCollapsed(
  collapsed: ReadonlySet<string>,
  dirPath: string
): ReadonlySet<string> {
  const next = new Set(collapsed)
  if (next.has(dirPath)) {
    next.delete(dirPath)
  } else {
    next.add(dirPath)
  }
  return next
}

/** Every directory path in the tree, in draw order (for "collapse all"). */
export function dirsOf(tree: readonly TreeNode[]): readonly string[] {
  const paths: string[] = []
  const walk = (nodes: readonly TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'dir') {
        paths.push(node.path)
        walk(node.children)
      }
    }
  }
  walk(tree)
  return paths
}
