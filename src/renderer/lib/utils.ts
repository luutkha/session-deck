// Adapted from stablyai/orca (MIT, (c) 2026 Lovecast Inc.)
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
