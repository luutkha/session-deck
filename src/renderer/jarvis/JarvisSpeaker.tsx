// D54: reads Jarvis's replies aloud with the system voices (Chromium speech synthesis), when the user turned it on in
// the panel. Mounted in the main window only, so a reply is never spoken twice.
import { useEffect } from 'react'
import { JARVIS_SPEAK_KEY, speakableText } from './jarvisLogic'

// Delivered when the setting changes (the header button or Jarvis's own tool), so the mounted panel's button follows
// at once; a bare localStorage write would only reach another window, through the 'storage' event.
const SPEAK_EVENT = 'sessiondeck:jarvis-speak'

export function readSpeakSetting(): boolean {
  try {
    return window.localStorage.getItem(JARVIS_SPEAK_KEY) === '1'
  } catch {
    return false
  }
}

export function writeSpeakSetting(on: boolean): void {
  try {
    window.localStorage.setItem(JARVIS_SPEAK_KEY, on ? '1' : '0')
  } catch {
    // a convenience only
  }
  if (typeof window === 'undefined') return
  if (!on) window.speechSynthesis?.cancel()
  window.dispatchEvent(new Event(SPEAK_EVENT))
}

/** Follows the setting wherever it changes; returns the unsubscribe. */
export function onSpeakSettingChange(listener: (on: boolean) => void): () => void {
  const handler = (): void => listener(readSpeakSetting())
  window.addEventListener(SPEAK_EVENT, handler)
  // The same setting kept by another SessionDeck window.
  window.addEventListener('storage', handler)
  return (): void => {
    window.removeEventListener(SPEAK_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

export function JarvisSpeaker(): null {
  useEffect(() => window.api?.onJarvisReply?.((reply: string): void => {
    if (!readSpeakSetting() || window.speechSynthesis === undefined) return
    const text = speakableText(reply)
    if (text.length === 0) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  }), [])
  return null
}
