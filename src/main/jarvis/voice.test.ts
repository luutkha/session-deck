import { describe, expect, it } from 'vitest'
import { createVoiceListener, listenErrorMessage, listenScript, parseListenOutput } from './voice'

describe('voice input', () => {
  it('builds a dictation script for the microphone or a WAV file (quotes escaped)', () => {
    expect(listenScript(null)).toContain('$r.SetInputToDefaultAudioDevice()')
    expect(listenScript("C:\\it's\\a.wav")).toContain("$r.SetInputToWaveFile('C:\\it''s\\a.wav')")
    expect(listenScript(null)).toContain('DictationGrammar')
  })

  it('reads the words, or null when nothing was understood', () => {
    expect(parseListenOutput('"List my sessions please"')).toBe('List my sessions please')
    expect(parseListenOutput('null')).toBeNull()
    expect(parseListenOutput('""')).toBeNull()
    expect(parseListenOutput('')).toBeNull()
    expect(() => parseListenOutput('{"a":1}')).toThrow()
  })

  it('explains the usual failures in plain words', () => {
    expect(listenErrorMessage('No recognizer is installed.')).toContain('no speech recognizer')
    expect(listenErrorMessage('Cannot find the requested audio device')).toContain('microphone')
    expect(listenErrorMessage('\nSomething else broke\nat line 1')).toBe('Speech recognition failed: Something else broke')
  })

  it('refuses outside Windows', async () => {
    await expect(createVoiceListener({ wavFile: () => null, platform: 'linux' }).listen()).rejects.toThrow('Windows only')
  })
})
