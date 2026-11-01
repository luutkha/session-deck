// D54: reads Jarvis's replies aloud with the system voices (Chromium speech synthesis), when the user turned it on in
// the panel. Mounted in the main window only, so a reply is never spoken twice.
import { useEffect } from 'react'
import { JARVIS_SPEAK_KEY, speakableText } from './jarvisLogic'

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
  if (!on) window.speechSynthesis?.cancel()
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
