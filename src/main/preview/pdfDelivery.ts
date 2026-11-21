// D75: how a PDF of a given size reaches the renderer. Up to FILE_VIEW_PDF_MAX_BYTES it is sent whole as base64;
// above that it is never read whole, only in byte ranges (pdf.js range transport); beyond the stream cap it is
// refused. One pure rule, so readFileView and the range reader cannot disagree about the boundaries.
import { FILE_VIEW_PDF_MAX_BYTES, FILE_VIEW_PDF_STREAM_MAX_BYTES } from '../../shared/types'

export type PdfDelivery = 'whole' | 'streamed' | 'refused'

export function pdfDeliveryFor(size: number): PdfDelivery {
  if (size <= FILE_VIEW_PDF_MAX_BYTES) return 'whole'
  if (size <= FILE_VIEW_PDF_STREAM_MAX_BYTES) return 'streamed'
  return 'refused'
}
