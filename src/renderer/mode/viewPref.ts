// The main area of a workspace: the terminals, the grid or the Hub board. Remembered per mode.
import { readStorageItem, writeStorageItem } from '../shell/shellPrefs'

export type MainView = 'terminal' | 'grid' | 'hub'

export function parseView(raw: string | null): MainView {
  return raw === 'hub' ? 'hub' : raw === 'grid' ? 'grid' : 'terminal'
}

export function readStoredView(key: string): MainView {
  return parseView(readStorageItem(key))
}

export function storeView(key: string, view: MainView): void {
  writeStorageItem(key, view)
}
