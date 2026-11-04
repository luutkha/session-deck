// What a right-click in a terminal does (D59): Orca's menu (default) or quick copy-or-paste. Renderer-only, one
// localStorage key shared by both windows, read at click time so a change applies at once.
import { readStorageItem, writeStorageItem } from '../shell/shellPrefs'
import type { RightClickMode } from './keymap'

export const RIGHT_CLICK_STORAGE_KEY = 'sessiondeck.rightclick.v1'
export const DEFAULT_RIGHT_CLICK: RightClickMode = 'menu'

export function parseRightClickMode(raw: string | null): RightClickMode {
  return raw === 'paste' || raw === 'menu' ? raw : DEFAULT_RIGHT_CLICK
}

export function readRightClickMode(): RightClickMode {
  return parseRightClickMode(readStorageItem(RIGHT_CLICK_STORAGE_KEY))
}

export function storeRightClickMode(mode: RightClickMode): void {
  writeStorageItem(RIGHT_CLICK_STORAGE_KEY, mode)
}
