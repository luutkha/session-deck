// The main area of a workspace: the terminals or the Hub board. Remembered per mode.
import { readStorageItem, writeStorageItem } from '../shell/shellPrefs'

export type MainView = 'terminal' | 'hub'

export function parseView(raw: string | null): MainView {
  return raw === 'hub' ? 'hub' : 'terminal'
}

export function readStoredView(key: string): MainView {
  return parseView(readStorageItem(key))
}

export function storeView(key: string, view: MainView): void {
  writeStorageItem(key, view)
}
