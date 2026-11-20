// Word (.docx) reading for the side-panel file viewer (D73): mammoth turns the document into HTML (the renderer
// sanitizes it) with images dropped — an <img> would carry megabytes of base64 the viewer never shows.
import mammoth from 'mammoth'

/** The viewer caps the docx HTML itself; no shared constant (the file cap is FILE_VIEW_DOC_MAX_BYTES). */
export const DOCX_HTML_MAX_CHARS = 2 * 1024 * 1024

/**
 * D75: mammoth maps Heading 1-6 and Normal itself; Word's Title and Subtitle have no default rule, so a real
 * document opened with a plain <p> there. `Title` becomes an h1 with the `title` class (the viewer styles text
 * only, so the class is harmless). `List Paragraph` is deliberately NOT mapped: mammoth builds lists from the
 * paragraph's numbering (w:numPr), and a paragraph rule on that style would shadow the list rule and flatten
 * every bullet list into plain paragraphs.
 */
const DOCX_STYLE_MAP = [
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => p.subtitle:fresh"
].join('\n')

export interface DocxRead {
  /** UNSANITIZED HTML from mammoth; the renderer must sanitize it. */
  readonly html: string
  readonly truncated: boolean
}

/** Removes every <img> tag (mammoth emits one per embedded image); exported so its rule is unit-tested. */
export function stripImageTags(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, '')
}

/**
 * Converts the document body to HTML with images dropped. The image converter returns an empty src so mammoth
 * never base64-encodes the bytes; the tag it still emits is removed afterwards.
 */
export async function readDocxHtml(buffer: Buffer): Promise<DocxRead> {
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: DOCX_STYLE_MAP,
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' }))
    }
  )
  const html = stripImageTags(result.value)
  if (html.length <= DOCX_HTML_MAX_CHARS) return { html, truncated: false }
  const cut = html.slice(0, DOCX_HTML_MAX_CHARS)
  const lastTagEnd = cut.lastIndexOf('>')
  // Cutting mid-tag would leave broken markup; keep the last complete tag when there is one.
  return { html: lastTagEnd > 0 ? cut.slice(0, lastTagEnd + 1) : cut, truncated: true }
}
