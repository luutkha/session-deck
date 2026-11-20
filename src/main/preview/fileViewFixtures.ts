// Real, tiny byte fixtures shared by the viewer's main-process tests (D75). They are built by hand (not on disk)
// so every test starts from the same bytes and nothing depends on a binary file in the repo.

// A real 1x1 png, small enough to live inline.
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * A minimal but real PDF (D75): header, catalog, pages, one page, a text stream, a Helvetica font object, the xref
 * table, the trailer and startxref. Every part is ASCII, so string offsets are byte offsets.
 */
export function tinyPdf(): Buffer {
  const content = 'BT /F1 24 Tf 20 100 Td (Hello) Tj ET\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(body.length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = body.length
  const entries = [
    '0000000000 65535 f \n',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  ]
  const xref = `xref\n0 ${objects.length + 1}\n${entries.join('')}`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body + xref + trailer, 'latin1')
}
