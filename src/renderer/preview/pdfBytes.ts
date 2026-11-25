// Bytes of the PDF body (D75): the one base64 decoder of both paths (whole file and streamed range).
// atob is native and fast; pdf.js wants a typed array, so a loop copies the binary string into one.
// W4-E: fetch('data:...') would avoid that loop, but the renderer CSP (index.html: default-src 'self',
// no connect-src) blocks data: fetches, so main caps whole-file PDFs at 8 MB instead (pdfViewDelivery).
export function decodeBase64Bytes(base64: string): Uint8Array {
  const compact = base64.replace(/\s+/g, '')
  if (compact === '') return new Uint8Array(0)
  const binary = atob(compact)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
