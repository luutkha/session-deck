import { join } from 'node:path'

export function storeFilePath(userData: string): string {
  return join(userData, 'sessiondeck-store.json')
}

export function attentionDir(userData: string): string {
  return join(userData, 'sessiondeck-attention')
}