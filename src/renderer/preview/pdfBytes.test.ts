// W4-E: the base64 decoder fed by both PDF delivery paths; its cost is bounded by main's 8 MB cap.
import { describe, expect, it } from 'vitest'
import { decodeBase64Bytes } from './pdfBytes'

function roundTrip(bytes: Uint8Array): void {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64 = btoa(binary)
  expect(Array.from(decodeBase64Bytes(base64))).toEqual(Array.from(bytes))
}

describe('decodeBase64Bytes', () => {
  it('decodes an empty input to an empty byte array', () => {
    expect(decodeBase64Bytes('')).toEqual(new Uint8Array(0))
    expect(decodeBase64Bytes('  \n\t ')).toEqual(new Uint8Array(0))
  })

  it('round-trips random bytes of every value', () => {
    const bytes = new Uint8Array(4096)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
    roundTrip(bytes)
  })

  it('round-trips a 1 MB input and ignores whitespace in the base64', () => {
    const bytes = new Uint8Array(1024 * 1024)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const base64 = btoa(binary).replace(/(.{76})/g, '$1\n')
    expect(decodeBase64Bytes(base64)).toEqual(bytes)
  })
})
